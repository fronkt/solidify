// Runs the real width-ladder CLI (--run) under a CPU-only synthetic browser and
// checks verdict, validity, evidence and exit-status plumbing. No Chrome/GPU.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const out = resolve(process.argv[2] ?? 'verify-out/q3c-width-ladder-cli-controls');
mkdirSync(out, { recursive: true });
const cases = [
  { mode: 'quadratic', status: 0, verdict: 'width-trend-quadratic-supported', completed: true, followUpLambda: 2.4, valid: true },
  { mode: 'flat', status: 0, verdict: 'width-trend-refuted', completed: true, valid: true },
  { mode: 'unstable', status: 0, verdict: 'refused-validity', completed: true, valid: false },
  { mode: 'gpu-error', status: 1, verdict: 'refused-execution', completed: false, valid: true },
];
const rows = [];
for (const c of cases) {
  const dir = resolve(out, c.mode);
  rmSync(dir, { recursive: true, force: true });
  const env = { ...process.env, Q3C_LADDER_MOCK: c.mode }; delete env.CHROME_ARGS;
  const child = spawnSync(process.execPath, ['--import', './scripts/research/quant3d-width-ladder-preload.mjs',
    'scripts/research/quant3d-width-ladder.mjs', dir, '5199', '--run'],
  { cwd: ROOT, env, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 ** 2 });
  assert.ifError(child.error);
  writeFileSync(`${dir}.log`, child.stdout + child.stderr);
  const result = JSON.parse(readFileSync(resolve(dir, 'width-ladder-result.json'), 'utf8'));
  assert.equal(child.status, c.status, `${c.mode}: exit status`);
  assert.equal(result.verdict.verdict, c.verdict, `${c.mode}: verdict`);
  assert.equal(result.completed, c.completed, `${c.mode}: completion`);
  assert.equal(result.q3Accepted, false); assert.equal(result.verdict.q3Accepted, false);
  assert.equal(result.sourceCapture?.completed, true, `${c.mode}: exact sources captured before admission`);
  assert.equal(result.sourceStable, true, `${c.mode}: sources stable`);
  assert.equal(result.arms.length, 3, `${c.mode}: all three registered arms ran`);
  assert.deepEqual(result.arms.map(a => a.config.name), ['w50', 'w44', 'w40-anchor']);
  for (const arm of result.arms) {
    assert.equal(arm.terminal.complete, true, `${c.mode}/${arm.config.name}: fixed terminal reached`);
    assert.equal(arm.valid, c.valid, `${c.mode}/${arm.config.name}: validity`);
    assert.equal(arm.raw.length, arm.terminal.state.ready ? 61 : arm.raw.length);
  }
  if ('followUpLambda' in c) assert.equal(result.verdict.followUpLambda, c.followUpLambda);
  rows.push({ mode: c.mode, status: child.status, verdict: result.verdict.verdict, completed: result.completed,
    arms: result.arms.map(a => ({ name: a.config.name, valid: a.valid, Vd0OverD: a.derived?.Vd0OverD ?? null })) });
  console.log('Q3C-LADDER-CLI-CONTROL OK', JSON.stringify(rows.at(-1)));
}
writeFileSync(resolve(out, 'cli-controls.json'), JSON.stringify({ purpose: 'CPU-only CLI plumbing; no GPU or physics evidence', rows }, null, 2) + '\n');
