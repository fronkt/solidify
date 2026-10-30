// Browser fixture for a single pure dendrite. The three production shader
// sources are reused verbatim except integer bounds and coordinate clamping.
// No alternate phase, heat or anisotropy equation is implemented here.
export async function installQuant3TipDriver() {
  const { Sim3D, DEFAULTS3D } = await import("/src/sim3d.ts");
  const { FLUX3D_WGSL, phi3dWgsl, transport3dWgsl, P3, MAX_GRAINS3 } = await import("/src/shaders3d.ts");
  const S = window.__solidify, device = S.sim().device;
  S.app.setRun(false);
  let active = null;
  const sources = [FLUX3D_WGSL, phi3dWgsl(false), transport3dWgsl(false)];
  const shaderErrors = [];
  const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(x => x.toString(16).padStart(2, "0")).join("");

  function specialize(source, dims) {
    const guard = "gid.x >= P.n || gid.y >= P.n || gid.z >= P.n";
    const upper = "vec3i(i32(p.n) - 1)";
    if (source.split(guard).length !== 2 || source.split(upper).length !== 2) {
      throw new Error("production bounds changed; rectangular specialization needs review");
    }
    return source.replace(guard, `any(gid >= vec3u(${dims.map(n => `${n}u`).join(", ")}))`)
      .replace(upper, `vec3i(${dims.map(n => n - 1).join(", ")})`);
  }

  async function readTexture(texture, dims, bpp, origin = [0, 0, 0]) {
    const row = Math.ceil(dims[0] * bpp / 256) * 256;
    const staging = device.createBuffer({ size: row * dims[1] * dims[2], usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    try {
      const enc = device.createCommandEncoder();
      enc.copyTextureToBuffer({ texture, origin }, { buffer: staging, bytesPerRow: row, rowsPerImage: dims[1] }, dims);
      device.queue.submit([enc.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      const padded = new Uint8Array(staging.getMappedRange()), out = new Uint8Array(dims[0] * dims[1] * dims[2] * bpp);
      for (let i = 0; i < dims[1] * dims[2]; i++) out.set(padded.subarray(i * row, i * row + dims[0] * bpp), i * dims[0] * bpp);
      staging.unmap(); return out;
    } finally { staging.destroy(); }
  }

  function fields(dims, config) {
    const [nx, ny, nz] = dims, count = nx * ny * nz;
    const state = new Float32Array(count * 2), grain = new Uint32Array(count);
    const center = config.center ?? [0, 0, 0];
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const i = (z * ny + y) * nx + x;
      const distance = Math.hypot((x + .5) * config.dx - center[0], (y + .5) * config.dx - center[1], (z + .5) * config.dx - center[2]);
      const phi = .5 * (1 - Math.tanh((distance - config.radius) / Math.SQRT2));
      state[2 * i] = phi; state[2 * i + 1] = 1 - config.undercooling;
      grain[i] = phi > .01 ? 1 : 0;
    }
    return { state, grain };
  }

  const quaternions = new Float32Array(MAX_GRAINS3 * 4);
  for (let i = 0; i < MAX_GRAINS3; i++) quaternions[4 * i + 3] = 1;
  const parameters = config => ({ ...DEFAULTS3D, solver: 1, lambda: config.lambda,
    dx: config.dx, dt: config.dt, epsBar: 1, tau: 1, delta: config.epsilon4, deltaZ: 0, aniMode3: 1,
    latent: 1, dTherm: .6267 * config.lambda, dSol: .6267 * config.lambda,
    frozenT: 0, alloyOn: 0, noiseAmp: 0, pPore: 0, twinProb: 0, facet: 0,
    scen: 0, coolRate: 0, heatIn: 0, tFar: 1 - config.undercooling });

  async function create(config) {
    const dims = config.dims, resources = [];
    const tex = format => {
      const t = device.createTexture({ size: dims, dimension: "3d", format,
        usage: GPUTextureUsage.TEXTURE_BINDING | (format === "r8uint" ? 0 : GPUTextureUsage.STORAGE_BINDING) | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC });
      resources.push(t); return t;
    };
    const buf = (size, usage) => { const b = device.createBuffer({ size, usage }); resources.push(b); return b; };
    device.pushErrorScope("out-of-memory"); device.pushErrorScope("validation");
    let fixture;
    try {
      const state = [tex("rg32float"), tex("rg32float")], grain = [tex("r32uint"), tex("r32uint")];
      const flux = tex("rgba32float"), aux = tex("rg32float"), age = tex("rg32float"), fed = tex("r32uint"), mask = tex("r8uint");
      const uniform = buf(P3.BYTES, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
      const quats = buf(quaternions.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      const twin = buf(4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      const status = buf(16, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
      const staging = buf(16, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
      const codes = sources.map(source => specialize(source, dims));
      const pipes = [];
      for (let i = 0; i < codes.length; i++) {
        const module = device.createShaderModule({ code: codes[i], label: `tip production pass ${i}` });
        const info = await module.getCompilationInfo();
        const errors = info.messages.filter(m => m.type === "error").map(m => `${m.lineNum}:${m.linePos}: ${m.message}`);
        shaderErrors.push(...errors); if (errors.length) throw new Error(errors.join("\n"));
        pipes.push(await device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "main" } }));
      }
      const binding = (binding, resource) => ({ binding, resource });
      const uniformEntry = binding(0, { buffer: uniform });
      const groups = [0, 1].map(dir => {
        const view = t => t.createView();
        const all = [
          [uniformEntry, binding(1, view(state[dir])), binding(2, view(grain[dir])), binding(3, { buffer: quats }), binding(4, view(flux))],
          [uniformEntry, binding(1, view(state[dir])), binding(2, view(grain[dir])), binding(3, view(flux)), binding(4, view(aux)), binding(5, view(mask)), binding(7, { buffer: status })],
          [uniformEntry, binding(1, view(state[dir])), binding(2, view(grain[dir])), binding(3, view(aux)), binding(4, view(state[1 - dir])), binding(5, view(grain[1 - dir])), binding(6, view(age)), binding(7, view(fed)),
            binding(10, { buffer: quats }), binding(11, { buffer: twin }), binding(12, view(mask)), binding(13, { buffer: status })],
        ];
        return all.map((entries, i) => device.createBindGroup({ layout: pipes[i].getBindGroupLayout(0), entries }));
      });
      const initial = fields(dims, config);
      for (let dir = 0; dir < 2; dir++) {
        device.queue.writeTexture({ texture: state[dir] }, initial.state, { bytesPerRow: dims[0] * 8, rowsPerImage: dims[1] }, dims);
        device.queue.writeTexture({ texture: grain[dir] }, initial.grain, { bytesPerRow: dims[0] * 4, rowsPerImage: dims[1] }, dims);
      }
      device.queue.writeBuffer(quats, 0, quaternions);
      device.queue.writeBuffer(status, 0, new Uint32Array([0, 0x7f800000, 0, 0]));
      const p = parameters(config), bytes = new ArrayBuffer(P3.BYTES), f = new Float32Array(bytes), u = new Uint32Array(bytes);
      const ints = new Set(["n", "frame", "aniMode3", "seedCount", "curGen", "scen", "alloyOn", "idFloor", "probeX", "probeY", "probeZ", "solver", "frozenT"]);
      let dir = 0, time = 0, steps = 0, frame = 0;
      const cap = Math.max(1, Math.floor(1.6e8 / dims.reduce((a, b) => a * b, 1)));
      fixture = { config, p, state, grain, age, get dir() { return dir; }, get time() { return time; }, get steps() { return steps; },
        bytesPerVoxel: 61, shaderHashes: await Promise.all(codes.map(code => digest(new TextEncoder().encode(code)))),
        async advance(count) {
          const start = performance.now(); let left = count;
          while (left > 0) {
            const batch = Math.min(left, cap); frame++;
            const values = { ...p, n: dims[0], frame, time, curGen: 1, seedCount: 0, idFloor: 1,
              probeX: 0xffffffff, probeY: 0xffffffff, probeZ: 0xffffffff };
            for (const [key, offset] of Object.entries(P3)) {
              if (key === "BYTES" || key === "sliceN") continue;
              if (ints.has(key)) u[offset] = values[key] ?? 0; else f[offset] = values[key] ?? 0;
            }
            device.queue.writeBuffer(uniform, 0, bytes);
            const enc = device.createCommandEncoder(), pass = enc.beginComputePass();
            for (let i = 0; i < batch; i++) {
              for (let j = 0; j < 3; j++) {
                pass.setPipeline(pipes[j]); pass.setBindGroup(0, groups[dir][j]);
                pass.dispatchWorkgroups(...dims.map(n => Math.ceil(n / 4)));
              }
              dir = 1 - dir;
            }
            pass.end(); device.queue.submit([enc.finish()]);
            await device.queue.onSubmittedWorkDone();
            time += batch * p.dt; steps += batch; left -= batch;
          }
          const enc = device.createCommandEncoder(); enc.copyBufferToBuffer(status, 0, staging, 0, 16); device.queue.submit([enc.finish()]);
          await staging.mapAsync(GPUMapMode.READ);
          const raw = staging.getMappedRange().slice(0); staging.unmap();
          const flags = new Uint32Array(raw)[0], minTau = new Float32Array(raw)[1];
          if (flags) throw new Error(`quantitative diagnostic flags ${flags}`);
          return { count, seconds: (performance.now() - start) / 1000, minTau, time, steps };
        },
        async sample() {
          const width = Math.min(40, dims[0], dims[1]), slabDims = [width, width, dims[2]];
          const raw = await readTexture(state[dir], slabDims, 8), data = new Float32Array(raw.buffer), points = [];
          for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
            for (let z = dims[2] - 2; z >= 0; z--) {
              const i = (z * width + y) * width + x, a = data[2 * i], b = data[2 * (i + width * width)];
              if (a >= .5 && b < .5) {
                points.push({ x: (x + .5) * p.dx, y: (y + .5) * p.dx,
                  z: (z + .5 + (a - .5) / (a - b)) * p.dx });
                break;
              }
            }
          }
          const top = data[2 * ((dims[2] - 1) * width * width) + 1];
          return { time, steps, points, aheadBoundaryTemperature: top };
        },
        async destroy() { await device.queue.onSubmittedWorkDone(); for (const resource of resources) resource.destroy(); },
      };
      await device.queue.onSubmittedWorkDone();
    } catch (error) {
      for (const resource of resources) resource.destroy();
      await device.popErrorScope(); await device.popErrorScope(); throw error;
    }
    const validation = await device.popErrorScope(), memory = await device.popErrorScope();
    if (validation || memory) { await fixture.destroy(); throw new Error(validation?.message ?? memory.message); }
    return fixture;
  }

  window.__q3tip = {
    async stage(config) { if (active) await active.destroy(); active = null; active = await create(config);
      return { params: active.p, bytesPerVoxel: active.bytesPerVoxel, shaderHashes: active.shaderHashes }; },
    advance: count => active.advance(count), sample: () => active.sample(),
    async destroy() { if (active) await active.destroy(); active = null; },
    async equivalence(config) {
      const n = 32, c = { ...config, dims: [n, n, n], radius: 5, center: [n * config.dx / 2, n * config.dx / 2, n * config.dx / 2] };
      const rect = await create(c), sim = new Sim3D(device, n); sim.build();
      try {
        if (!await sim.enableQuant()) throw new Error("cube quantitative allocation failed");
        Object.assign(sim.params, parameters(c)); sim.reset(1 - c.undercooling);
        const initial = fields(c.dims, c);
        device.queue.writeBuffer(sim.quatBuffer, 0, quaternions);
        for (let dir = 0; dir < 2; dir++) {
          device.queue.writeTexture({ texture: sim.stateTexture(dir) }, initial.state, { bytesPerRow: n * 8, rowsPerImage: n }, c.dims);
          device.queue.writeTexture({ texture: sim.grainTexture(dir) }, initial.grain, { bytesPerRow: n * 4, rowsPerImage: n }, c.dims);
        }
        const checkpoints = []; let previous = 0;
        for (const target of [1, 17, 64]) {
          await sim.stepSync(target - previous); await rect.advance(target - previous); previous = target;
          const comparisons = [];
          for (const [field, a, b, size] of [["state", sim.stateTexture(sim.dir), rect.state[rect.dir], 8],
            ["grain", sim.grainTexture(sim.dir), rect.grain[rect.dir], 4], ["age", sim.ageTexture, rect.age, 8]]) {
            const left = await readTexture(a, c.dims, size), right = await readTexture(b, c.dims, size);
            let mismatches = 0;
            for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) mismatches++;
            comparisons.push({ field, bytes: left.length, mismatches, productionHash: await digest(left), specializedHash: await digest(right) });
          }
          checkpoints.push({ target, comparisons });
        }
        return { checkpoints, config: c, shaderErrors };
      } finally { await device.queue.onSubmittedWorkDone(); sim.destroy(); await rect.destroy(); }
    },
  };
}
