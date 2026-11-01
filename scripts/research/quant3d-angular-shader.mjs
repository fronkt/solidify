// Research-only local-tau adapter. No production caller imports this module.
// All flux, spatial-force, reaction and heat expressions remain byte-identical.
const ORIGINAL = `    // Experimental principal-plane h^2 correction; never applied to alloy.
    // Derived independently of the needle reference; see research protocol.
    let w2 = max(1.0e-20, P.epsBar * P.epsBar);
    let tauLoc = P.tau * (47.0 / 75.0) * P.lambda / P.dTherm
      * (fC.w / w2 - (1321.0 / 9870.0) * P.dx * P.dx / w2);`;

const ANGULAR = `    // Research-only angular h^2 correction, independently derived.
    // Gamma uses the laboratory FD normal and the existing rotated flux.
    let w2 = max(1.0e-20, P.epsBar * P.epsBar);
    let angularG2 = dot(gph, gph);
    var angularGamma = 0.0;
    if (angularG2 >= QGMIN3 && fC.w > 0.0) {
      let angularGm = sqrt(angularG2);
      let angularNormal = gph / angularGm;
      angularGamma = dot(fC.xyz, angularNormal * angularNormal * angularNormal)
        / (3.0 * fC.w * angularGm);
    }
    let angularCoefficient = (1321.0 / 9870.0) + (1084.0 / 1645.0) * angularGamma;
    let tauLoc = P.tau * (47.0 / 75.0) * P.lambda / P.dTherm
      * (fC.w / w2 - angularCoefficient * P.dx * P.dx / w2);`;

export function angularKineticPhase(source) {
  if (typeof source !== 'string' || source.split(ORIGINAL).length !== 2) {
    throw new Error('angular adapter requires the exact reviewed pure principal-candidate block');
  }
  const code = source.replace(ORIGINAL, ANGULAR);
  if (code.split(ANGULAR).length !== 2 || code.replace(ANGULAR, ORIGINAL) !== source) {
    throw new Error('angular local-tau adapter failed its exact reverse proof');
  }
  return {code, localTauOnlyRoundtrip: true};
}

// Separate diagnostic kernel: read the actual local tau/gamma before evolution.
// Its capture replaces only the reaction/Euler tail, never a physical run.
export function kineticTauProbe(source, angular = true) {
  const marker = '    let chi = hash3(gid.x, gid.y * 7919u + gid.z * 104729u, P.frame) - 0.5;';
  const end = '    dPhi = phiNew - phi;';
  const anchor = angular ? ANGULAR : ORIGINAL;
  if (typeof source !== 'string' || source.split(anchor).length !== 2
      || source.split(marker).length !== 2 || source.split(end).length !== 2) {
    throw new Error('tau capture requires the exact reviewed pure candidate shader');
  }
  const start = source.indexOf(marker), stop = source.indexOf(end, start) + end.length;
  const originalTail = source.slice(start, stop);
  const capture = `    // Diagnostic capture only; this kernel does not advance the fields.
    textureStore(phaseOut, c, vec4f(tauLoc, ${angular ? 'angularGamma' : '0.0'}, 0.0, 0.0)); return;`;
  const code = source.slice(0, start) + capture + source.slice(stop);
  if (code.split(capture).length !== 2 || code.replace(capture, originalTail) !== source) {
    throw new Error('tau capture failed its exact reverse proof');
  }
  return {code, captureOnlyRoundtrip: true};
}
