// Regression test for tools/perf-loops.mjs: the 500-loop frame benchmark (run here with a
// smaller loop count to keep CI fast) must meet the stable-60-FPS budget at the Grand-Place,
// Royal Palace and Palais de Justice hotspots with the landmark merge enabled, and must
// catch the un-merged baseline blowing the draw-call budget.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HARNESS = path.join(ROOT, 'tools/perf-loops.mjs');
const LOOPS = 60;

function runPerfLoops(extraArgs) {
  const run = spawnSync(process.execPath, [HARNESS, '--loops', String(LOOPS), '--json', ...extraArgs], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
  assert.equal(run.status !== null, true, `harness ran: ${run.stderr}`);
  const line = run.stdout.split('\n').find((l) => l.startsWith('PERF-LOOPS-JSON '));
  assert.ok(line, 'harness prints a PERF-LOOPS-JSON summary');
  const summary = JSON.parse(line.slice('PERF-LOOPS-JSON '.length));
  summary.exitStatus = run.status;
  return summary;
}

test('500-loop benchmark (60 loops here) passes the 60 FPS budget at all three hotspots with the merge', () => {
  const summary = runPerfLoops([]);
  assert.equal(summary.merged, true);
  assert.equal(summary.exitStatus, 0, 'harness exits 0 when the budget passes');
  assert.equal(summary.pass, true, summary.failures.join('; '));
  assert.equal(summary.results.length, 3);
  for (const r of summary.results) {
    assert.equal(r.loops, LOOPS);
    assert.ok(['grandPlace', 'royalPalace', 'palaisDeJustice'].includes(r.location));
    assert.ok(r.simMs.p99 <= summary.budgets.simP99Ms, `${r.location} sim p99 ${r.simMs.p99} ms`);
    assert.ok(r.simMs.max <= summary.frameBudgetMs, `${r.location} sim max ${r.simMs.max} ms exceeds the 16.67 ms frame budget`);
    assert.ok(r.draws.p95 <= summary.budgets.drawsP95, `${r.location} draws p95 ${r.draws.p95}`);
    assert.ok(r.shadowDraws.p95 <= summary.budgets.shadowDrawsP95, `${r.location} shadow draws p95 ${r.shadowDraws.p95}`);
  }
  // the merge collapses each hotspot's meshes and preserves the triangles
  for (const id of ['grandPlace', 'royalPalace', 'palaisDeJustice']) {
    const m = summary.mergeStats[id];
    assert.ok(m.meshesAfter < m.meshesBefore / 4, `${id}: ${m.meshesBefore} -> ${m.meshesAfter} meshes`);
    assert.equal(m.trianglesBefore, m.trianglesAfter, `${id}: merge must not drop triangles`);
  }
});

test('the un-merged baseline fails the draw-call budget (the benchmark catches the regression)', () => {
  const baseline = runPerfLoops(['--no-merge']);
  assert.equal(baseline.exitStatus, 1, 'harness exits 1 when the budget fails');
  assert.equal(baseline.pass, false, 'baseline without the merge must fail the budget');
  const merged = runPerfLoops([]);
  for (const r of baseline.results) {
    const m = merged.results.find((x) => x.location === r.location);
    assert.ok(r.draws.p95 > m.draws.p95 * 2, `${r.location}: baseline draws p95 ${r.draws.p95} vs merged ${m.draws.p95}`);
  }
});
