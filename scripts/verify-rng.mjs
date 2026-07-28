// RNG-* — the seeded stream contract, checked without a browser.
//
// Everything in this instrument that used to call Math.random() now draws from
// src/rng.ts, and three properties of that module are load-bearing enough that a
// silent regression in any one of them would quietly un-reproduce the app while
// every other gate stayed green:
//
//   1. same seed -> same sequence (the whole point),
//   2. stream("a") and stream("b") are independent (so the optimizer searching
//      cannot move the cast, and a landing animation cannot move a gate),
//   3. adding a NEW stream name does not shift an existing one's draws — which
//      is why streams are derived by hashing the name rather than by splitting a
//      counter. Convection and recrystallization will each want a stream; under
//      a counter split, adding them would renumber everybody and silently move
//      every measured constant in the suite.
//
// Pure arithmetic over src/rng.ts, so it runs anywhere Node does and joins the
// CI set beside verify-units / verify-heattreat / verify-thermal / verify-fade /
// verify-porosity.
//
//   node scripts/verify-rng.mjs
import { createServer } from "vite";

const server = await createServer({
  server: { middlewareMode: true }, appType: "custom", logLevel: "error",
});
const R = await server.ssrLoadModule("/src/rng.ts");

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(name, ok ? "OK" : "FAIL", detail === undefined ? "" : JSON.stringify(detail));
};
const draw = (rng, k = 12) => Array.from({ length: k }, () => rng.next());
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// 1. RNG-DETERMINISM — the contract itself, plus reset() as a true rewind and
//    the [0,1) range every consumer assumes (bulkSite multiplies by n; an
//    out-of-range draw would place a site outside the domain).
{
  const a = new R.Rng(0x1234abcd), b = new R.Rng(0x1234abcd), c = new R.Rng(0x1234abce);
  const seqA = draw(a, 64), seqB = draw(b, 64), seqC = draw(c, 64);
  a.reset();
  const rewound = draw(a, 64);
  const inRange = seqA.every(v => v >= 0 && v < 1);
  const distinct = new Set(seqA).size === seqA.length;
  check("RNG-DETERMINISM", same(seqA, seqB) && same(seqA, rewound) && !same(seqA, seqC)
    && inRange && distinct,
    { sameSeedMatches: same(seqA, seqB), resetRewinds: same(seqA, rewound),
      differentSeedDiffers: !same(seqA, seqC), inRange, distinct });
}

// 2. RNG-STREAM-INDEPENDENCE — two names must not alias, and draining one must
//    not advance the other. The second half is the property that actually
//    protects a measurement: it is what lets the optimizer run beside a cast.
{
  R.setSeed(0xfeed0001);
  const sim = R.stream("sim3d"), opt = R.stream("optimizer");
  const simFirst = draw(sim, 8);

  R.setSeed(0xfeed0001);
  const sim2 = R.stream("sim3d"), opt2 = R.stream("optimizer");
  draw(opt2, 500);                        // the optimizer searches hard...
  const simAfter = draw(sim2, 8);         // ...the cast must not notice

  const aliased = same(simFirst, draw(opt, 8));
  check("RNG-STREAM-INDEPENDENCE", same(simFirst, simAfter) && !aliased,
    { unperturbedByOtherStream: same(simFirst, simAfter), namesAlias: aliased });
}

// 3. RNG-NAME-DERIVATION — the future-proofing property. A brand-new stream name
//    (as D3 convection and C3 recrystallization will each add) must leave every
//    existing stream's sequence byte-identical.
{
  R.setSeed(0x5a17ed);
  const before = draw(R.stream("sim2d"), 16);

  R.setSeed(0x5a17ed);
  R.stream("convection");                 // a consumer that did not exist before
  R.stream("recrystallization");
  const after = draw(R.stream("sim2d"), 16);

  check("RNG-NAME-DERIVATION", same(before, after), { unshiftedByNewStreams: same(before, after) });
}

// 4. RNG-REDERIVE-IN-PLACE — setSeed has to mutate the Rng objects callers are
//    holding. Every consumer caches its stream in a field (`private rng =
//    stream("sim3d")`), so a setSeed that swapped the registry entry for a fresh
//    object would leave all of them drawing from the OLD seed: a seed control
//    that visibly does nothing, and a share link that restores a cast it did not
//    actually reproduce. Caught in review before it shipped; gated here so it
//    cannot come back.
{
  R.setSeed(0xaaaa1111);
  const cached = R.stream("sim2d");       // exactly what a consumer's field holds
  const atFirstSeed = draw(cached, 8);

  R.setSeed(0xbbbb2222);
  const afterReseed = draw(cached, 8);    // same object, must follow the new seed

  R.setSeed(0xbbbb2222);
  const freshAtSecondSeed = draw(R.stream("sim2d"), 8);

  check("RNG-REDERIVE-IN-PLACE",
    !same(atFirstSeed, afterReseed) && same(afterReseed, freshAtSecondSeed),
    { cachedStreamMoved: !same(atFirstSeed, afterReseed),
      matchesFreshStream: same(afterReseed, freshAtSecondSeed) });
}

// 5. RNG-DERIVED-DRAWS — the helpers the consumers actually call. int(hi) must
//    never return hi (it indexes a 4- or 6-element face array and a 5-element
//    target list — an off-by-one there is an undefined element, not a crash),
//    sign() must be balanced, and gauss() must have the moments Box-Muller
//    promises, since the nucleation model draws every site's activation
//    undercooling through it.
{
  const r = new R.Rng(0x2b2b2b2b);
  const N = 20000;
  let intMax = -1, intMin = 99, plus = 0, sum = 0, sumSq = 0;
  for (let i = 0; i < N; i++) {
    const k = r.int(6);
    intMax = Math.max(intMax, k); intMin = Math.min(intMin, k);
    if (r.sign() > 0) plus++;
    const g = r.gauss();
    sum += g; sumSq += g * g;
  }
  const mean = sum / N, variance = sumSq / N - mean * mean;
  const signBias = Math.abs(plus / N - 0.5);
  const intOk = intMin === 0 && intMax === 5 && Number.isInteger(intMax);
  // 4-sigma bands on N = 20000: mean within 0.028, sd within ~0.02 of 1
  check("RNG-DERIVED-DRAWS",
    intOk && signBias < 0.02 && Math.abs(mean) < 0.04 && Math.abs(Math.sqrt(variance) - 1) < 0.04,
    { intRange: [intMin, intMax], signBias: +signBias.toFixed(4),
      gaussMean: +mean.toFixed(4), gaussSd: +Math.sqrt(variance).toFixed(4) });
}

// 6. RNG-SEED-ROUNDTRIP — what a share link carries. seedHex must be the eight
//    lower-case hex digits the UI prints and the link packs, and parsing it back
//    must land on the same seed, or a shared cast reproduces a different one.
{
  const seeds = [0, 1, 0x0f0f0f0f, 0xdeadbeef, 0xffffffff];
  let ok = true;
  const rows = [];
  for (const s of seeds) {
    R.setSeed(s);
    const hex = R.seedHex();
    const back = parseInt(hex, 16) >>> 0;
    ok = ok && hex.length === 8 && /^[0-9a-f]{8}$/.test(hex) && back === (s >>> 0) && R.getSeed() === (s >>> 0);
    rows.push(hex);
  }
  // reseed() must draw a genuinely different run (a fixed re-roll would be a
  // "new seed" button that never changes anything)
  R.setSeed(0x11111111);
  const rolled = new Set([R.reseed(), R.reseed(), R.reseed()]);
  check("RNG-SEED-ROUNDTRIP", ok && rolled.size === 3 && !rolled.has(0x11111111),
    { hex: rows, distinctRolls: rolled.size });
}

// 7. RNG-NUCLEATION — the seeded draw the GPU gate cannot reach.
//
// RNG-REPRO in verify-tools drives a real cast through stepSync, which is
// fence-paced and therefore reproducible — but the emergent nucleation model
// only fires when a stats readback lands, and those arrive on the FRAME loop.
// So a stepSync-driven cast never exercises nucleation.ts at all (the first
// draft of RNG-REPRO discovered this the hard way: three runs that had each
// produced zero solid, compared, and pronounced identical). Nucleation is pure
// CPU, so its reproducibility belongs here instead — where it is also faster and
// CI-runnable.
{
  const N = await server.ssrLoadModule("/src/nucleation.ts");
  const pour = (seed) => {
    R.setSeed(seed);
    const nuc = new N.Nucleation();
    Object.assign(nuc.p, { nmax: 800, dTN: 0.15, dTsig: 0.045 });
    nuc.setFilm(0.25);                     // exercise wallSite as well as bulkSite
    nuc.stage(512, false);
    const fired = [];
    // walk the ratchet down in steps, the way a cooling melt does
    for (let k = 1; k <= 40; k++) {
      nuc.observe(k, 1 - k * 0.01, 1);
      nuc.update(k, 0, (x, y, z, dTact) =>
        fired.push(`${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)},${dTact.toFixed(6)}`));
    }
    return fired;
  };

  const p1 = pour(0xc0ffee01), p2 = pour(0xc0ffee01), p3 = pour(0xc0ffee02);
  const repeats = same(p1, p2);
  const differs = !same(p1, p3);
  // as in RNG-REPRO: the pour has to have HAPPENED, or "identical" is vacuous
  const poured = p1.length > 100;
  check("RNG-NUCLEATION", poured && repeats && differs,
    { sitesFired: p1.length, sameSeedRepeats: repeats, differentSeedDiffers: differs });
}

await server.close();
console.log(failures ? `done — ${failures} FAILED` : "done");
if (failures) process.exitCode = 1;
