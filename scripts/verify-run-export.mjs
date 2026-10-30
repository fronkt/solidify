import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`${name}: OK`); }
  catch (e) { failed++; console.error(`${name}: FAIL`, e.message); }
}
try {
  const R = await server.ssrLoadModule("/src/run-export.ts");
  const { livePourFigure } = await server.ssrLoadModule("/src/plot/process.ts");
  const { chemOf } = await server.ssrLoadModule("/src/plot/figures.ts");
  const { bridgeOf } = await server.ssrLoadModule("/src/plot/quantity.ts");
  const { Units, scaleOf } = await server.ssrLoadModule("/src/units.ts");
  const { MATERIALS } = await server.ssrLoadModule("/src/materials.ts");
  const si = MATERIALS.al.si;
  const units = new Units(scaleOf({ si, n: 512, dx: .03, latent: 1.6, dSol: .8, alloy: true, umPerCell: 1 }), si);
  const bridge = bridgeOf(units, "Al–Cu");
  const prov = { material: "Al–Cu", seed: "1234abcd", grid: "512² cells (2D)", solver: "Kobayashi", share: "https://example.test/app/#set=old", build: "test" };
  const fig = livePourFigure({ series: [{ t: 0, T: 0, fs: .2 }, { t: 1, T: -.1, fs: .6 }, { t: 2, T: null, fs: 1 }], bridge, chem: chemOf({ alloyOn: 1, mLiq: .5, c0: .3, kPart: .17 }), prov });
  const snapshot = { exportedAt: "2026-10-29T12:00:00Z", build: "test", mode: "3d", material: { key: "steel", name: "Steel", constants: MATERIALS.steel, mix: null, caveats: [] }, seed: 42, grid: 96, simulationTime: 4, parameters: { c0: .35 }, setupLink: "https://example.test/app/#set=current", units: { scale: units.scale }, camera: { az: 1 }, image: { lens: 2, umPerPixel: 2, perspective: true }, statistics: null };
  const entries = R.runEntries(snapshot, [fig]);

  await check("RUN-DATA-PROVENANCE", () => {
    const manifest = JSON.parse(new TextDecoder().decode(entries.find(e => e.name === "run.json").data));
    assert.equal(manifest.format, "solidify-run"); assert.equal(manifest.version, 1);
    assert.equal(manifest.material.key, "steel"); assert.equal(manifest.seed, 42);
    assert.equal(manifest.datasets.length, 1);
    assert.equal(manifest.datasets[0].provenance.material, "Al–Cu");
    assert.equal(manifest.datasets[0].provenance.seed, "1234abcd");
    assert.notEqual(manifest.datasets[0].provenance.share, manifest.setupLink);
    assert.deepEqual(manifest.datasets[0].columns.find(c => c.key === "T").values, [0, -.1, null]);
    const csv = new TextDecoder().decode(entries.find(e => e.name.endsWith(".csv")).data);
    assert.match(csv, /material: Al–Cu/); assert.match(csv, /1234abcd/);
    assert.match(csv, /T_dimensionless/); assert.match(csv, /-0\.1/);
    const rows = csv.trim().split("\n").filter(l => !l.startsWith("#"));
    assert.equal(rows.length, 4);
    const temperatureColumn = rows[0].split(",").indexOf("T_dimensionless");
    assert(temperatureColumn >= 0);
    assert.equal(rows.at(-1).split(",")[temperatureColumn], "");
  });
  await check("RUN-EMPTY", () => {
    const empty = R.runEntries(snapshot, [{ ...fig, columns: [{ ...fig.columns[0], values: [] }] }]);
    assert.equal(empty.length, 2);
    assert.equal(JSON.parse(new TextDecoder().decode(empty[1].data)).datasets.length, 0);
    assert.match(new TextDecoder().decode(empty[0].data), /No series were recorded/);
  });
  await check("RUN-ZIP", () => {
    assert.equal(R.crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
    const zip = R.zipStore([...entries, { name: "micrograph.png", data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) }]);
    const view = new DataView(zip.buffer);
    const end = zip.length - 22;
    assert.equal(view.getUint32(end, true), 0x06054b50);
    assert.equal(view.getUint16(end + 10, true), entries.length + 1);
    let at = view.getUint32(end + 16, true);
    const names = [];
    for (let i = 0; i < entries.length + 1; i++) {
      assert.equal(view.getUint32(at, true), 0x02014b50);
      const size = view.getUint32(at + 24, true), n = view.getUint16(at + 28, true), local = view.getUint32(at + 42, true);
      assert.equal(view.getUint32(local, true), 0x04034b50);
      assert.equal(view.getUint16(local + 6, true), 0x800);
      const name = new TextDecoder().decode(zip.slice(at + 46, at + 46 + n)); names.push(name);
      const content = zip.slice(local + 30 + n, local + 30 + n + size);
      assert.equal(view.getUint32(at + 16, true), R.crc32(content));
      if (name === "run.json") assert.equal(JSON.parse(new TextDecoder().decode(content)).seed, 42);
      at += 46 + n;
    }
    assert.equal(at, end); assert(names.includes("micrograph.png"));
  });
  await check("RUN-ZIP-PATHS", () => {
    const bytes = new Uint8Array([1]);
    for (const name of ["../bad", "/absolute", "data/../bad", "a\\b", ""])
      assert.throws(() => R.zipStore([{ name, data: bytes }]));
    assert.throws(() => R.zipStore([{ name: "same", data: bytes }, { name: "same", data: bytes }]));
  });
  await check("RUN-IMAGE-SCALE", () => {
    for (const pitch of [.001, .5, 1, 30, 900]) {
      const bar = R.imageScale(pitch, 1000);
      assert(bar && bar.pixels > 0 && bar.pixels < 1000);
      assert(Math.abs(bar.pixels * pitch - bar.microns) < bar.microns * 1e-10);
    }
    assert.equal(R.imageScale(NaN, 1000), null);
    assert.equal(R.imageScale(0, 1000), null);
  });
} finally { await server.close(); }
process.exitCode = failed ? 1 : 0;
