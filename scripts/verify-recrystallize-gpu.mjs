import { closeBrowser } from "./browser-cleanup.mjs";
// RX3-* — C3b recrystallization nuclei on a real GPU (slice C3b-0).
//
// docs/C3B-RECRYSTALLIZATION-DESIGN.md section 4 is the spec. The arithmetic
// half (Avrami fit, bond barriers, the CPU JMAK model) is verify-recrystallize.mjs.
// This half needs the volume:
//
//   RX3-STAMP-COHERENCE  the allocator moves by exactly k; nuclei are digital
//                        spheres that claim only treatable voxels; phi, dir and
//                        every other voxel are untouched; new ids carry H = 0 on
//                        the CPU mirror AND the GPU buffer; same seed, same stamp.
//   RX3-UNDRIVEN         with no stored energy the nuclei cannot consume the
//                        matrix; a UNIFORM stored energy is the same drive as
//                        none (bit-identical), because only a difference drives;
//                        zero nuclei leave no event; and the H = 0 clause above
//                        does fire when nuclei are (wrongly) born before deposit.
//   RX3-NUCLEUS-LADDER   one nucleus in a single crystal, r x H: at H = 0 every
//                        radius shrinks, growth is monotone in H, and the
//                        measured crossover is reported against the T = 0 bond
//                        count (grow above 12 J_b at r = 2).
//   RX3-OFF-IDENTITY     on a real cast: a treatment with nucleate(0) and X
//                        sampled every sweep is bit-identical to one without
//                        either; 200 nuclei change it. Sampling is read-only, and
//                        X from the raw census equals X from a full readback.
//
//   RX3-JMAK             (pre-registered in tasks/todo.md before its first run)
//                        site-saturated kinetics on a single crystal: the slope
//                        of ln(-ln(1-X)) against ln V1, X measured over the
//                        interior box and V1 from one nucleus grown alone on
//                        the same matrix, is 1 +- 0.15 on each of three seeds.
//   RX3-CAST-SELECTION   (pre-registered) on real casts, nuclei consume the
//                        more deformed grains first, by at least 3x a
//                        uniform-drive control; surviving nuclei were born on
//                        boundaries more often than nuclei in general (pooled).
//
//   node scripts/verify-recrystallize-gpu.mjs [outDir] [port]
import puppeteer from "puppeteer-core";
import { createServer } from "vite";

// the Avrami fit the card prints, loaded rather than retyped
const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const RX = await vite.ssrLoadModule("/src/recrystallize.ts");
await vite.close();

const PORT = process.argv[3] ?? "5199";
let failures = 0;
const FAIL = () => { failures++; return "FAIL"; };
const check = (name, ok, detail) =>
  console.log(name, ok ? "OK" : FAIL(), detail === undefined ? "" : JSON.stringify(detail));

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--enable-unsafe-webgpu", "--enable-gpu", "--hide-scrollbars"],
  defaultViewport: { width: 1200, height: 800 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => {
  const t = m.type();
  if (t === "error") errors.push(m.text());
  const BENIGN = /powerPreference option is currently ignored|goatcounter: not counting/;
  if ((t === "warning" || t === "warn") && !BENIGN.test(m.text())) errors.push("WARN " + m.text());
});

try {
  await page.goto(`http://localhost:${PORT}/app/`, { waitUntil: "networkidle0", timeout: 30000 });
  await page.waitForFunction("!!window.__solidify", { timeout: 20000 });
  await page.evaluate(() => window.__solidify.app.setRun(false));
  await page.evaluate(() => window.__solidify.app.setMode("3d"));
  await page.waitForFunction("window.__solidify.mode() === '3d'", { timeout: 30000 });
  await page.evaluate(() => window.__solidify.app.setGrid3(96));
  await page.waitForFunction("window.__solidify.sim3d()?.n === 96", { timeout: 40000 });
  await page.evaluate(() => window.__solidify.app.setRun(false));
  console.log("ENTERED 3D at 96³");

  await page.evaluate(() => {
    const S = window.__solidify;
    const fnv = a => {
      const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
      let h = 0x811c9dc5;
      for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) >>> 0; }
      return h.toString(16).padStart(8, "0");
    };
    window.__rx = {
      fnv,
      /** hold the frame loop's step(0) so nothing but the fixture touches the field */
      async hold(fn) {
        const s3 = S.sim3d(), frameStep = s3.step;
        s3.step = () => 0;
        try { await s3.device.queue.onSubmittedWorkDone(); return await fn(s3); }
        finally { s3.step = frameStep; }
      },
      /** a solid single crystal (id 1) with an optional liquid slab z < liquidZ,
       *  painted into both ping-pong sides */
      paint(s3, liquidZ = 0) {
        const n = s3.n, vox = n * n * n;
        const ids = new Uint32Array(vox), st = new Float32Array(vox * 2);
        for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
          const i = (z * n + y) * n + x, liquid = z < liquidZ;
          ids[i] = liquid ? 0 : 1;
          st[i * 2] = liquid ? 0 : 1;
          st[i * 2 + 1] = liquid ? 0.4 : 0;
        }
        for (const dir of [0, 1]) {
          s3.device.queue.writeTexture({ texture: s3.grainTexture(dir) }, ids, { bytesPerRow: n * 4, rowsPerImage: n }, [n, n, n]);
          s3.device.queue.writeTexture({ texture: s3.stateTexture(dir) }, st, { bytesPerRow: n * 8, rowsPerImage: n }, [n, n, n]);
        }
      },
      /** reset at a declared seed onto a single crystal with stored energy H */
      async crystal(seed, H, liquidZ = 0) {
        S.setSeed(seed);
        return this.hold(async s3 => {
          Object.assign(s3.params, { scen: 0, heatIn: 0, twinProb: 0, pPore: 0, alloyOn: 0 });
          s3.reset(0.1);
          this.paint(s3, liquidZ);
          s3.setStored(1, H);
          await s3.device.queue.onSubmittedWorkDone();
          return s3;
        });
      },
      async stats(s3) {
        for (let i = 0; i < 60; i++) { const st = await s3.readStats(); if (st) return st; await new Promise(r => setTimeout(r, 25)); }
        return null;
      },
      /** a deterministic polycrystal (cast3's recipe at a smaller size) */
      async cast(seed = 0x2f6e2b1, seeds = 500) {
        S.setSeed(seed);
        return this.hold(async s3 => {
          await s3.stepSync(0);
          let rs = seed >>> 0;
          const rnd = () => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; };
          Object.assign(s3.params, { scen: 0, heatIn: 0, coolRate: 0.5, alloyOn: 0, twinProb: 0, pPore: 0, noiseAmp: 0.01, aniMode3: 1, facet: 0 });
          s3.reset(1 - 0.9);
          for (let i = 0; i < seeds; i++) s3.addSeed3D(rnd() * s3.n, rnd() * s3.n, rnd() * s3.n, 2.5);
          for (let i = 0; i < Math.ceil(seeds / 128) + 2; i++) await s3.stepSync(0);
          for (let k = 0; k < 250; k++) {
            if ((await s3.stepSync(76)) !== 76) throw new Error("cast budget short");
            if (k % 10 === 9) s3.quench(0.15);
            const st = await this.stats(s3);
            if (st && st.fracSolid > 0.985) break;
          }
          await s3.stepSync(0);
          await s3.device.queue.onSubmittedWorkDone();
          return s3;
        });
      },
    };
  });

  // -------------------------------------------------------------------------
  // RX3-STAMP-COHERENCE
  {
    const out = await page.evaluate(async () => {
      const R = window.__rx, S = window.__solidify;
      const k = 60;
      const run = async seed => {
        const s3 = await R.crystal(seed, 20, 10);
        const before = await s3.readGrainVolume(), phiB = await s3.readPhiVolume();
        const dirB = s3.dir, ctr0 = await s3.readTwinCtr();
        const res = await s3.nucleate(k);
        const ctr1 = await s3.readTwinCtr();
        const after = await s3.readGrainVolume(), phiA = await s3.readPhiVolume();
        return { s3, res, before, after, phiB, phiA, dirB, dirA: s3.dir, ctr0, ctr1 };
      };
      const a = await run(0x1111);
      const { s3, res, before, after, phiB, phiA } = a;
      if ("why" in res) return { refused: res.why };
      const n = s3.n, inRange = id => id >= res.lo && id <= res.hi;
      const per = new Map();
      let outside = 0, liquidHit = 0, phiMoved = 0, nonMatrixOverwritten = 0;
      for (let i = 0; i < after.length; i++) {
        if (phiB[i] !== phiA[i]) phiMoved++;
        if (before[i] !== after[i]) {
          if (!inRange(after[i])) outside++;
          if (phiB[i] < 0.5) liquidHit++;
          if (before[i] !== 1) nonMatrixOverwritten++;
        }
        if (inRange(after[i])) {
          const x = i % n, y = ((i / n) | 0) % n, z = (i / (n * n)) | 0;
          const e = per.get(after[i]) ?? { c: 0, sx: 0, sy: 0, sz: 0, pts: [] };
          e.c++; e.sx += x; e.sy += y; e.sz += z; e.pts.push([x, y, z]);
          per.set(after[i], e);
        }
      }
      let maxVox = 0, maxSpread = 0;
      for (const e of per.values()) {
        maxVox = Math.max(maxVox, e.c);
        const cx = e.sx / e.c, cy = e.sy / e.c, cz = e.sz / e.c;
        for (const p of e.pts) maxSpread = Math.max(maxSpread, Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz));
      }
      // H = 0 for the new ids on the CPU mirror and on the GPU buffer
      const hCPU = s3.storedCPU(), hGPU = await s3.readStored();
      let hNonzero = 0, hMismatch = 0;
      for (let id = res.lo; id <= res.hi; id++) if (hCPU[id] !== 0) hNonzero++;
      for (let i = 0; i < 4096; i++) if (!hGPU || hGPU[i] !== hCPU[i]) hMismatch++;
      // the quaternion mirror the panels read matches the GPU buffer
      const qBefore = Float32Array.from(s3.quats.subarray(res.lo * 4, (res.hi + 1) * 4));
      await s3.refreshQuats();
      const qAfter = s3.quats.subarray(res.lo * 4, (res.hi + 1) * 4);
      let qMismatch = 0;
      for (let i = 0; i < qBefore.length; i++) if (qBefore[i] !== qAfter[i]) qMismatch++;
      const hashA = R.fnv(after);
      const again = await run(0x1111), other = await run(0x2222);
      // geometry against KNOWN centres (random sites are unknown to the test,
      // and a centroid is the wrong reference: a sphere clipped by the liquid
      // slab or a domain face has its centroid pulled away from the clip).
      // Centres on a lattice, some deliberately clipped by z = 10 and x = 0.
      const g = await R.crystal(0x9999, 20, 10);
      const centres = [];
      for (let i = 0; i < 24; i++) centres.push([(i % 6) * 16, 20 + ((i / 6) | 0) * 18, i % 4 === 0 ? 10 : 30 + (i % 5) * 10]);
      const ev = await g.nucleate(centres.length, 2, centres);
      const gv = await g.readGrainVolume();
      let outsideSphere = 0, perMax = 0;
      const cnt = new Map();
      if (!("why" in ev)) for (let i = 0; i < gv.length; i++) {
        const id = gv[i];
        if (id < ev.lo || id > ev.hi) continue;
        const c = centres[id - ev.lo], x = i % n, y = ((i / n) | 0) % n, z = (i / (n * n)) | 0;
        if ((x - c[0]) ** 2 + (y - c[1]) ** 2 + (z - c[2]) ** 2 > 4) outsideSphere++;
        cnt.set(id, (cnt.get(id) ?? 0) + 1);
      }
      for (const v of cnt.values()) perMax = Math.max(perMax, v);
      const clipped = [...cnt.values()].filter(v => v < 33).length;
      return {
        k, lo: res.lo, hi: res.hi, placed: res.placed, allocatorMoved: a.ctr0 - a.ctr1,
        hiIsOldCounter: res.hi === a.ctr0, maxVox, centroidSpreadInfo: +maxSpread.toFixed(2),
        knownCentres: { nuclei: centres.length, placed: cnt.size, outsideSphere, perMax, clipped },
        outside, liquidHit, nonMatrixOverwritten, phiMoved, dirSame: a.dirB === a.dirA,
        hNonzero, hMismatch, qMismatch,
        sameSeedSame: R.fnv(again.after) === hashA, otherSeedDiffers: R.fnv(other.after) !== hashA,
        live: S.sim3d() === s3,
      };
    });
    const ok = !out.refused && out.allocatorMoved === out.k && out.hiIsOldCounter
      && out.placed >= Math.ceil(0.95 * out.k * (86 / 96)) && out.maxVox <= 33
      && out.knownCentres.outsideSphere === 0 && out.knownCentres.perMax <= 33 && out.knownCentres.placed === out.knownCentres.nuclei
      && out.knownCentres.clipped > 0
      && out.outside === 0 && out.liquidHit === 0 && out.nonMatrixOverwritten === 0
      && out.phiMoved === 0 && out.dirSame && out.hNonzero === 0 && out.hMismatch === 0
      && out.qMismatch === 0 && out.sameSeedSame && out.otherSeedDiffers;
    check("RX3-STAMP-COHERENCE", ok, out);
  }

  // -------------------------------------------------------------------------
  // RX3-UNDRIVEN
  {
    const out = await page.evaluate(async () => {
      const R = window.__rx;
      const arm = async (H, uniformNuclei) => {
        const s3 = await R.crystal(0x3333, H);
        const res = await s3.nucleate(40);
        if ("why" in res) return { why: res.why };
        if (uniformNuclei) for (let id = res.lo; id <= res.hi; id++) s3.setStored(id, H);
        const st0 = await R.stats(s3);
        await s3.anneal(30);
        const st1 = await R.stats(s3);
        const g = await s3.readGrainVolume();
        return { x0: st0.rxVox / st0.grainVox, x1: st1.rxVox / st1.grainVox, hash: R.fnv(g) };
      };
      const none = await arm(0, false);
      const uniform = await arm(6, true);
      // zero nuclei: no event at all
      const s3 = await R.crystal(0x3333, 8);
      const zero = await s3.nucleate(0);
      const zeroRange = s3.rxRange;
      // falsification: nuclei born BEFORE deposit are re-deformed by it, and
      // the stamp gate's H = 0 clause must see that
      const s4 = await R.crystal(0x4444, 8);
      const early = await s4.nucleate(20);
      s4.deposit(6);
      let reDeformed = 0;
      if (!("why" in early)) for (let id = early.lo; id <= early.hi; id++) if (s4.storedCPU()[id] !== 0) reDeformed++;
      return { none, uniform, zeroPlaced: zero.placed, zeroRange, earlyCount: "why" in early ? 0 : early.hi - early.lo + 1, reDeformed };
    });
    const ok = out.none.x1 <= out.none.x0 && out.uniform.hash === out.none.hash
      && out.zeroPlaced === 0 && out.zeroRange === null && out.reDeformed === out.earlyCount && out.earlyCount > 0;
    check("RX3-UNDRIVEN", ok, out);
  }

  // -------------------------------------------------------------------------
  // RX3-NUCLEUS-LADDER — one nucleus, centred, in a single crystal
  {
    const out = await page.evaluate(async () => {
      const R = window.__rx;
      const Hs = [0, 4, 6, 8, 12, 20], rows = [];
      for (const r of [1, 2, 3]) {
        const row = { r, v0: null, v: [] };
        for (const H of Hs) {
          const s3 = await R.crystal(0x5555 + r, H);
          const c = s3.n / 2;
          const res = await s3.nucleate(1, r, [[c, c, c]]);
          if ("why" in res) { row.v.push(null); continue; }
          const g0 = await s3.readGrainVolume();
          let v0 = 0; for (let i = 0; i < g0.length; i++) if (g0[i] === res.lo) v0++;
          await s3.anneal(40);
          const g1 = await s3.readGrainVolume();
          let v1 = 0; for (let i = 0; i < g1.length; i++) if (g1[i] === res.lo) v1++;
          row.v0 = v0;
          row.v.push(v1);
          row.hEff = +(H / (1 + s3.storedRec * H)).toFixed(2);
        }
        rows.push(row);
      }
      return { Hs, rows };
    });
    const shrinkAtZero = out.rows.every(r => r.v[0] != null && r.v[0] < r.v0);
    const monotone = out.rows.every(r => r.v.every((v, i) => i === 0 || (v != null && v >= r.v[i - 1])));
    const growsAtTop = out.rows.some(r => r.v[r.v.length - 1] > r.v0);
    const crossover = out.rows.map(r => ({ r: r.r, v0: r.v0, firstGrowingH: out.Hs[r.v.findIndex(v => v > r.v0)] ?? null, final: r.v }));
    check("RX3-NUCLEUS-LADDER", shrinkAtZero && monotone && growsAtTop,
      { shrinkAtZero, monotone, growsAtTop, crossover, note: "T = 0 bond count: r = 2 grows above 12 J_b; recovery lowers the effective H during the 40 sweeps" });
  }

  // -------------------------------------------------------------------------
  // RX3-OFF-IDENTITY + RX3-SAMPLING-INERT — on a real cast
  {
    const out = await page.evaluate(async () => {
      const R = window.__rx;
      const arm = async mode => {
        const s3 = await R.cast();
        s3.deposit(6);
        let census = null;
        if (mode === "zero") await s3.nucleate(0);
        if (mode === "nuclei") {
          const res = await s3.nucleate(200);
          if ("why" in res) return { why: res.why };
        }
        let samples = 0;
        const sample = mode === "zero" ? {
          at: () => true,
          read: async () => { samples++; await R.stats(s3); },
        } : mode === "nuclei" ? {
          at: d => d === 30,
          read: async () => {
            // the stats pass counts an id only where phi > 0.5 (STATS3D_WGSL):
            // the independent recount uses the same definition, from raw fields
            const st = await R.stats(s3), g = await s3.readGrainVolume(), ph = await s3.readPhiVolume();
            const rx = s3.rxRange;
            let rxVox = 0, grainVox = 0;
            for (let i = 0; i < g.length; i++) {
              const id = g[i];
              if (ph[i] > 0.5 && id > 0 && id < 4095) { grainVox++; if (rx && id >= rx.lo && id <= rx.hi) rxVox++; }
            }
            census = { statsRx: st.rxVox, statsGrain: st.grainVox, readRx: rxVox, readGrain: grainVox };
          },
        } : undefined;
        const flips = await s3.anneal(60, undefined, undefined, undefined, sample);
        const g = await s3.readGrainVolume(), h = await s3.readStored();
        return { hash: R.fnv(g), hHash: h ? R.fnv(h) : null, ctr: await s3.readTwinCtr(), qHash: R.fnv(s3.quats), samples, census, flips };
      };
      const plain = await arm("plain"), zero = await arm("zero"), nuclei = await arm("nuclei");
      return { plain, zero, nuclei };
    });
    const ident = out.plain.hash === out.zero.hash && out.plain.hHash === out.zero.hHash
      && out.plain.ctr === out.zero.ctr && out.plain.qHash === out.zero.qHash;
    const differs = out.nuclei.hash !== out.plain.hash;
    check("RX3-OFF-IDENTITY", ident && differs && out.zero.samples === 60,
      { identical: ident, nucleiDiffer: differs, sampledEverySweep: out.zero.samples });
    const c = out.nuclei.census;
    check("RX3-SAMPLING-INERT", !!c && c.statsRx === c.readRx && c.statsGrain === c.readGrain && c.readRx > 0, c);
  }
  // -------------------------------------------------------------------------
  // RX3-JMAK (protocol: tasks/todo.md, "Declutter, then finish C3b and D3")
  {
    const SWEEPS = 70, EVERY = 2, LO = 16, HI = 80;
    const runs = [];
    for (const seed of [0xa1, 0xa2, 0xa3]) {
      const out = await page.evaluate(async (seed, SWEEPS, EVERY, LO, HI) => {
        const R = window.__rx;
        const series = async (mode) => {
          const s3 = await R.crystal(seed, 20);
          const n = s3.n, c = n / 2;
          const ev = mode === "one" ? await s3.nucleate(1, 2, [[c, c, c]]) : await s3.nucleate(150);
          if ("why" in ev) return { why: ev.why };
          const S = [], Y = [];
          const read = async d => {
            const g = await s3.readGrainVolume();
            if (mode === "one") { let v = 0; for (let i = 0; i < g.length; i++) if (g[i] === ev.lo) v++; S.push(d); Y.push(v); return; }
            let inn = 0, tot = 0;
            for (let z = LO; z < HI; z++) for (let y = LO; y < HI; y++) for (let x = LO; x < HI; x++) {
              const id = g[(z * n + y) * n + x]; tot++; if (id >= ev.lo && id <= ev.hi) inn++;
            }
            S.push(d); Y.push(inn / tot);
          };
          await read(0);
          await s3.anneal(SWEEPS, undefined, undefined, undefined, { at: d => d % EVERY === 0, read });
          return { S, Y, placed: ev.placed };
        };
        const one = await series("one"), many = await series("many");
        return { seed, one, many };
      }, seed, SWEEPS, EVERY, LO, HI);
      if (out.one.why || out.many.why) { runs.push({ seed, why: out.one.why ?? out.many.why }); continue; }
      // pair the samples by sweep: V1 from the lone nucleus, X from the interior
      const V1 = [], Xi = [];
      out.many.S.forEach((d, k) => { const j = out.one.S.indexOf(d); if (j >= 0 && out.one.Y[j] > 0) { V1.push(out.one.Y[j]); Xi.push(out.many.Y[k]); } });
      const fit = RX.avramiFit(V1, Xi, [0.05, 0.95], 0);
      const fitS = RX.avramiFit(out.many.S.filter(d => d > 0), out.many.Y.filter((_, k) => out.many.S[k] > 0), [0.05, 0.95], 0);
      runs.push({ seed, placed: out.many.placed, slopeV1: "why" in fit ? null : +fit.n.toFixed(4), points: "why" in fit ? 0 : fit.used,
        why: "why" in fit ? fit.why : undefined, xEnd: +out.many.Y[out.many.Y.length - 1].toFixed(4),
        nVsSweeps: "why" in fitS ? null : +fitS.n.toFixed(3), v1End: out.one.Y[out.one.Y.length - 1] });
    }
    const ok = runs.length === 3 && runs.every(r => r.slopeV1 != null && Math.abs(r.slopeV1 - 1) <= 0.15 && r.points >= 5 && r.xEnd >= 0.95);
    check("RX3-JMAK", ok, { band: "slope vs ln V1 within 1 +- 0.15, >= 5 points, interior X_end >= 0.95", runs });
  }

  // -------------------------------------------------------------------------
  // RX3-CAST-SELECTION (protocol: tasks/todo.md)
  {
    const casts = [];
    for (const seed of [0xc1, 0xc2, 0xc3]) {
      const out = await page.evaluate(async (seed) => {
        const R = window.__rx;
        const arm = async (uniform) => {
          const s3 = await R.cast(seed);
          const n = s3.n;
          s3.deposit(10);
          const Hlabel = Float32Array.from(s3.storedCPU());   // the fabric's H: the quartile key in both arms
          if (uniform) for (let id = 1; id < 4095; id++) s3.setStored(id, 10);
          const g0 = await s3.readGrainVolume(), p0 = await s3.readPhiVolume();
          let rs = Math.imul(seed, 2654435761) >>> 0;
          const rnd = () => { rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0; return rs / 4294967296; };
          const centres = Array.from({ length: 200 }, () => [Math.floor(rnd() * n), Math.floor(rnd() * n), Math.floor(rnd() * n)]);
          const ev = await s3.nucleate(200, 2, centres);
          if ("why" in ev) return { why: ev.why };
          const g1 = await s3.readGrainVolume();
          await s3.anneal(60);
          const g2 = await s3.readGrainVolume();
          // per matrix grain: X = share of its pre-nucleation voxels now in a nucleus
          const N = new Map(), Rn = new Map();
          for (let i = 0; i < g0.length; i++) {
            const id = g0[i];
            if (id === 0 || id === 4095 || p0[i] < 0.5) continue;
            N.set(id, (N.get(id) ?? 0) + 1);
            if (g2[i] >= ev.lo && g2[i] <= ev.hi) Rn.set(id, (Rn.get(id) ?? 0) + 1);
          }
          const grains = [...N.entries()].filter(([, c]) => c >= 64).map(([id, c]) => ({ H: Hlabel[id], X: (Rn.get(id) ?? 0) / c }));
          grains.sort((a, b) => a.H - b.H);
          const q = Math.floor(grains.length / 4);
          const mean = a => a.reduce((s, g) => s + g.X, 0) / Math.max(1, a.length);
          const D = mean(grains.slice(grains.length - q)) - mean(grains.slice(0, q));
          // births: did the sphere touch >= 2 matrix ids; survival: grew past birth
          const v0 = new Map(), v2 = new Map();
          for (let i = 0; i < g1.length; i++) {
            if (g1[i] >= ev.lo && g1[i] <= ev.hi) v0.set(g1[i], (v0.get(g1[i]) ?? 0) + 1);
            if (g2[i] >= ev.lo && g2[i] <= ev.hi) v2.set(g2[i], (v2.get(g2[i]) ?? 0) + 1);
          }
          const birth = [];
          for (let k = 0; k < centres.length; k++) {
            const [cx, cy, cz] = centres[k], id = ev.lo + k, ids = new Set();
            for (let dz = -2; dz <= 2; dz++) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
              if (dx * dx + dy * dy + dz * dz > 4) continue;
              const x = cx + dx, y = cy + dy, z = cz + dz;
              if (x < 0 || y < 0 || z < 0 || x >= n || y >= n || z >= n) continue;
              const j = (z * n + y) * n + x, m = g0[j];
              if (m !== 0 && m !== 4095 && p0[j] >= 0.5) ids.add(m);
            }
            const b0 = v0.get(id) ?? 0;
            if (b0 > 0) birth.push({ boundary: ids.size >= 2, survived: (v2.get(id) ?? 0) > b0 });
          }
          return { D, grains: grains.length, birth };
        };
        const worked = await arm(false), control = await arm(true);
        return { seed, worked, control };
      }, seed);
      casts.push(out);
    }
    const per = casts.map(c => c.worked.why || c.control.why ? { seed: c.seed, why: c.worked.why ?? c.control.why }
      : { seed: c.seed, D: +c.worked.D.toFixed(4), Dcontrol: +c.control.D.toFixed(4), grains: c.worked.grains,
          pass: c.worked.D > 0 && c.worked.D >= 3 * Math.abs(c.control.D) });
    // pooled over the three worked casts (direction only)
    const all = casts.flatMap(c => c.worked.birth ?? []);
    const surv = all.filter(b => b.survived);
    const fracAll = all.filter(b => b.boundary).length / Math.max(1, all.length);
    const fracSurv = surv.filter(b => b.boundary).length / Math.max(1, surv.length);
    const ok = per.every(p => p.pass) && surv.length > 0 && fracSurv > fracAll;
    check("RX3-CAST-SELECTION", ok, { per, births: all.length, survivors: surv.length,
      boundaryShare: { allPlaced: +fracAll.toFixed(3), survivors: +fracSurv.toFixed(3) } });
  }
} catch (e) {
  console.log("RX3 harness error", String(e?.stack ?? e));
  FAIL();
} finally {
  console.log("PAGE ERRORS:", errors.length ? JSON.stringify(errors.slice(0, 8)) : "none");
  if (errors.length) FAIL();
  await closeBrowser(browser);
}
console.log(failures ? `done — ${failures} FAILED` : "done");
process.exit(failures ? 1 : 0);
