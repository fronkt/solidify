// UNITS-CLOSURE — the scaling layer, checked without a browser.
//
// Every other verify-*.mjs needs a WebGPU Chrome at a hardcoded path, which is
// why none of them run in CI. This one is pure arithmetic over src/units.ts, so
// it runs anywhere Node does and IS wired into the GitHub workflow. It loads the
// TypeScript through vite's SSR loader (vite is already a devDependency) rather
// than duplicating the formulas in JS — a test that re-implements the thing it
// is testing proves nothing.
//
//   node scripts/verify-units.mjs
import { createServer } from "vite";

const server = await createServer({
  server: { middlewareMode: true }, appType: "custom", logLevel: "error",
});
const U = await server.ssrLoadModule("/src/units.ts");
const M = await server.ssrLoadModule("/src/materials.ts");

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(name, ok ? "OK" : "FAIL", detail === undefined ? "" : JSON.stringify(detail));
};
const close = (a, b, rel = 1e-9) =>
  Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));

const base = { n: 1024, dx: 0.03, dSol: 0.9, umPerCell: U.DEFAULT_UM_PER_CELL };
const mk = (key, over = {}) => {
  const mat = M.MATERIALS[key];
  const si = mat.si ?? null;
  const inp = {
    si, latent: mat.params.latent ?? 1.6,
    alloy: (mat.params.alloyOn ?? 0) === 1, ...base, ...over,
  };
  return new U.Units(U.scaleOf(inp), si);
};

// 1. The kelvin scale is the heat equation's own statement, not a fit. Computed
//    here from L/c_p independently of the module.
{
  const rows = [];
  let ok = true;
  for (const key of ["al", "steel", "ice", "scn"]) {
    const mat = M.MATERIALS[key];
    const u = mk(key);
    const want = mat.si.L / mat.si.cp;
    const got = u.scale.kelvinPerUnit * mat.params.latent;
    ok = ok && close(got, want);
    rows.push({ key, K_per_unit: +u.scale.kelvinPerUnit.toFixed(2), LoverCp: +want.toFixed(2) });
  }
  check("UNITS-LATENT", ok, rows);
}

// 2. Time is forced by whichever diffusivity is anchoring, and by nothing else.
{
  const al = mk("al");                       // alloy on  -> solute anchor
  const ice = mk("ice");                     // alloy off -> thermal anchor
  const alSi = M.MATERIALS.al.si, iceSi = M.MATERIALS.ice.si;
  const wantAl = (base.dSol * al.scale.metresPerUnit ** 2) / alSi.Dl;
  const wantIce = (ice.scale.metresPerUnit ** 2) / iceSi.alphaTh;
  const ok = close(al.scale.secondsPerUnit, wantAl) && close(ice.scale.secondsPerUnit, wantIce)
    && al.scale.prov.secondsPerUnit === "forced by solute diffusion"
    && ice.scale.prov.secondsPerUnit === "forced by heat diffusion";
  check("UNITS-TIMEANCHOR", ok, {
    al_s_per_unit: +al.scale.secondsPerUnit.toPrecision(4),
    ice_s_per_unit: +ice.scale.secondsPerUnit.toPrecision(4),
    prov: [al.scale.prov.secondsPerUnit, ice.scale.prov.secondsPerUnit],
  });
}

// 3. THE REGRESSION. µm-per-cell is the anchor, so identical physics measures
//    the same at every grid size; the DOMAIN is what grows. The old code fixed
//    the domain and derived the pitch as 1000/n, which made one dendrite read
//    four different sizes at four different grids.
{
  const sizes = [512, 1024, 2048];
  const lens = sizes.map(n => mk("al", { n }).fmtLen(40));
  const domains = sizes.map(n => Math.round(mk("al", { n }).scale.domainUm));
  const ok = new Set(lens).size === 1
    && domains[1] === domains[0] * 2 && domains[2] === domains[0] * 4;
  check("UNITS-GRID-INVARIANT", ok, { lens, domainUm: domains });
}

// 4. Round trips, in both directions, for every converter the UI binds to.
{
  const u = mk("al");
  const t = 0.42, dt = 0.17, s = 3.5, r = 0.3, um = 55;
  const ok = close(u.fromCelsius(u.celsius(t)), t, 1e-9)
    && close(u.fromKelvin(u.kelvin(dt)), dt, 1e-12)
    && close(u.fromSeconds(u.seconds(s)), s, 1e-12)
    && close(u.fromKPerSec(u.kPerSec(r)), r, 1e-12)
    && close(u.fromMicron(u.micron(um)), um, 1e-12)
    // T = 1 must land exactly on the melting point
    && close(u.celsius(1), M.MATERIALS.al.si.Tm - U.K0, 1e-12);
  check("UNITS-ROUNDTRIP", ok, { meltC: +u.celsius(1).toFixed(2) });
}

// 5. The honesty half: the report must NAME the mismatches rather than quietly
//    printing numbers. Lewis must be flagged for a real alloy, and the capillary
//    ratio must be undefined rather than asserted as 1.
{
  const g = mk("al").scale.groups;
  const stefan = g.find(x => x.name.startsWith("Stefan"));
  const lewis = g.find(x => x.name.startsWith("Lewis"));
  const cap = g.find(x => x.name.startsWith("capillary"));
  const ok = stefan.ok === true
    && lewis.ok === false && lewis.real / lewis.model > 1e3
    && cap.model === null && cap.real === null && /not defined/.test(cap.note);
  check("UNITS-HONESTY", ok, {
    lewis_model: +lewis.model.toFixed(2), lewis_real: +lewis.real.toPrecision(3),
    stefanOk: stefan.ok, capillary: cap.model,
  });
}

// 6. A material with no SI identity must read as unknown everywhere, and unknown
//    has to look different from zero.
{
  const u = mk("generic");
  const ok = u.known === false && u.scale.abstract === true
    && Number.isNaN(u.scale.kelvinPerUnit)
    && u.fmtC(0.5) === "—" && u.fmtRate(0.3) === "—" && u.fmtTime(2) === "—"
    // lengths ARE still real: the resolution was set, not derived
    && u.fmtLen(40).endsWith("µm");
  check("UNITS-ABSTRACT", ok, { known: u.known, len: u.fmtLen(40), temp: u.fmtC(0.5) });
}

// 7. Physical sanity: the undercooling dial's own maximum is past what any real
//    aluminium melt reaches, and inside what water reaches. Both are true, both
//    are worth showing a user, and neither was visible before.
{
  const al = mk("al"), ice = mk("ice");
  const ok = al.beyondReal(1.0) === true && ice.beyondReal(1.0) === false;
  check("UNITS-TURNBULL", ok, {
    al: { sliderMaxK: +al.kelvin(1).toFixed(0), limitK: +U.maxRealUndercoolK(M.MATERIALS.al.si).toFixed(0) },
    ice: { sliderMaxK: +ice.kelvin(1).toFixed(0), limitK: +U.maxRealUndercoolK(M.MATERIALS.ice.si).toFixed(0) },
  });
}

// 8. The regime bands, at the settings the app actually ships with. American
//    spelling since v8 U1a (docs/COPY-STYLE.md); still an exact match.
{
  const u = mk("al");
  const ok = u.regime(0.3) === "permanent mold · die casting" && U.regimeOf(0) === "isothermal";
  check("UNITS-REGIME", ok, { rate: u.fmtRate(0.3), regime: u.regime(0.3) });
}

// 9. UNITS-NIYAMA (Phase D N1) — the Ny = G/√Ṫ conversion is a dimensional
//    closure over the primitives (kelvin(1) is kelvinPerUnit, seconds(1) is
//    secondsPerUnit — the METHODS, so the formula cannot drift from what the
//    rest of the layer prints), it refuses under the abstract material, and
//    the cited steel anchor round-trips: 1.0 (°C·min)^½·cm⁻¹ must equal
//    √60/10 K^½·s^½·mm⁻¹, computed here from scratch.
{
  const steel = mk("steel"), none = mk("generic");
  const closure = steel.niyamaSI(2.5) * (steel.scale.metresPerUnit * 1e3)
    / Math.sqrt(steel.kelvin(1) * steel.seconds(1));
  const anchor = Math.sqrt(60) / 10;                        // (°C·min)^½/cm → K^½s^½/mm
  const ok = close(closure, 2.5, 1e-9)
    && Number.isNaN(none.niyamaSI(2.5)) && none.fmtNiyama(2.5) === "—"
    && close(anchor, 0.7746, 1e-3)
    && steel.fmtNiyama(1).includes("K·s^½·mm⁻¹");
  check("UNITS-NIYAMA", ok, {
    closure: +closure.toFixed(6), anchor: +anchor.toFixed(4),
    steelNy1: steel.fmtNiyama(1), abstract: none.fmtNiyama(2.5),
  });
}

// 10. UNITS-QUANT-ANCHOR (v8 U2 review) — what T̃ = 1 IS under the calibrated
//     (Karma–Rappel) solver with the solute field on. Its reference state puts
//     T̃ = 1 on the nominal alloy's LIQUIDUS and T̃ = 0 on its solidus
//     (shaders.ts uSup: U = −1 in liquid at c∞, so the drive U + T vanishes at
//     T = 1), one degree being the freezing range ΔT₀. The converter mapped
//     T̃ = 1 to the pure metal's T_m regardless, so every calibrated alloy's
//     °C axis, readout and CSV value sat |m_L|·c∞ too high (15.3 K for the
//     Al–Cu preset at 4.5 wt%). Both ends derived here from materials.ts:
//     celsius(1) = T_m + m_L·c∞, celsius(0) = that − |m_L|·c∞·(1 − k)/k; and
//     the Kobayashi path keeps T̃ = 1 on T_m (UNITS-ROUNDTRIP).
{
  const Q = await server.ssrLoadModule("/src/quant.ts");
  const WT = (await server.ssrLoadModule("/src/alloy.ts")).WT_PER_C0;
  const rows = [];
  let ok = true;
  for (const key of ["al", "steel"]) {
    const mat = M.MATERIALS[key], si = mat.si;
    const c0wt = mat.params.c0 * WT;
    const q = Q.calibrate({ si, alloy: true, c0wt, lambda: 30 });
    const u = new U.Units(U.scaleOf({
      si, n: 1024, dx: q.dx, latent: q.latent, dSol: q.dTilde, alloy: true, umPerCell: q.umPerCell,
      dTherm: q.dTilde, lambda: q.lambda, oneShiftK: q.liquidusShiftK, oneSource: q.liquidusSource,
    }), si);
    const k = Math.min(0.999, Math.max(1e-3, si.kPart));
    const TL = si.Tm - U.K0 + si.mL * c0wt;
    const TS = TL - (Math.abs(si.mL) * c0wt * (1 - k)) / k;
    const kob = mk(key);
    ok = ok && close(u.celsius(1), TL, 1e-12) && close(u.celsius(0), TS, 1e-9)
      && close(u.fromCelsius(TL), 1, 1e-12) && close(u.meltC, si.Tm - U.K0, 1e-12)
      && u.scale.oneSource != null && close(kob.celsius(1), si.Tm - U.K0, 1e-12) && kob.scale.oneShiftK === 0;
    rows.push({ key, celsius1: +u.celsius(1).toFixed(2), liquidus: +TL.toFixed(2), celsius0: +u.celsius(0).toFixed(2), solidus: +TS.toFixed(2), kobayashi1: +kob.celsius(1).toFixed(2) });
  }
  // a pure melt under the calibrated solver: T̃ = 1 stays T_m
  const ice = M.MATERIALS.ice.si;
  const qi = Q.calibrate({ si: ice, alloy: false, c0wt: 0, lambda: 3 });
  const ui = new U.Units(U.scaleOf({ si: ice, n: 1024, dx: qi.dx, latent: qi.latent, dSol: qi.dTilde, alloy: false, umPerCell: qi.umPerCell, dTherm: qi.dTilde, lambda: 3, oneShiftK: qi.liquidusShiftK }), ice);
  ok = ok && qi.liquidusShiftK === 0 && close(ui.celsius(1), ice.Tm - U.K0, 1e-12);
  check("UNITS-QUANT-ANCHOR", ok, rows);
}

await server.close();
console.log(failures ? `done — ${failures} FAILED` : "done");
if (failures) process.exitCode = 1;
