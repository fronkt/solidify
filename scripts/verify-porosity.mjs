// POR-* — hydrogen gas porosity via Sievert's law, checked without a browser.
//
// porosity.ts is pure arithmetic over the material's solubility data, so it
// loads through vite's SSR loader and runs in CI alongside units / heattreat /
// thermal / fade. The checks pin the real chemistry (√p Sievert scaling, the
// liquid→solid rejection) and the honest refusal for materials with no data.
//
//   node scripts/verify-porosity.mjs
import { createServer } from "vite";

const server = await createServer({
  server: { middlewareMode: true }, appType: "custom", logLevel: "error",
});
const P = await server.ssrLoadModule("/src/porosity.ts");
const M = await server.ssrLoadModule("/src/materials.ts");
const alSi = M.MATERIALS.al.si;
const steelSi = M.MATERIALS.steel.si;

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(name, ok ? "OK" : "FAIL", detail === undefined ? "" : JSON.stringify(detail));
};
const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;

// 1. POR-SIEVERT — dissolved hydrogen follows C = S·√p. Air is the 1-atm anchor
//    (√1 = 1) so cLiquid there must equal the material's own hL, and the ratio
//    between two atmospheres must be √(p₁/p₂), not p₁/p₂.
{
  const air = P.hydrogenPorosity(alSi, "air");
  const arg = P.hydrogenPorosity(alSi, "argon");
  const ratio = air.cLiquid / arg.cLiquid;
  const wantRatio = Math.sqrt(P.PH2.air / P.PH2.argon);
  const ok = near(air.cLiquid, alSi.hL, 1e-9) && near(ratio, wantRatio, 1e-6);
  check("POR-SIEVERT", ok, { cLiquidAir: +air.cLiquid.toFixed(3), hL: alSi.hL, ratio: +ratio.toFixed(3), wantRatio: +wantRatio.toFixed(3) });
}

// 2. POR-REJECT — the driver is the liquid→solid solubility drop: rejected =
//    (hL − hS)·√p, and it is a large fraction of the dissolved hydrogen for Al
//    (hL ≫ hS), which is the whole reason aluminium gasses.
{
  const air = P.hydrogenPorosity(alSi, "air");
  const want = (alSi.hL - alSi.hS) * Math.sqrt(P.PH2.air);
  const ok = near(air.cRejected, want, 1e-9) && air.cRejected > 0.9 * air.cLiquid;
  check("POR-REJECT", ok, { rejected: +air.cRejected.toFixed(3), want: +want.toFixed(3), cLiquid: +air.cLiquid.toFixed(3) });
}

// 3. POR-ORDER — pore bias is physically ordered air > argon > vacuum, vacuum is
//    exactly zero (a degassed melt), and every value stays in [0,1].
{
  const air = P.hydrogenPorosity(alSi, "air").pPore;
  const arg = P.hydrogenPorosity(alSi, "argon").pPore;
  const vac = P.hydrogenPorosity(alSi, "vacuum").pPore;
  const ok = air > arg && arg >= vac && vac === 0 && air <= 1 && air > 0;
  check("POR-ORDER", ok, { air: +air.toFixed(3), argon: +arg.toFixed(3), vacuum: vac });
}

// 4. POR-REFUSE — a material with no hydrogen-solubility data (steel here has an
//    si block but no hL/hS; generic has no si at all) refuses gas porosity by
//    name, returning zero and a note, not a fabricated number.
{
  const steel = P.hydrogenPorosity(steelSi, "air");
  const none = P.hydrogenPorosity(undefined, "air");
  const ok = steel.pPore === 0 && /no hydrogen-solubility data/.test(steel.note ?? "")
    && none.pPore === 0 && none.note != null;
  check("POR-REFUSE", ok, { steelPore: steel.pPore, steelNote: steel.note, nonePore: none.pPore });
}

// 5. POR-KNOWN — the Al air numbers land where the Ransley–Neufeld solubilities
//    put them: ~0.69 dissolved, ~0.65 rejected, a modest pore bias above the
//    escape allowance. A tripwire so the constants cannot drift unnoticed.
{
  const air = P.hydrogenPorosity(alSi, "air");
  const wantPore = P.PORE_GAIN * Math.max(0, (alSi.hL - alSi.hS) - P.C_ESCAPE);
  const ok = near(air.cLiquid, 0.69, 0.02) && near(air.cRejected, 0.654, 0.02) && near(air.pPore, wantPore, 1e-9);
  check("POR-KNOWN", ok, { cLiquid: +air.cLiquid.toFixed(3), cRejected: +air.cRejected.toFixed(3), pPore: +air.pPore.toFixed(3) });
}

await server.close();
console.log(failures ? `done — ${failures} FAILED` : "done — all porosity checks passed");
if (failures) process.exitCode = 1;
