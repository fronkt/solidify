// Research-only browser driver. Production source files are never modified.
export async function installAngularGpuDriver() {
  const H = await import('/scripts/research/quant3d-oblique-gpu-driver.mjs');
  const {plane3dSpecialize} = await import('/scripts/fixtures/plane3d-specialize.mjs');
  const {angularKineticPhase, kineticTauProbe} = await import('/scripts/research/quant3d-angular-shader.mjs');
  const M = await import('/src/shaders3d.ts');
  const {DEFAULTS3D} = await import('/src/sim3d.ts');
  const device = window.__solidify.sim().device;
  const sha = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), v => v.toString(16).padStart(2, '0')).join('');
  const principal = M.phi3dWgsl(false, true);
  const angular = angularKineticPhase(principal);
  const angularProbe = kineticTauProbe(angular.code);
  const principalProbe = kineticTauProbe(principal, false);
  const shaderTexts = [angular.code, angularProbe.code, principalProbe.code];
  const model = code => ({...M, phi3dWgsl: alloy => {
    if (alloy) throw new Error('angular GPU controls require the pure model');
    return code;
  }});
  window.__q3angular = {
    async metadata() {
      return {shaderHashes: await Promise.all(shaderTexts.map(code => sha(new TextEncoder().encode(code)))),
        localTauOnlyRoundtrip: angular.localTauOnlyRoundtrip,
        captureOnlyRoundtrips: [angularProbe.captureOnlyRoundtrip, principalProbe.captureOnlyRoundtrip]};
    },
    async response(input, fixture) {
      const dims = [128, 4, 4], count = input.period, initial = new Float32Array(2048 * 2);
      if (count !== 257) throw new Error('unexpected angular input period');
      for (let i = 0; i < count; i++) {
        initial[2 * i] = input.psiStored[i]; initial[2 * i + 1] = input.temperatureStored[i];
      }
      const c = {dims, count, normal: fixture.geometry.normal, dx: input.uniforms.dx,
        dt: input.uniforms.dt, epsilon: input.uniforms.delta, candidate: true, boundary: 'periodic'};
      const result = {config: c, probes: [], sourceProofs: {localTauOnlyRoundtrip: angular.localTauOnlyRoundtrip}};
      // The two probes have separate resources and never run the heat pass.
      for (const [label, code] of [['angular', angularProbe.code], ['principal-omission', principalProbe.code]]) {
        const plane = await H.createObliquePlane(device, c, initial, model(code), DEFAULTS3D, plane3dSpecialize);
        try {
          const before = await plane.fields();
          if (await sha(before.state) !== await sha(new Uint8Array(initial.buffer))) throw new Error('probe initial readback mismatch');
          const clock = await plane.probePhase();
          const captured = new Float32Array((await H.obliqueRaw(device, plane.aux, dims, 8)).buffer);
          const after = await plane.fields();
          if (clock.steps !== 0 || await sha(after.state) !== await sha(before.state)) throw new Error('diagnostic capture advanced the phase field');
          result.probes.push({label, clock, inputSha256: await sha(before.state.subarray(0, count * 8)),
            stateUnchanged: true, tau: Array.from({length: count}, (_, i) => captured[2 * i]),
            gamma: Array.from({length: count}, (_, i) => captured[2 * i + 1]),
            specialization: plane.specs.map(s => ({geometry: s.geometry, geometryOnlyRoundtrip: s.geometryOnlyRoundtrip}))});
        } finally { await plane.destroy(); }
      }
      const plane = await H.createObliquePlane(device, c, initial, model(angular.code), DEFAULTS3D, plane3dSpecialize);
      try {
        const before = await plane.fields();
        if (await sha(before.state) !== await sha(new Uint8Array(initial.buffer))) throw new Error('response initial readback mismatch');
        const clock = await plane.advance(1), after = await plane.fields();
        const state = new Float32Array(after.state.buffer), psi = [], temperature = [];
        let phaseChanged = 0;
        for (let i = 0; i < count; i++) {
          psi.push(state[2 * i]); temperature.push(state[2 * i + 1]);
          phaseChanged += state[2 * i] !== initial[2 * i];
          if (!Number.isFinite(state[2 * i]) || state[2 * i] < 0 || state[2 * i] > 1
              || !Number.isFinite(state[2 * i + 1]) || state[2 * i + 1] < -1 || state[2 * i + 1] > 2) throw new Error('invalid angular response');
        }
        if (!phaseChanged) throw new Error('angular response phase evolution is vacuous');
        const flux = new Float32Array((await H.obliqueRaw(device, plane.flux, dims, 16)).buffer);
        result.response = {clock, psi, temperature, flux: Array.from(flux.subarray(0, count * 4)), phaseChanged,
          inputSha256: await sha(before.state.subarray(0, count * 8)), stateSha256: await sha(after.state),
          specialization: plane.specs.map(s => ({geometry: s.geometry, geometryOnlyRoundtrip: s.geometryOnlyRoundtrip}))};
        return result;
      } finally { await plane.destroy(); }
    }
  };
}
