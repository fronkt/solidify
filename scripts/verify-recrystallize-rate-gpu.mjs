import { closeBrowser } from "./browser-cleanup.mjs";
// RX3-RATE-* / RX3-BOUNDARY-* / RX3-MODES-PANEL — C3b-3 (constant-rate
// nucleation) and C3b-4a (grain-boundary sites) on a real GPU.
//
// Design: docs/C3B-RECRYSTALLIZATION-DESIGN.md section 6. Every gate below was
// PRE-REGISTERED in tasks/todo.md ("C3b-3 and C3b-4a - 2026-11-07") and
// committed before its first run; the CPU halves (the schedule, the boundary
// classifier, the union-of-balls models, the share tuple) are
// verify-recrystallize.mjs.
//
//   RX3-RATE-SCHEDULE    structural: every batch is born at its sweep, a
//                        nucleus is a phantom exactly when its centre was
//                        already recrystallized, no id appears before its
//                        batch, one batch at sweep 0 IS the at-once event bit
//                        for bit, and an aborted anneal leaves its later
//                        batches unborn.
//   RX3-RATE-JMAK        kinetics: ln(-ln(1-X)) against ln X_ext has slope 1,
//                        X_ext built from the actual schedule (phantoms
//                        counted) and V(t_b, S) MEASURED on a lone nucleus born
//                        at each batch sweep; the site-saturated construction
//                        must miss (> 1.15).
//   RX3-BOUNDARY-SITES   structural: boundary-mode centres all sit on voxels
//                        an independent in-page classifier calls boundary;
//                        random sites must not; steady boundary events keep it
//                        and their phantoms out of the field; a single crystal
//                        with a free surface refuses.
//   RX3-BOUNDARY-JMAK    kinetics on a one-drive Voronoi polycrystal: X against
//                        the union of the measured free-growth shape about the
//                        actual centres has slope 1 for boundary AND random
//                        sites; the Poisson construction keeps 1 for random
//                        sites and must miss (< 0.85) for boundary sites.
//   RX3-MODES-PANEL      the nucleation select end to end through the heat
//                        treatment panel: seven dials and one select, the
//                        8-element share tuple, the card's clause against the
//                        sim's event log, and legacy restores.
//
//   node scripts/verify-recrystallize-rate-gpu.mjs [outDir] [port]
import puppeteer from "puppeteer-core";
import { createServer } from "vite";

// the fit and the schedule the card and the sim use, loaded rather than retyped
const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const RX = await vite.ssrLoadModule("/src/recrystallize.ts");
const HS = await vite.ssrLoadModule("/src/heatshare.ts");
await vite.close();

const PORT = process.argv[3] ?? "5199";
let failures = 0;
const FAIL = () => { failures++; return "FAIL"; };
const check = (name, ok, detail) =>
  console.log(name, ok ? "OK" : FAIL(), detail === undefined ? "" : JSON.stringify(detail));
const slopeOf = f => ("why" in f ? null : Number(f.n.toFixed(4)));

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
    // verify-recrystallize.mjs RX-BOUNDARY-CPU's generator, byte for byte
    const mulberry = seed => {
      let s = seed >>> 0;
      return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    };
    window.__rr = {
      fnv,
      /** hold the frame loop's step(0) so nothing but the fixture touches the field */
      async hold(fn) {
        const s3 = S.sim3d(), frameStep = s3.step;
        s3.step = () => 0;
        try { await s3.device.queue.onSubmittedWorkDone(); return await fn(s3); }
        finally { s3.step = frameStep; }
      },
      /** paint ids (and phi = 1 where id > 0, liquid elsewhere) into both ping-pong sides */
      paintIds(s3, ids) {
        const n = s3.n, vox = n * n * n, st = new Float32Array(vox * 2);
        for (let i = 0; i < vox; i++) { const solid = ids[i] !== 0; st[i * 2] = solid ? 1 : 0; st[i * 2 + 1] = solid ? 0 : 0.4; }
        for (const dir of [0, 1]) {
          s3.device.queue.writeTexture({ texture: s3.grainTexture(dir) }, ids, { bytesPerRow: n * 4, rowsPerImage: n }, [n, n, n]);
          s3.device.queue.writeTexture({ texture: s3.stateTexture(dir) }, st, { bytesPerRow: n * 8, rowsPerImage: n }, [n, n, n]);
        }
      },
      /** reset at a declared seed onto a single crystal (id 1) at stored energy H,
       *  liquid below liquidZ */
      async crystal(seed, H, liquidZ = 0) {
        S.setSeed(seed);
        return this.hold(async s3 => {
          Object.assign(s3.params, { scen: 0, heatIn: 0, twinProb: 0, pPore: 0, alloyOn: 0 });
          s3.reset(0.1);
          const n = s3.n, ids = new Uint32Array(n * n * n);
          for (let z = 0; z < n; z++) for (let i = 0; i < n * n; i++) ids[z * n * n + i] = z < liquidZ ? 0 : 1;
          this.paintIds(s3, ids);
          s3.setStored(1, H);
          await s3.device.queue.onSubmittedWorkDone();
          return s3;
        });
      },
      /** a G-grain Voronoi polycrystal (RX-BOUNDARY-CPU's labels), all solid,
       *  every grain at ONE stored energy H; returns the ids it painted */
      async voronoi(seed, G, H) {
        S.setSeed(seed);
        return this.hold(async s3 => {
          Object.assign(s3.params, { scen: 0, heatIn: 0, twinProb: 0, pPore: 0, alloyOn: 0 });
          s3.reset(0.1);
          const n = s3.n, r = mulberry(seed);
          const pts = Array.from({ length: G }, () => [r() * n, r() * n, r() * n]);
          const ids = new Uint32Array(n * n * n);
          for (let z = 0, i = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++, i++) {
            let best = Infinity, bi = 0;
            for (let g = 0; g < G; g++) {
              const d = (x + 0.5 - pts[g][0]) ** 2 + (y + 0.5 - pts[g][1]) ** 2 + (z + 0.5 - pts[g][2]) ** 2;
              if (d < best) { best = d; bi = g; }
            }
            ids[i] = bi + 1;
          }
          this.paintIds(s3, ids);
          for (let g = 1; g <= G; g++) s3.setStored(g, H);
          await s3.device.queue.onSubmittedWorkDone();
          return s3;
        });
      },
      /** INDEPENDENT boundary classifier (not recrystallize.ts): treatable =
       *  phi >= 0.5 and id not 0 or 4095 (no mould in these fixtures); a site
       *  has a treatable 26-neighbour inside the domain with another id */
      classify(ids, phi, n) {
        const ok = i => phi[i] >= 0.5 && ids[i] !== 0 && ids[i] !== 4095;
        const mark = new Uint8Array(n * n * n);
        let count = 0;
        for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
          const i = (z * n + y) * n + x;
          if (!ok(i)) continue;
          let b = false;
          for (let dz = -1; dz <= 1 && !b; dz++) for (let dy = -1; dy <= 1 && !b; dy++) for (let dx = -1; dx <= 1 && !b; dx++) {
            if (!dx && !dy && !dz) continue;
            const X = x + dx, Y = y + dy, Z = z + dz;
            if (X < 0 || Y < 0 || Z < 0 || X >= n || Y >= n || Z >= n) continue;
            const j = (Z * n + Y) * n + X;
            if (ok(j) && ids[j] !== ids[i]) b = true;
          }
          if (b) { mark[i] = 1; count++; }
        }
        return { mark, count };
      },
      /** fraction of the interior box [lo, hi)^3 carrying an id in [a, b] */
      boxFrac(g, n, a, b, lo = 16, hi = 80) {
        let inn = 0, tot = 0;
        for (let z = lo; z < hi; z++) for (let y = lo; y < hi; y++) for (let x = lo; x < hi; x++) {
          const id = g[(z * n + y) * n + x]; tot++; if (id >= a && id <= b) inn++;
        }
        return inn / tot;
      },
      async stats(s3) {
        for (let i = 0; i < 60; i++) { const st = await s3.readStats(); if (st) return st; await new Promise(r => setTimeout(r, 25)); }
        return null;
      },
      /** a deterministic polycrystal (verify-recrystallize-gpu's cast recipe) */
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
  // RX3-RATE-SCHEDULE (structural; protocol in tasks/todo.md)
  {
    const out = await page.evaluate(async () => {
      const R = window.__rr;
      const PHANTOM = 2, STAMPED = 1, UNBORN = 3;
      // (1)-(4) the steady event, the field read before each batch's births
      const steady = await R.crystal(0xa1, 20).then(s3 => R.hold(async () => {
        const n = s3.n, g0 = await s3.readGrainVolume();
        const ev = await s3.nucleateEvent(400, { window: 24, batches: 8 });
        if ("why" in ev) return { why: ev.why };
        const log = s3.rxLog, reads = new Map([[0, g0]]);
        const due = new Set(log.batches.map(b => b.sweep).filter(s => s > 0));
        await s3.anneal(30, undefined, undefined, undefined, { at: d => due.has(d) || d === 30, read: async d => { reads.set(d, await s3.readGrainVolume()); } });
        const k = log.hi - log.lo + 1, batchOf = new Int32Array(k);
        log.batches.forEach((b, bi) => { for (let id = b.lo; id <= b.hi; id++) batchOf[id - log.lo] = bi; });
        // the read at a batch's sweep is the field its births were tested on
        // (samples run before births; sweep 0's is the read before the event)
        let disagree = 0, early = 0, phantomSeen = 0;
        for (const b of log.batches) {
          const F = reads.get(b.sweep);
          if (!F) { disagree += b.hi - b.lo + 1; continue; }
          for (let id = b.lo; id <= b.hi; id++) {
            const i = id - log.lo;
            const x = log.centre[i * 3], y = log.centre[i * 3 + 1], z = log.centre[i * 3 + 2];
            const cur = F[(z * n + y) * n + x], was = cur >= log.lo && cur <= log.hi;
            const st = log.state[i];
            if (was ? st !== PHANTOM : st !== STAMPED) disagree++;
          }
        }
        // a read at sweep d precedes the births at d: no id of a batch due at
        // or after d may be in it, and no phantom id may be in any read
        for (const [d, g] of reads) for (let v = 0; v < g.length; v++) {
          const id = g[v];
          if (id < log.lo || id > log.hi) continue;
          const i = id - log.lo;
          if (log.batches[batchOf[i]].sweep >= d) early++;
          if (log.state[i] === PHANTOM) phantomSeen++;
        }
        return {
          k, lo: ev.lo, hi: ev.hi, sweeps: log.batches.map(b => b.sweep), counts: log.batches.map(b => b.hi - b.lo + 1),
          states: log.batches.map(b => b.state), stamped: log.batches.map(b => b.stamped), phantoms: log.batches.map(b => b.phantom),
          disagree, early, phantomSeen, finalHash: R.fnv(reads.get(30)), readsTaken: [...reads.keys()],
        };
      }));
      // (5) identity: one batch at sweep 0 on random sites against nucleate()
      const arm = async useEvent => {
        const s3 = await R.crystal(0xa1, 20);
        return R.hold(async () => {
          const ev = useEvent ? await s3.nucleateEvent(400, { window: 0 }) : await s3.nucleate(400);
          if ("why" in ev) return { why: ev.why };
          await s3.anneal(30);
          const g = await s3.readGrainVolume(), h = await s3.readStored();
          return { hash: R.fnv(g), hHash: h ? R.fnv(h) : null, qHash: R.fnv(s3.quats), ctr: await s3.readTwinCtr(), lo: ev.lo, hi: ev.hi,
            batches: useEvent ? s3.rxLog?.batches.length : null };
        });
      };
      const legacy = await arm(false), event = await arm(true);
      // (6) abort at the first drain (8 sweeps)
      const abort = await R.crystal(0xa1, 20).then(s3 => R.hold(async () => {
        const ev = await s3.nucleateEvent(400, { window: 24, batches: 8 });
        if ("why" in ev) return { why: ev.why };
        const log = s3.rxLog;
        const delivered = await s3.anneal(30, undefined, d => d < 8);
        const born = log.batches.filter(b => b.state === "born").map(b => b.sweep);
        let unbornNuclei = 0;
        for (let i = 0; i < log.state.length; i++) if (log.state[i] === UNBORN) unbornNuclei++;
        const unbornIds = log.batches.filter(b => b.state === "unborn");
        await s3.anneal(10);
        const g = await s3.readGrainVolume();
        let unbornSeen = 0;
        for (let v = 0; v < g.length; v++) if (unbornIds.some(b => g[v] >= b.lo && g[v] <= b.hi)) unbornSeen++;
        const noLateBirths = s3.rxLog === log && log.batches.filter(b => b.state === "born").length === born.length;
        return { delivered, born, unbornNuclei, unbornSeen, noLateBirths };
      }));
      return { steady, legacy, event, abort };
    });
    const st = out.steady, ab = out.abort;
    const scheduleOk = !st.why && st.k === 400 && st.hi - st.lo + 1 === 400 && st.sweeps.join() === "0,3,6,9,12,15,18,21"
      && st.counts.every(c => c === 50) && st.states.every(s => s === "born");
    const phantomRule = !st.why && st.disagree === 0;
    const order = !st.why && st.early === 0 && st.phantomSeen === 0;
    const live = !st.why && st.phantoms.reduce((a, b) => a + b, 0) > 0 && st.stamped.every(s => s > 0);
    const identity = !out.legacy.why && !out.event.why && out.legacy.hash === out.event.hash && out.legacy.hHash === out.event.hHash
      && out.legacy.qHash === out.event.qHash && out.legacy.ctr === out.event.ctr && out.legacy.lo === out.event.lo
      && out.legacy.hi === out.event.hi && out.event.batches === 1;
    const timingReaches = !st.why && !out.legacy.why && st.finalHash !== out.legacy.hash;
    const aborted = !ab.why && ab.delivered === 8 && ab.born.join() === "0,3,6" && ab.unbornNuclei === 250 && ab.unbornSeen === 0 && ab.noLateBirths;
    check("RX3-RATE-SCHEDULE", scheduleOk && phantomRule && order && live && identity && timingReaches && aborted, {
      scheduleOk, phantomRule, order, live, identity, timingReaches, aborted,
      steady: st.why ? st : { sweeps: st.sweeps, stamped: st.stamped, phantoms: st.phantoms, disagree: st.disagree, early: st.early, phantomSeen: st.phantomSeen },
      legacy: out.legacy, event: out.event, abort: ab,
    });
  }

  // -------------------------------------------------------------------------
  // RX3-RATE-JMAK (kinetics; protocol in tasks/todo.md)
  {
    const SWEEPS = 70, LO = 16, HI = 80;
    const sched = RX.birthSchedule(400, 24, 8);
    // reference: one nucleus at the centre, born at each batch sweep; seed-independent
    const ref = await page.evaluate(async (sched, SWEEPS) => {
      const R = window.__rr, out = [];
      for (const b of sched) {
        const s3 = await R.crystal(0xa1, 20);
        const r = await R.hold(async () => {
          const c = s3.n / 2;
          const ev = await s3.nucleateEvent(1, { schedule: [{ sweep: b.sweep, count: 1 }], at: [[c, c, c]] });
          if ("why" in ev) return { why: ev.why };
          const V = new Array(SWEEPS + 1).fill(0);
          const count = async d => { const g = await s3.readGrainVolume(); let v = 0; for (let i = 0; i < g.length; i++) if (g[i] === ev.lo) v++; V[d] = v; };
          await count(0);
          // every sweep for the batch born at 0 (the age-shifted info arm needs
          // odd ages), every second sweep otherwise
          await s3.anneal(SWEEPS, undefined, undefined, undefined, { at: d => b.sweep === 0 || d % 2 === 0, read: count });
          return { V, state: s3.rxLog?.batches[0]?.state };
        });
        out.push({ sweep: b.sweep, ...r });
      }
      return out;
    }, sched, SWEEPS);
    const runs = [];
    if (ref.some(r => r.why)) runs.push({ why: ref.find(r => r.why).why });
    else for (const seed of [0xa1, 0xa2, 0xa3]) {
      const many = await page.evaluate(async (seed, SWEEPS, LO, HI) => {
        const R = window.__rr;
        const s3 = await R.crystal(seed, 20);
        return R.hold(async () => {
          const ev = await s3.nucleateEvent(400, { window: 24, batches: 8 });
          if ("why" in ev) return { why: ev.why };
          const S = [], Xs = [];
          const read = async d => { S.push(d); Xs.push(R.boxFrac(await s3.readGrainVolume(), s3.n, ev.lo, ev.hi, LO, HI)); };
          await read(0);
          await s3.anneal(SWEEPS, undefined, undefined, undefined, { at: d => d % 2 === 0, read });
          const log = s3.rxLog;
          return { S, X: Xs, placed: log.batches.reduce((a, b) => a + b.placed, 0), phantoms: log.batches.reduce((a, b) => a + b.phantom, 0),
            born: log.batches.filter(b => b.state === "born").length };
        });
      }, seed, SWEEPS, LO, HI);
      if (many.why) { runs.push({ seed, why: many.why }); continue; }
      const V = 96 ** 3;
      const ext = many.S.map(s => sched.reduce((a, b, bi) => a + b.count * (ref[bi].V[s] ?? 0), 0) / V);
      const wrong = many.S.map(s => (400 * (ref[0].V[s] ?? 0)) / V);
      const aged = many.S.map(s => sched.reduce((a, b) => a + (s > b.sweep ? b.count * (ref[0].V[s - b.sweep] ?? 0) : 0), 0) / V);
      const use = many.S.map((s, k) => k).filter(k => many.S[k] > 0 && ext[k] > 0);
      const fit = RX.avramiFit(use.map(k => ext[k]), use.map(k => many.X[k]), [0.05, 0.95], 0);
      const fitW = RX.avramiFit(use.map(k => wrong[k]), use.map(k => many.X[k]), [0.05, 0.95], 0);
      const useA = use.filter(k => aged[k] > 0);
      const fitA = RX.avramiFit(useA.map(k => aged[k]), useA.map(k => many.X[k]), [0.05, 0.95], 0);
      const fitS = RX.avramiFit(use.map(k => many.S[k]), use.map(k => many.X[k]), [0.05, 0.95], 0);
      const win = use.filter(k => many.X[k] >= 0.05 && many.X[k] <= 0.95);
      const ratio = win.length ? win.reduce((a, k) => a + -Math.log(1 - many.X[k]) / ext[k], 0) / win.length : null;
      runs.push({ seed, placed: many.placed, phantoms: many.phantoms, born: many.born, xEnd: Number(many.X[many.X.length - 1].toFixed(4)),
        slope: slopeOf(fit), points: "why" in fit ? 0 : fit.used, why: "why" in fit ? fit.why : undefined,
        siteSaturated: slopeOf(fitW), info: { nSweeps: slopeOf(fitS), ageShifted: slopeOf(fitA), meanRatio: ratio == null ? null : Number(ratio.toFixed(3)) } });
    }
    const ok = runs.length === 3 && runs.every(r => !r.why && r.slope != null && Math.abs(r.slope - 1) <= 0.15 && r.points >= 5
      && r.xEnd >= 0.95 && r.phantoms > 0 && r.born === 8 && r.siteSaturated != null && r.siteSaturated > 1.15);
    check("RX3-RATE-JMAK", ok, {
      band: "slope vs ln X_ext 1 +- 0.15, >= 5 points, X_end >= 0.95, phantoms > 0, 8 batches born; site-saturated construction must exceed 1.15",
      reference: ref.map(r => ({ born: r.sweep, state: r.state, vAt: [r.V?.[r.sweep + 2], r.V?.[40], r.V?.[70]] })), runs,
    });
  }

  // -------------------------------------------------------------------------
  // RX3-BOUNDARY-SITES (structural; protocol in tasks/todo.md)
  {
    const out = await page.evaluate(async () => {
      const R = window.__rr, PHANTOM = 2;
      const field = async s3 => {
        const ids = await s3.readGrainVolume(), phi = await s3.readPhiVolume();
        return R.classify(ids, phi, s3.n);
      };
      const centresIn = (log, mark, n) => {
        let inB = 0;
        const k = log.hi - log.lo + 1;
        for (let i = 0; i < k; i++) {
          const x = log.centre[i * 3], y = log.centre[i * 3 + 1], z = log.centre[i * 3 + 2];
          if (mark[(z * n + y) * n + x]) inB++;
        }
        return { inB, k };
      };
      const voro = () => R.voronoi(0xb1, 12, 20);
      // arm 1: boundary sites, at once
      const a1 = await voro().then(s3 => R.hold(async () => {
        const B = await field(s3);
        const ev = await s3.nucleateEvent(600, { sites: "boundary" });
        if ("why" in ev) return { why: ev.why };
        const c = centresIn(s3.rxLog, B.mark, s3.n);
        return { B: B.count, simB: s3.rxLog.boundarySites, misses: c.k - c.inB, k: c.k, placed: ev.placed,
          centres: Array.from(s3.rxLog.centre) };
      }));
      // arm 2 (must fail the all-in-B clause): random sites on the same field
      const a2 = await voro().then(s3 => R.hold(async () => {
        const B = await field(s3);
        const ev = await s3.nucleateEvent(600, {});
        if ("why" in ev) return { why: ev.why };
        const c = centresIn(s3.rxLog, B.mark, s3.n);
        return { fracInB: c.inB / c.k, voxFrac: B.count / s3.n ** 3 };
      }));
      // arm 3: boundary sites at a steady rate
      const a3 = await voro().then(s3 => R.hold(async () => {
        const B = await field(s3);
        const ev = await s3.nucleateEvent(600, { sites: "boundary", window: 24, batches: 8 });
        if ("why" in ev) return { why: ev.why };
        const log = s3.rxLog;
        await s3.anneal(30);
        const c = centresIn(log, B.mark, s3.n);
        const g = await s3.readGrainVolume();
        let phantomSeen = 0;
        for (let v = 0; v < g.length; v++) { const id = g[v]; if (id >= log.lo && id <= log.hi && log.state[id - log.lo] === PHANTOM) phantomSeen++; }
        return { misses: c.k - c.inB, phantoms: log.batches.reduce((a, b) => a + b.phantom, 0), phantomSeen,
          born: log.batches.filter(b => b.state === "born").length };
      }));
      // arm 4: a single crystal with a free surface has no grain boundary
      const a4 = await R.crystal(0x3333, 20, 10).then(s3 => R.hold(async () => {
        const c0 = await s3.readTwinCtr();
        const ev = await s3.nucleateEvent(50, { sites: "boundary" });
        return { refused: "why" in ev, why: ev.why ?? null, counterSame: (await s3.readTwinCtr()) === c0, range: s3.rxRange };
      }));
      // arm 5: the same seed draws the same boundary centres
      const a5 = await voro().then(s3 => R.hold(async () => {
        const ev = await s3.nucleateEvent(600, { sites: "boundary" });
        return "why" in ev ? { why: ev.why } : { centres: Array.from(s3.rxLog.centre) };
      }));
      const sameCentres = !a1.why && !a5.why && a1.centres.length === a5.centres.length && a1.centres.every((v, i) => v === a5.centres[i]);
      delete a1.centres;
      return { a1, a2, a3, a4, sameCentres };
    });
    const onB = !out.a1.why && out.a1.misses === 0 && out.a1.simB === out.a1.B && out.a1.B > 0 && out.a1.placed >= 540;
    const randomMisses = !out.a2.why && out.a2.fracInB < 0.5;
    const steadyOnB = !out.a3.why && out.a3.misses === 0 && out.a3.phantoms > 0 && out.a3.phantomSeen === 0;
    const refuses = out.a4.refused && out.a4.counterSame;
    check("RX3-BOUNDARY-SITES", onB && randomMisses && steadyOnB && refuses && out.sameCentres, {
      onBoundary: onB, randomControlMisses: randomMisses, steadyOnBoundary: steadyOnB, singleCrystalRefuses: refuses, sameCentres: out.sameCentres, ...out,
    });
  }

  // -------------------------------------------------------------------------
  // RX3-BOUNDARY-JMAK (kinetics; protocol in tasks/todo.md)
  {
    const SWEEPS = 70, LO = 16, HI = 80, N = 600;
    // the reference: one nucleus at the centre of a single crystal (C3b's own
    // nucleate path), its volume and its voxel set as offsets at every sample
    const ref = await page.evaluate(async (SWEEPS) => {
      const R = window.__rr;
      const s3 = await R.crystal(0xa1, 20);
      return R.hold(async () => {
        const n = s3.n, c = n / 2;
        const ev = await s3.nucleate(1, 2, [[c, c, c]]);
        if ("why" in ev) return { why: ev.why };
        const S = [], V1 = [];
        window.__rrShape = [];
        const read = async d => {
          const g = await s3.readGrainVolume(), off = [];
          for (let i = 0; i < g.length; i++) if (g[i] === ev.lo) off.push(i % n - c, Math.floor(i / n) % n - c, Math.floor(i / (n * n)) - c);
          S.push(d); V1.push(off.length / 3); window.__rrShape.push(Int16Array.from(off));
        };
        await read(0);
        await s3.anneal(SWEEPS, undefined, undefined, undefined, { at: d => d % 2 === 0, read });
        return { S, V1 };
      });
    }, SWEEPS);
    const runs = [];
    if (ref.why) runs.push({ why: ref.why });
    else for (const seed of [0xb1, 0xb2, 0xb3]) {
      const arms = {};
      for (const sites of ["boundary", "random"]) {
        arms[sites] = await page.evaluate(async (seed, sites, SWEEPS, LO, HI, N) => {
          const R = window.__rr;
          const s3 = await R.voronoi(seed, 12, 20);
          return R.hold(async () => {
            const n = s3.n;
            const ev = await s3.nucleateEvent(N, { sites });
            if ("why" in ev) return { why: ev.why };
            const log = s3.rxLog, X = [];
            // placed centres: the ids that claimed a voxel in the post-stamp field
            const g1 = await s3.readGrainVolume(), has = new Uint8Array(log.hi - log.lo + 1);
            for (let v = 0; v < g1.length; v++) if (g1[v] >= log.lo && g1[v] <= log.hi) has[g1[v] - log.lo] = 1;
            const centres = [];
            for (let i = 0; i < has.length; i++) if (has[i]) centres.push([log.centre[i * 3], log.centre[i * 3 + 1], log.centre[i * 3 + 2]]);
            const read = async () => { X.push(R.boxFrac(await s3.readGrainVolume(), n, ev.lo, ev.hi, LO, HI)); };
            await read();
            await s3.anneal(SWEEPS, undefined, undefined, undefined, { at: d => d % 2 === 0, read });
            // the union of the reference set at each sample about every placed
            // centre, over the box; only where X is inside the fit window
            const B = HI - LO, U = [];
            for (let k = 0; k < X.length; k++) {
              if (X[k] < 0.05 || X[k] > 0.95) { U.push(null); continue; }
              const off = window.__rrShape[k], mark = new Uint8Array(B * B * B);
              let cov = 0;
              for (const [cx, cy, cz] of centres) for (let j = 0; j < off.length; j += 3) {
                const x = cx + off[j] - LO, y = cy + off[j + 1] - LO, z = cz + off[j + 2] - LO;
                if (x < 0 || y < 0 || z < 0 || x >= B || y >= B || z >= B) continue;
                const m = (z * B + y) * B + x;
                if (!mark[m]) { mark[m] = 1; cov++; }
              }
              U.push(cov / (B * B * B));
            }
            return { X, U, placed: centres.length };
          });
        }, seed, sites, SWEEPS, LO, HI, N);
      }
      const row = { seed };
      for (const [sites, a] of Object.entries(arms)) {
        if (a.why) { row[sites] = { why: a.why }; continue; }
        const ku = a.U.map((u, k) => k).filter(k => a.U[k] != null && a.U[k] > 0 && a.U[k] < 1);
        const fitU = RX.avramiFit(ku.map(k => -Math.log(1 - a.U[k])), ku.map(k => a.X[k]), [0.05, 0.95], 0);
        const kv = ref.S.map((s, k) => k).filter(k => ref.V1[k] > 0);
        const fitP = RX.avramiFit(kv.map(k => ref.V1[k]), kv.map(k => a.X[k]), [0.05, 0.95], 0);
        const ks = ref.S.map((s, k) => k).filter(k => ref.S[k] > 0);
        const fitS = RX.avramiFit(ks.map(k => ref.S[k]), ks.map(k => a.X[k]), [0.05, 0.95], 0);
        row[sites] = { placed: a.placed, xEnd: Number(a.X[a.X.length - 1].toFixed(4)), unionSlope: slopeOf(fitU), unionPoints: "why" in fitU ? 0 : fitU.used,
          poissonSlope: slopeOf(fitP), poissonPoints: "why" in fitP ? 0 : fitP.used, info: { nSweeps: slopeOf(fitS) } };
      }
      runs.push(row);
    }
    const band = v => v != null && Math.abs(v - 1) <= 0.15;
    const ok = runs.length === 3 && runs.every(r => !r.why && r.boundary && r.random && !r.boundary.why && !r.random.why
      && band(r.boundary.unionSlope) && r.boundary.unionPoints >= 5 && band(r.random.unionSlope) && r.random.unionPoints >= 5
      && band(r.random.poissonSlope) && r.random.poissonPoints >= 5 && r.boundary.xEnd >= 0.90 && r.random.xEnd >= 0.90
      && r.boundary.poissonSlope != null && r.boundary.poissonSlope < 0.85);
    check("RX3-BOUNDARY-JMAK", ok, {
      band: "union slope 1 +- 0.15 both arms (>= 5 pts); random Poisson 1 +- 0.15; X_end >= 0.90; boundary Poisson must be < 0.85",
      referenceV1End: ref.V1 ? ref.V1[ref.V1.length - 1] : null, runs,
    });
  }

  // -------------------------------------------------------------------------
  // RX3-MODES-PANEL (UI; protocol in tasks/todo.md)
  {
    const MODES = [...HS.RX_MODES];
    const out = await page.evaluate(async (MODES) => {
      const S = window.__solidify, R = window.__rr;
      S.app.setMaterial("cu");
      await R.cast(0xd1);
      S.app.startHeat();
      let panel = document.getElementById("heattreat");
      if (!panel) return { opened: false };
      const note = () => document.getElementById("htNote").textContent;
      for (let i = 0; i < 40 && /waiting/.test(note()); i++) await new Promise(r => setTimeout(r, 100));
      let dials = panel.querySelectorAll('input[type="range"]');
      let sel = panel.querySelector(".fbform select");
      const btn = document.getElementById("htRun");
      const set = (i, v) => { dials[i].value = String(v); dials[i].dispatchEvent(new Event("input", { bubbles: true })); };
      const choose = v => { sel.value = v; sel.dispatchEvent(new Event("change", { bubbles: true })); };
      const sweepsOf = s => parseInt((s.match(/([\d,]+) MC sweeps/) ?? [])[1]?.replace(/,/g, "") ?? "0", 10);
      const options = sel ? [...sel.options].map(o => o.value) : [];
      const selects = panel.querySelectorAll(".fbform select").length;
      set(5, 8);
      set(6, 200);
      if (sel) choose(MODES[3]);
      const T0 = Number(dials[0].value), Tmin = Number(dials[0].min);
      const arm = async (minSweeps) => {
        for (const drop of [0, 100, 200, 300, 400, 500, 600]) {
          if (T0 - drop < Tmin) break;
          set(0, T0 - drop);
          for (const m of [60, 30, 15, 8, 4, 2]) {
            set(1, m);
            for (let i = 0; i < 20 && btn.disabled; i++) await new Promise(r => setTimeout(r, 100));
            if (!btn.disabled && sweepsOf(note()) >= minSweeps) return true;
          }
        }
        return false;
      };
      const base = { opened: true, dialCount: dials.length, selects, options };
      if (!(await arm(20))) return { ...base, armed: false, note: note().slice(0, 240) };
      const setupWith = S.heat.setup();
      const cardAt = () => document.getElementById("htReport").innerHTML;
      const was = cardAt();
      btn.click();
      let busySeen = false;
      for (let i = 0; i < 100 && !(busySeen = S.heat.busy); i++) await new Promise(r => setTimeout(r, 50));
      for (let i = 0; i < 1500 && S.heat.busy; i++) await new Promise(r => setTimeout(r, 100));
      for (let i = 0; i < 100 && cardAt() === was; i++) await new Promise(r => setTimeout(r, 100));
      const cardChanged = cardAt() !== was;
      const report = document.getElementById("htReport").textContent.replace(/\s+/g, " ");
      const log = S.sim3d().rxLog;
      const tally = log ? {
        sites: log.sites, window: log.window, batches: log.batches.length, scheduled: log.hi - log.lo + 1,
        placed: log.batches.reduce((a, b) => a + b.placed, 0), phantom: log.batches.reduce((a, b) => a + b.phantom, 0),
        stateCounts: [0, 1, 2, 3].map(s => log.state.reduce((a, v) => a + (v === s ? 1 : 0), 0)),
      } : null;
      choose(MODES[0]);
      const setupDefault = S.heat.setup();
      S.heat.close();
      // legacy and new restores (setupWith carries this material's clamped dials)
      const restored = async t => {
        S.heat.open(t);
        for (let i = 0; i < 20 && !document.getElementById("heattreat"); i++) await new Promise(r => setTimeout(r, 50));
        const p = document.getElementById("heattreat");
        const v = p?.querySelector(".fbform select")?.value ?? null;
        const len = S.heat.setup().length, last = S.heat.setup().at(-1);
        S.heat.close();
        return { select: v, len, last };
      };
      const head = setupWith.slice(0, 7);
      const r7 = await restored(head), r8 = await restored([...head, 3]), r80 = await restored([...head, 0]);
      return { ...base, armed: true, busySeen, cardChanged, report, tally, setupWith, setupDefault, r7, r8, r80 };
    }, MODES);
    let cardOk = false, card = null;
    if (out.armed && out.tally) {
      const m = out.report.match(/(\d+) of (\d+) nuclei placed[^·]*· on grain boundaries · steady: (\d+) batches over ([\d,]+) sweeps, (\d+) sites? already recrystallized/);
      const swept = parseInt((out.report.match(/after ([\d,]+) MC sweeps/) ?? [])[1]?.replace(/,/g, "") ?? "-1", 10);
      card = m ? { placed: +m[1], requested: +m[2], batches: +m[3], window: parseInt(m[4].replace(/,/g, ""), 10), phantom: +m[5], swept } : { swept };
      cardOk = !!m && card.placed === out.tally.placed && card.batches === out.tally.batches && card.window === out.tally.window
        && card.phantom === out.tally.phantom && card.requested === 200;
    }
    const pre = out.opened && out.armed && out.busySeen && out.cardChanged;
    const surface = out.opened && out.dialCount === 7 && out.selects === 1 && out.options?.join("|") === MODES.join("|");
    const tuple = out.armed && out.setupWith?.length === 8 && out.setupWith?.[7] === 3 && out.setupDefault?.length === 7;
    const partition = !!out.tally && out.tally.stateCounts[0] === 0
      && out.tally.stateCounts[1] + out.tally.stateCounts[2] + out.tally.stateCounts[3] === out.tally.scheduled;
    const logOk = !!out.tally && out.tally.sites === "boundary" && card != null && out.tally.window === card.swept;
    const restores = out.r7?.select === MODES[0] && out.r7?.len === 7 && out.r8?.select === MODES[3] && out.r8?.len === 8 && out.r8?.last === 3
      && out.r80?.len === 7;
    check("RX3-MODES-PANEL", pre && surface && tuple && cardOk && partition && logOk && restores, {
      precondition: { opened: out.opened, armed: out.armed, busySeen: out.busySeen, cardChanged: out.cardChanged },
      surface, tuple, cardOk, partition, logOk, restores, card, tally: out.tally, setupWith: out.setupWith, setupDefault: out.setupDefault,
      r7: out.r7, r8: out.r8, r80: out.r80, rxRow: (out.report ?? "").match(/recrystallized[\s\S]{0,320}/)?.[0] ?? out.note,
    });
  }
} catch (e) {
  console.log("RX3-RATE harness error", String(e?.stack ?? e));
  FAIL();
} finally {
  console.log("PAGE ERRORS:", errors.length ? JSON.stringify(errors.slice(0, 8)) : "none");
  if (errors.length) FAIL();
  await closeBrowser(browser);
}
console.log(failures ? `done — ${failures} FAILED` : "done");
process.exit(failures ? 1 : 0);
