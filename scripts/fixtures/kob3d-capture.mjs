// Fixed manufactured-field driver. Baseline captured twice on untouched d59471e; every byte agreed.
// Runs inside the browser through page.evaluate. No frame-paced stepping or material data.
export async function installKob3Capture() {
    window.__solidify.app.setRun(false);
    const { Sim3D } = await import("/src/sim3d.ts");
    const { setSeed } = await import("/src/rng.ts");
    const { PORE_ID } = await import("/src/shaders3d.ts");
    const device = window.__solidify.sim().device;
    const b64 = a => { let s = ""; for (let k = 0; k < a.length; k += 16384) s += String.fromCharCode(...a.subarray(k, k + 16384)); return btoa(s); };
    async function raw(tex, n, bpp) {
      const bpr = Math.ceil(n * bpp / 256) * 256;
      const buf = device.createBuffer({ size: bpr * n * n, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc = device.createCommandEncoder();
      enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr, rowsPerImage: n }, [n, n, n]);
      device.queue.submit([enc.finish()]);
      await buf.mapAsync(GPUMapMode.READ);
      const padded = new Uint8Array(buf.getMappedRange());
      const out = new Uint8Array(n * n * n * bpp);
      for (let r = 0; r < n * n; r++) out.set(padded.subarray(r * bpr, r * bpr + n * bpp), r * n * bpp);
      buf.unmap(); buf.destroy(); return out;
    }
    window.__q3Capture = async c => {
      setSeed(0x51105d1f);
      const sim = new Sim3D(device, c.n); // deliberately bypass production's >=96 allocation ladder
      device.pushErrorScope("validation");
      sim.build();
      if (c.split) {
        if (!await sim.enableQuant()) throw new Error("split auxiliary allocation failed");
        sim.splitPasses = true;
      }
      Object.assign(sim.params, { aniMode3: c.aniMode3, delta: c.aniMode3 === 3 ? 0.02 : 0.04, deltaZ: 0.03,
        noiseAmp: 0.012, coolRate: 0.15, pPore: c.pPore ?? 0, scen: c.scen ?? 0, holdT: 0.08, holdRate: 5,
        weldX: c.n * 0.4, weldY: c.n * 0.6, weldPow: 8, weldSig: 3, c0: 0.3, mLiq: 0.45, kPart: 0.2, dSol: 0.8 });
      if (c.alloy && !await sim.enableAlloy()) throw new Error("alloy allocation failed");
      sim.reset(0.3);
      sim.addSeed3D(c.n * 0.3, c.n * 0.4, c.n * 0.5, 2);
      sim.addSeed3D(c.n * 0.7, c.n * 0.6, c.n * 0.5, 2);
      await sim.stepSync(0);
      const n = c.n, state = new Float32Array(n ** 3 * 2), ids = new Uint32Array(n ** 3), conc = new Float32Array(n ** 3);
      for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const i = (z * n + y) * n + x, tx = 2 * Math.PI * x / n, ty = 2 * Math.PI * y / n, tz = 2 * Math.PI * z / n;
        const phi = 0.48 + 0.34 * Math.sin(tx) * Math.cos(ty) + 0.08 * Math.cos(tz);
        state[i * 2] = phi; state[i * 2 + 1] = 0.3 + 0.12 * Math.cos(tx) + 0.06 * Math.sin(ty + tz);
        ids[i] = phi < 0.18 ? 0 : x < n / 2 ? 1 : 2;
        conc[i] = 0.3 + 0.025 * Math.cos(tx + ty) + 0.01 * Math.sin(tz);
      }
      const pore = ((n / 2) * n + n / 2) * n + n / 2;
      ids[pore] = PORE_ID; state[pore * 2] = 0;
      for (let d = 0; d < 2; d++) {
        device.queue.writeTexture({ texture: sim.stateTexture(d) }, state, { bytesPerRow: n * 8, rowsPerImage: n }, [n,n,n]);
        device.queue.writeTexture({ texture: sim.grainTexture(d) }, ids, { bytesPerRow: n * 4, rowsPerImage: n }, [n,n,n]);
        if (c.alloy) device.queue.writeTexture({ texture: sim.soluteTexture(d) }, conc, { bytesPerRow: n * 4, rowsPerImage: n }, [n,n,n]);
      }
      if (c.generation) sim.feedGen = c.generation;
      const result = { config: c, params: { ...sim.params }, checkpoints: [] };
      let elapsed = 0;
      for (const target of [0, 1, 17, 64, 129]) {
        if (target > elapsed) await sim.stepSync(target - elapsed);
        elapsed = target;
        if (target === 17) { sim.addSeed3D(n * 0.2, n * 0.7, n * 0.3, 2); sim.quench(0.02); await sim.stepSync(0); }
        await device.queue.onSubmittedWorkDone();
        const textures = { state0: [sim.stateTexture(0), 8], state1: [sim.stateTexture(1), 8],
          grain0: [sim.grainTexture(0), 4], grain1: [sim.grainTexture(1), 4], age: [sim.ageTexture, 8],
          fed0: [sim.fedTex[0], 4], fed1: [sim.fedTex[1], 4], mask: [sim.maskTex, 1], flux: [sim.fluxTex, 16] };
        if (c.alloy) { textures.solute0 = [sim.soluteTexture(0), 4]; textures.solute1 = [sim.soluteTexture(1), 4]; }
        const data = {};
        for (const [k, [tex, bpp]] of Object.entries(textures)) data[k] = b64(await raw(tex, n, bpp));
        const live = await sim.readStateVolume(), grains = await sim.readGrainVolume();
        const solute = c.alloy ? await sim.readSoluteVolume() : null;
        if (!live || !grains || (c.alloy && !solute)) throw new Error("snapshot readback failed");
        let phiSum = 0, solid = 0, pores = 0, mass = 0;
        for (let i = 0; i < n ** 3; i++) {
          if (!Number.isFinite(live.phi[i]) || !Number.isFinite(live.T[i]) || (solute && !Number.isFinite(solute[i]))) throw new Error("non-finite fixture");
          phiSum += live.phi[i]; solid += live.phi[i] > 0.5; pores += grains[i] === PORE_ID; mass += solute?.[i] ?? 0;
        }
        result.checkpoints.push({ target, frame: sim.frame, dir: sim.dir, simTime: sim.simTime, feedGen: sim.feedGen,
          summary: { phiSum, solid, pores, mass }, data });
      }
      const err = await device.popErrorScope();
      sim.destroy();
      if (err) throw new Error(err.message);
      return result;
    };
}
