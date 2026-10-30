// Browser-side independent initial conditions and readback. No phase-field
// arithmetic is copied from the solver: tanh, sphere curvature, conservation
// and the Stefan similarity solution supply separate expected answers.
export async function installQuant3Driver() {
  const { Sim3D } = await import("/src/sim3d.ts");
  const { setSeed } = await import("/src/rng.ts");
  const device = window.__solidify.sim().device;
  window.__solidify.app.setRun(false);
  const A1 = 0.8839, A2 = 0.6267;
  let sim = null;
  const stats = f => {
    let sum = 0, min = Infinity, max = -Infinity;
    for (const v of f) { if (!Number.isFinite(v)) throw new Error("non-finite field"); sum += v; min = Math.min(min, v); max = Math.max(max, v); }
    return { sum, min, max };
  };
  const erf = x => {
    const sign = x < 0 ? -1 : 1, a = Math.abs(x), t = 1 / (1 + 0.3275911 * a);
    return sign * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a));
  };
  const stefanBeta = (cold, liquid, latent) => {
    let a = 0, b = 2;
    const f = x => Math.sqrt(Math.PI) * x * Math.exp(x * x)
      - ((1 - cold) / latent / (1 + erf(x)) + (1 - liquid) / latent / (1 - erf(x)));
    for (let i = 0; i < 70; i++) { const m = (a + b) / 2; if (f(m) > 0) b = m; else a = m; }
    return (a + b) / 2;
  };
  const profile = (f, n, axis = 0) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const v = [n >> 1, n >> 1, n >> 1]; v[axis] = i;
      out.push(f[(v[2] * n + v[1]) * n + v[0]]);
    }
    return out;
  };
  const cross = row => {
    for (let i = 0; i < row.length - 1; i++) if (row[i] >= 0.5 && row[i + 1] < 0.5)
      return i + 0.5 + (row[i] - 0.5) / (row[i] - row[i + 1]);
    return NaN;
  };
  async function state() {
    const s = await sim.readStateVolume();
    if (!s) throw new Error("state readback failed");
    const c = sim.alloyActive ? await sim.readSoluteVolume() : null;
    if (sim.alloyActive && !c) throw new Error("solute readback failed");
    return { ...s, c };
  }
  window.__q3 = {
    A1, A2, erf, stefanBeta, profile, cross, stats, state,
    get sim() { return sim; },
    async stage(o = {}) {
      if (sim) { await device.queue.onSubmittedWorkDone(); sim.destroy(); }
      setSeed(0x51105d1f);
      const n = o.n ?? 64, dx = o.dx ?? 0.5, lambda = o.lambda ?? 2, D = A2 * lambda;
      const delta = Math.abs(o.params?.delta ?? 0), k = o.params?.kPart ?? 0.15;
      const tauFactor = o.alloy ? 1 - (1-k) * ((o.T ?? 1) + (o.perturbT ? 0.03 : 0)) : 1;
      if (!(tauFactor > 0)) throw new Error("fixture has a non-positive interface relaxation factor");
      // Separate 7-point diffusion and local phase bounds; use half of the
      // smaller bound. 1-3|delta| is conservative for smooth cubic a(n).
      const phaseBound = dx*dx*tauFactor*Math.max(0,1-3*delta)**2/(12*(1+20*delta));
      const dt = 0.5 * Math.min(dx*dx/(12*Math.max(1.2,D)), phaseBound);
      sim = new Sim3D(device, n); sim.build();
      if (!await sim.enableQuant()) throw new Error("quantitative auxiliary allocation failed");
      Object.assign(sim.params, { solver: 1, lambda, dx, dt,
        epsBar: 1, tau: 1, dTherm: D, dSol: D, latent: 1, aniMode3: 0, delta: 0, deltaZ: 0,
        noiseAmp: 0, pPore: 0, scen: 0, coolRate: 0, heatIn: 0, alloyOn: 0, twinProb: 0, facet: 0,
        c0: 0.3, kPart: 0.15, atCoef: 0.35355339059, frozenT: 1, ...o.params });
      if (o.alloy && !await sim.enableAlloy()) throw new Error("alloy allocation failed");
      sim.reset(o.T ?? 1);
      if (o.quat) {
        sim.quats.set(o.quat, 4);
        device.queue.writeBuffer(sim.quatBuffer, 16, new Float32Array(o.quat));
      }
      const raw = new Float32Array(n ** 3 * 2), ids = new Uint32Array(n ** 3), conc = new Float32Array(n ** 3);
      const x0 = o.x0 ?? n * dx / 2, axis = o.axis ?? 0;
      const beta = o.shape === "stefan" ? stefanBeta(0.7, 0.9, 1) : null;
      const st0 = o.t0 ?? 20;
      const front = o.shape === "stefan" ? x0 + 2 * beta * Math.sqrt(D * st0) : x0;
      for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const i = (z * n + y) * n + x;
        const xyz = [(x + 0.5) * dx, (y + 0.5) * dx, (z + 0.5) * dx];
        let d = xyz[axis] - front;
        if (o.shape === "sphere" || o.shape === "cylinder") {
          const xyz0 = xyz.map(v => v - n * dx / 2);
          d = Math.hypot(...(o.shape === "cylinder" ? xyz0.slice(0, 2) : xyz0)) - o.radius;
        } else if (o.shape === "oblique") d = (xyz[0] + xyz[1] + xyz[2] - 1.5 * n * dx) / Math.sqrt(3);
        let phi = 0.5 * (1 - Math.tanh(d / Math.SQRT2)), T = o.T ?? 1;
        if (o.shape === "stefan") {
          const eta = (xyz[axis] - x0) / (2 * Math.sqrt(D * st0));
          T = xyz[axis] <= front ? 0.7 + 0.3 * (1 + erf(eta)) / (1 + erf(beta)) : 0.9 + 0.1 * (1 - erf(eta)) / (1 - erf(beta));
        }
        if (o.perturbT) T += 0.03 * Math.cos(2 * Math.PI * x / n) * Math.sin(2 * Math.PI * (y + z) / n);
        raw[2 * i] = phi; raw[2 * i + 1] = T; ids[i] = phi > 0.01 ? 1 : 0;
        // U=-1 initially gives c_l=c0, c_s=k*c0. A nonuniform perturbation
        // tests face fluxes away from a one-dimensional extruded solution.
        const U = -1 + (o.perturbC ? 0.025 * Math.cos(2 * Math.PI * (x + y) / n) * Math.sin(2 * Math.PI * z / n) : 0);
        conc[i] = sim.params.c0 / sim.params.kPart * (1 - (1 - sim.params.kPart) * phi) * (1 + (1 - sim.params.kPart) * U);
      }
      if (o.pore) { const i = ((n >> 1) * n + (n >> 1)) * n + (n >> 1); ids[i] = 4095; raw[i * 2] = 0; }
      for (let dir = 0; dir < 2; dir++) {
        device.queue.writeTexture({ texture: sim.stateTexture(dir) }, raw, { bytesPerRow: n * 8, rowsPerImage: n }, [n,n,n]);
        device.queue.writeTexture({ texture: sim.grainTexture(dir) }, ids, { bytesPerRow: n * 4, rowsPerImage: n }, [n,n,n]);
        if (o.alloy) device.queue.writeTexture({ texture: sim.soluteTexture(dir) }, conc, { bytesPerRow: n * 4, rowsPerImage: n }, [n,n,n]);
      }
      await device.queue.onSubmittedWorkDone();
      return { n, dx, lambda, D, dt: sim.params.dt, beta, x0, front, t0: st0 };
    },
    async advance(steps) {
      const got = await sim.stepSync(steps);
      if (got !== steps) throw new Error(`physics budget short: ${got}/${steps}`);
      const q = await sim.readQuantitativeStatus();
      if (!q) throw new Error("quantitative status readback unavailable");
      if (q.flags || q.issue) throw new Error(`quantitative refusal: ${JSON.stringify(q)}`);
      return got;
    },
    async destroy() { if (sim) { await device.queue.onSubmittedWorkDone(); sim.destroy(); sim = null; } },
  };
}
