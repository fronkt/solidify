// Test-only direct GPU readback. No solver update or scoring code is replaced.
// The volume census is recomputed from stored voxel fields independently of
// Sim3D.readStats, including its documented strict grain eligibility floor.
export async function installOptimizer3DAudit() {
  const { MAX_GRAINS3, PORE_ID } = await import("/src/shaders3d.ts");
  const admitted = window.__solidify.sim3d();
  if (!admitted) throw new Error("Install the audit only after actual 3D admission");
  const errors = window.__opt3DeviceErrors ?? [];
  window.__opt3DeviceErrors = errors;
  admitted.device.addEventListener("uncapturederror", event => errors.push(event.error.message));
  const sha = async bytes => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map(value => value.toString(16).padStart(2, "0")).join("");

  async function read(texture, n, bytesPerVoxel, device) {
    const row = Math.ceil(n * bytesPerVoxel / 256) * 256;
    const staging = device.createBuffer({
      size: row * n * n,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    try {
      const encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer({ texture }, { buffer: staging, bytesPerRow: row, rowsPerImage: n }, [n, n, n]);
      device.queue.submit([encoder.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      const padded = new Uint8Array(staging.getMappedRange()), bytes = new Uint8Array(n ** 3 * bytesPerVoxel);
      for (let line = 0; line < n * n; line++) {
        bytes.set(padded.subarray(line * row, line * row + n * bytesPerVoxel), line * n * bytesPerVoxel);
      }
      staging.unmap();
      return bytes;
    } finally { staging.destroy(); }
  }

  window.__optimizer3DAudit = {
    async snapshot(sim = window.__solidify.sim3d()) {
      if (!sim) throw new Error("No actual 3D volume is present");
      await sim.device.queue.onSubmittedWorkDone();
      const n = sim.n, dir = sim.dir, time = sim.simTime, frame = sim.frame;
      const stateBytes = await read(sim.stateTexture(dir), n, 8, sim.device);
      const grainBytes = await read(sim.grainTexture(dir), n, 4, sim.device);
      if (dir !== sim.dir || time !== sim.simTime || frame !== sim.frame) {
        throw new Error("Pause and settle the volume before its independent census");
      }
      const state = new Float32Array(stateBytes.buffer), ids = new Uint32Array(grainBytes.buffer);
      const counts = new Uint32Array(MAX_GRAINS3);
      let solid = 0, pore = 0, nonFinite = 0;
      for (let i = 0; i < ids.length; i++) {
        const phi = state[2 * i], temperature = state[2 * i + 1], id = ids[i];
        if (!Number.isFinite(phi) || !Number.isFinite(temperature)) nonFinite++;
        if (id === PORE_ID) { pore++; continue; }
        if (phi > .5) {
          solid++;
          if (id > 0 && id < MAX_GRAINS3) counts[id]++;
        }
      }
      const minimum = Math.max(64, n ** 3 * 1e-5), grains = [];
      for (let id = 1; id < MAX_GRAINS3 - 1; id++) if (counts[id] > minimum) grains.push({ id, vox: counts[id] });
      const eligibleSolidVoxels = grains.reduce((sum, grain) => sum + grain.vox, 0);
      const meanVolVox = grains.length ? eligibleSolidVoxels / grains.length : 0;
      const diameterCells = meanVolVox > 0 ? Math.cbrt(6 * meanVolVox / Math.PI) : null;
      const eqDiamUm = diameterCells == null ? null : diameterCells * sim.umPerCell;
      let stats = null;
      for (let attempt = 0; attempt < 40 && !stats; attempt++) {
        stats = await sim.readStats();
        if (!stats) await sim.device.queue.onSubmittedWorkDone();
      }
      if (!stats) throw new Error("No settled 3D GPU stats could be obtained");
      if (dir !== sim.dir || time !== sim.simTime || frame !== sim.frame) {
        throw new Error("Volume advanced during its independent stats cross-check");
      }
      return {
        n, time, frame, dir, pitch: sim.umPerCell, solid, fracSolid: solid / n ** 3,
        pore, nonFinite, minEligibleVoxels: minimum, grainCount: grains.length,
        eligibleSolidVoxels, meanVolVox, diameterCells, eqDiamUm, grains,
        stateSha256: await sha(stateBytes), grainSha256: await sha(grainBytes), stats,
      };
    },
  };
}
