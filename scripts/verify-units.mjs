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

// 8. The regime bands, at the settings the app actually ships with.
{
  const u = mk("al");
  const ok = u.regime(0.3) === "permanent mould · die casting" && U.regimeOf(0) === "isothermal";
  check("UNITS-REGIME", ok, { rate: u.fmtRate(0.3), regime: u.regime(0.3) });
}

await server.close();
console.log(failures ? `done — ${failures} FAILED` : "done");
if (failures) process.exitCode = 1;
