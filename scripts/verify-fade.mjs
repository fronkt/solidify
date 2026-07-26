// FADE-* — grain-refiner fade, checked without a browser.
//
// nucleation.ts:fadeFactor is pure arithmetic, so like verify-units /
// verify-heattreat / verify-thermal it loads through vite's SSR loader and runs
// in CI. The load-bearing check is FADE-IDENTITY: a charge poured immediately
// must fade by EXACTLY nothing, so no result shipped before v6.1 moves.
//
//   node scripts/verify-fade.mjs
import { createServer } from "vite";

const server = await createServer({
  server: { middlewareMode: true }, appType: "custom", logLevel: "error",
});
const N = await server.ssrLoadModule("/src/nucleation.ts");
const { fadeFactor, FADE } = N;

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(name, ok ? "OK" : "FAIL", detail === undefined ? "" : JSON.stringify(detail));
};

// 1. FADE-IDENTITY — zero hold, and anything inside the potent plateau, fade by
//    exactly nothing. This is the guarantee that L3 moves no existing result.
{
  const ok = fadeFactor(0) === 1 && fadeFactor(FADE.lagMin) === 1 && fadeFactor(-5) === 1;
  check("FADE-IDENTITY", ok, { at0: fadeFactor(0), atLag: fadeFactor(FADE.lagMin) });
}

// 2. FADE-SHOULDER — the incubation plateau is real: full potency up to lagMin,
//    then a strict drop below 1 immediately after it. A model that started
//    decaying from t = 0 would have no shoulder and would fail this.
{
  const ok = fadeFactor(FADE.lagMin) === 1 && fadeFactor(FADE.lagMin + 0.5) < 1;
  check("FADE-SHOULDER", ok, { atLag: fadeFactor(FADE.lagMin), past: +fadeFactor(FADE.lagMin + 0.5).toFixed(4) });
}

// 3. FADE-MONOTONE — non-increasing across the whole dial. Fade only ever
//    removes sites; it never hands them back.
{
  let ok = true, prev = 2;
  const trace = [];
  for (let h = 0; h <= 120; h += 5) {
    const f = fadeFactor(h);
    if (f > prev + 1e-12) ok = false;
    prev = f;
    if (h % 30 === 0) trace.push([h, +f.toFixed(3)]);
  }
  check("FADE-MONOTONE", ok, { trace });
}

// 4. FADE-FLOOR — the decay bottoms out at the residual floor of always-present
//    heterogeneous sites, never at zero, and is close to it by two hours.
{
  const far = fadeFactor(600);
  const ok = far >= FADE.floor - 1e-9 && far <= FADE.floor + 0.02 && fadeFactor(120) < FADE.floor + 0.15;
  check("FADE-FLOOR", ok, { floor: FADE.floor, at120: +fadeFactor(120).toFixed(3), at600: +far.toFixed(3) });
}

// 5. FADE-FAST — most of the loss is in the first ~30 min, matching the settling
//    literature (settled fraction roughly constant after 30 min). Under half the
//    active sites survive a 30-min hold.
{
  const at30 = fadeFactor(30);
  const ok = at30 < 0.5 && at30 > FADE.floor;
  check("FADE-FAST", ok, { at30: +at30.toFixed(3) });
}

await server.close();
console.log(failures ? `done — ${failures} FAILED` : "done — all fade checks passed");
if (failures) process.exitCode = 1;
