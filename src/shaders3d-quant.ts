// Calibrated terms only. Legacy Kobayashi expressions remain shared with the
// original fused volume kernel in shaders3d.ts. See docs/QUANT-3D.md.
export const QUANT_COMMON3 = /* wgsl */ `
struct QuantStatus3 { flags: atomic<u32>, minTau: atomic<u32>, reserved0: u32, reserved1: u32 }
const QGMIN3 = 1.0e-12;
fn uSup3(psi: f32, conc: f32) -> f32 {
  let k = clamp(P.kPart, 0.001, 0.999);
  let A = 1.0 - (1.0 - k) * psi;
  return (k * conc / max(1.0e-12, P.c0 * A) - 1.0) / (1.0 - k);
}
fn finite3(v: f32) -> bool { return v >= -3.0e38 && v <= 3.0e38; }
`;

export const QUANT_PHASE3 = (alloy: boolean, latticeKinetics = false) => /* wgsl */ `
    let interfaceActive = (phi > 1.0e-6 && phi < 0.999999) || dot(gph, gph) > QGMIN3;
    let q = 2.0 * phi - 1.0;
    let well = 1.0 - q * q;
    var drive = T - 1.0;
    var factor = 1.0;
    ${alloy ? "drive = uSup3(phi, conc) + T; factor = 1.0 - (1.0 - clamp(P.kPart, 0.001, 0.999)) * T;" : ""}
    if (interfaceActive) {
      if (!(factor > 0.0) || !finite3(factor)) {
        atomicOr(&qStatus.flags, 1u);
        textureStore(phaseOut, c, vec4f(phi, 0.0, 0.0, 0.0)); return;
      }
      atomicMin(&qStatus.minTau, bitcast<u32>(factor));
    }
${alloy || !latticeKinetics ? "    let tauLoc = P.tau * fC.w / max(1.0e-20, P.epsBar * P.epsBar) * factor;" : /* wgsl */ `    // Experimental principal-plane h^2 correction; never applied to alloy.
    // Derived independently of the needle reference; see research protocol.
    let w2 = max(1.0e-20, P.epsBar * P.epsBar);
    let tauLoc = P.tau * (47.0 / 75.0) * P.lambda / P.dTherm
      * (fC.w / w2 - (1321.0 / 9870.0) * P.dx * P.dx / w2);
    if (!(tauLoc > 0.0) || !finite3(tauLoc)) {
      atomicOr(&qStatus.flags, 32u);
      textureStore(phaseOut, c, vec4f(phi, 0.0, 0.0, 0.0)); return;
    }`}
    // A hot bulk liquid has no interface kinetics to evaluate yet.
    if (!interfaceActive && !(factor > 0.0)) {
      textureStore(phaseOut, c, vec4f(phi, 0.0, 0.0, 0.0)); return;
    }
    if (interfaceActive && P.dt * P.epsBar * P.epsBar * (1.0 + 20.0 * abs(P.delta))
        > P.dx * P.dx * tauLoc / 12.0) {
      atomicOr(&qStatus.flags, 2u);
      textureStore(phaseOut, c, vec4f(phi, 0.0, 0.0, 0.0)); return;
    }
    let chi = hash3(gid.x, gid.y * 7919u + gid.z * 104729u, P.frame) - 0.5;
    let react = 0.5 * (q - q * q * q - P.lambda * well * well * drive)
      + P.noiseAmp * phi * (1.0 - phi) * chi;
    let raw = phi + P.dt / tauLoc * (aniso + react);
    if (!finite3(raw)) {
      atomicOr(&qStatus.flags, 4u);
      textureStore(phaseOut, c, vec4f(phi, 0.0, 0.0, 0.0)); return;
    }
    phiNew = clamp(raw, 0.0, 1.0);
    dPhi = phiNew - phi;
`;

export const QUANT_FACES3 = /* wgsl */ `
fn phaseAt3(c: vec3i) -> f32 { return textureLoad(state, cid3(P, c), 0).r; }
// Both cells describe this positive-axis face with exactly the same inputs.
fn concentrationFace3(a: vec3i, axis: vec3i) -> f32 {
  let b = a + axis;
  if (any(a < vec3i(0)) || any(b >= vec3i(i32(P.n)))) { return 0.0; }
  if (textureLoad(grain, a, 0).r == PORE || textureLoad(grain, b, 0).r == PORE) { return 0.0; }
  if ((P.scen == 3u || P.scen == 4u)
      && (textureLoad(mask, a, 0).r == 1u || textureLoad(mask, b, 0).r == 1u)) { return 0.0; }
  let pa = phaseAt3(a); let pb = phaseAt3(b);
  let ua = uSup3(pa, textureLoad(solute, a, 0).r);
  let ub = uSup3(pb, textureLoad(solute, b, 0).r);
  let k = clamp(P.kPart, 0.001, 0.999);
  let om = 1.0 - k;
  let invdx = 1.0 / P.dx;
  let diff = P.dSol * (1.0 - 0.5 * (pa + pb)) * (ub - ua) * invdx;
  var t1 = vec3i(0, 1, 0); var t2 = vec3i(0, 0, 1);
  if (axis.y == 1) { t1 = vec3i(1, 0, 0); }
  if (axis.z == 1) { t1 = vec3i(1, 0, 0); t2 = vec3i(0, 1, 0); }
  let gn = (pb - pa) * invdx;
  let gt1 = (phaseAt3(a + t1) - phaseAt3(a - t1) + phaseAt3(b + t1) - phaseAt3(b - t1)) * (0.25 * invdx);
  let gt2 = (phaseAt3(a + t2) - phaseAt3(a - t2) + phaseAt3(b + t2) - phaseAt3(b - t2)) * (0.25 * invdx);
  let g2 = gn * gn + gt1 * gt1 + gt2 * gt2;
  let gate = smoothstep(QGMIN3, 64.0 * QGMIN3, g2);
  let rate = (textureLoad(phiAux, a, 0).g + textureLoad(phiAux, b, 0).g) / P.dt;
  let antiTrap = P.atCoef * P.epsBar * (1.0 + om * 0.5 * (ua + ub)) * rate
    * gn * inverseSqrt(max(g2, QGMIN3)) * gate;
  return P.c0 / k * om * (diff + antiTrap);
}
`;

export const QUANT_SOLUTE3 = /* wgsl */ `
    let ex = vec3i(1, 0, 0); let ey = vec3i(0, 1, 0); let ez = vec3i(0, 0, 1);
    let divC = (concentrationFace3(c, ex) - concentrationFace3(c - ex, ex)
      + concentrationFace3(c, ey) - concentrationFace3(c - ey, ey)
      + concentrationFace3(c, ez) - concentrationFace3(c - ez, ez)) / P.dx;
    // Evolve c itself: no finite-step cross terms from changing phase after U.
    var cNew = conc + P.dt * divC;
    if (!finite3(cNew) || cNew < -1.0e-7 || cNew > 4.0) {
      atomicOr(&qStatus.flags, 8u);
      if (!finite3(cNew)) { cNew = conc; }
    }
    textureStore(soluteOut, c, vec4f(cNew, 0.0, 0.0, 0.0));
`;

/** Independent floating-point mass ledger. No Stats3 counters are reused.
 * Each workgroup writes one 32-byte partial; the CPU sums those in doubles. */
export const QUANT_MASS3 = /* wgsl */ `
struct MassShape3 { n: u32, total: u32, _pad0: u32, _pad1: u32 }
struct MassPartial3 {
  sum: f32, lo: f32, hi: f32, count: u32,
  nonFinite: u32, negative: u32, _pad0: u32, _pad1: u32,
}
@group(0) @binding(0) var<uniform> shape: MassShape3;
@group(0) @binding(1) var concentration: texture_3d<f32>;
@group(0) @binding(2) var<storage, read_write> partials: array<MassPartial3>;
var<workgroup> values: array<vec4f, 256>;
var<workgroup> counts: array<vec2u, 256>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u,
        @builtin(local_invocation_index) lane: u32,
        @builtin(workgroup_id) group: vec3u) {
  var v = vec4f(0.0, 3.0e38, -3.0e38, 0.0);
  var ct = vec2u(0u);
  if (gid.x < shape.total) {
    let z = gid.x / (shape.n * shape.n);
    let y = (gid.x / shape.n) % shape.n;
    let x = gid.x % shape.n;
    let c = textureLoad(concentration, vec3i(i32(x), i32(y), i32(z)), 0).r;
    if (c >= -3.0e38 && c <= 3.0e38) {
      v = vec4f(c, c, c, select(0.0, 1.0, c < 0.0)); ct.x = 1u;
    } else { ct.y = 1u; }
  }
  values[lane] = v; counts[lane] = ct;
  workgroupBarrier();
  for (var stride = 128u; stride > 0u; stride /= 2u) {
    if (lane < stride) {
      let a = values[lane]; let b = values[lane + stride];
      values[lane] = vec4f(a.x + b.x, min(a.y, b.y), max(a.z, b.z), a.w + b.w);
      counts[lane] += counts[lane + stride];
    }
    workgroupBarrier();
  }
  if (lane == 0u) {
    let s = values[0]; let ct0 = counts[0];
    partials[group.x] = MassPartial3(s.x, s.y, s.z, ct0.x, ct0.y, u32(s.w), 0u, 0u);
  }
}
`;
