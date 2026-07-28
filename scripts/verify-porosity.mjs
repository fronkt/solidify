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

// POR-PORE-SOLUTE (v7.0, C0c) — every exit of the 3D update pass that writes the
// state must also hand the solute over.
//
// update3dWgsl has four `return;` paths: the out-of-bounds guard (which writes
// nothing), the mould wall, an existing pore, and a voxel voiding for the FIRST
// time. The last one used to write stateOut and grainOut and then return WITHOUT
// writing soluteOut, while its two siblings both passed `conc` through. Under
// the ping-pong that left the output slot holding what had been written two
// substeps earlier; the next pass read that stale value back, and the
// already-a-pore branch then preserved it for the rest of the run.
//
// This is gated structurally rather than numerically, and that is the honest
// choice: the solute field feeds back into freezing through the constitutional
// undercooling, so fixing it changes which voxels void at all (measured: 24560
// pores against 26324 from the same seed). Two runs that diverge cannot be
// differenced to isolate one branch — the wrong-comparison class this repo has
// paid for four times. What IS provable, exactly and without a tolerance, is the
// invariant itself: writes state => writes solute, on every path.
{
  const S = await server.ssrLoadModule("/src/shaders3d.ts");
  const rows = [];
  let ok = true;

  let stateExits = 0;
  for (const alloy of [true, false]) {
    const src = S.update3dWgsl(alloy);
    const segs = src.split(/\breturn\s*;/).slice(0, -1);
    for (let i = 0; i < segs.length; i++) {
      // Isolate the branch BODY: the text after the last `{` before this return.
      // Not a fixed character window — the main path's own soluteOut store sits
      // upstream of the pore-formation branch in the same segment, so the window
      // is load-bearing, and a fixed one would silently widen or narrow with the
      // length of whatever comment happens to be in the block. (A 600-char
      // window did exactly that on this gate's first run: it pushed the
      // formation branch's stateOut/grainOut writes out of view and reported
      // writesState:false, which would have let the invariant pass vacuously.)
      const block = segs[i].slice(segs[i].lastIndexOf("{") + 1);
      const writesState = /textureStore\((stateOut|grainOut)/.test(block);
      const writesSolute = /textureStore\(soluteOut/.test(block);
      if (alloy && writesState) stateExits++;
      // the bounds guard writes nothing and owes nothing; every other exit that
      // touches the state owes the solute too — but only when there IS a solute
      // texture bound, since layout:"auto" drops unused bindings and
      // dummy-binding storage is what caused the v1.9 black-canvas bug
      const good = alloy ? (!writesState || writesSolute) : !writesSolute;
      if (!good) ok = false;
      rows.push({ alloy, exit: i, writesState, writesSolute, good });
    }
  }
  // Cross-check the count against the structure rather than a magic number:
  // every state-writing exit stores solute, plus exactly one more for the normal
  // path that falls through to the end. The base build binds no solute at all.
  const alloyStores = (S.update3dWgsl(true).match(/textureStore\(soluteOut/g) || []).length;
  const baseStores = (S.update3dWgsl(false).match(/textureStore\(soluteOut/g) || []).length;
  ok = ok && stateExits === 3 && alloyStores === stateExits + 1 && baseStores === 0;

  check("POR-PORE-SOLUTE", ok, { alloyStores, baseStores, exits: rows });
}

await server.close();
console.log(failures ? `done — ${failures} FAILED` : "done — all porosity checks passed");
if (failures) process.exitCode = 1;
