// Tests for lib/runs.js. Phase 2.
// Uses real fs under a scratch dir; restores cwd-agnostic behavior by
// importing the module fresh against a rigged RUNS_DIR via env or
// monkey-patching the module's constants at require-time.
//
// The module computes RUNS_DIR from its own location. For the test we write
// real folders under runs/__test__ then pass full paths through its public
// helpers. We test via the public API using real fs.

const fs = require('fs');
const path = require('path');
const { assert, assertEqual, describe, summary } = require('./_harness');

const runs = require('../../ux_testing/lib/runs');

// Scratch namespace isolates these folders from real runs.
const NS = '__test_runs_helpers__';
const scratch = (name) => path.join(runs.RUNS_DIR, `${NS}__${name}`);

function setup() {
  if (!fs.existsSync(runs.RUNS_DIR)) fs.mkdirSync(runs.RUNS_DIR, { recursive: true });
  // Create three fake run folders for recipe "x"; one has result.json.
  const a = scratch('x__20260101-100000'); fs.mkdirSync(a, { recursive: true });
  const b = scratch('x__20260202-100000'); fs.mkdirSync(b, { recursive: true });
  const c = scratch('x__20260303-100000'); fs.mkdirSync(c, { recursive: true });
  fs.writeFileSync(path.join(b, 'result.json'), JSON.stringify({ ok: true }));
  return { a, b, c };
}

function cleanup() {
  if (!fs.existsSync(runs.RUNS_DIR)) return;
  for (const d of fs.readdirSync(runs.RUNS_DIR)) {
    if (d.startsWith(NS)) fs.rmSync(path.join(runs.RUNS_DIR, d), { recursive: true, force: true });
  }
}

// Our runs.findRuns etc. filter by prefix `${recipeId}__`, so we use a recipe id
// that matches our scratch folder names: `${NS}__x`
const recipeId = `${NS}__x`;

try {
  cleanup();
  setup();

  describe('findRuns returns newest-first', () => {
    const found = runs.findRuns(recipeId);
    assertEqual(found.map(r => r.runId), ['20260303-100000', '20260202-100000', '20260101-100000'], 'order');
    assertEqual(found.map(r => r.hasResult), [false, true, false], 'hasResult flags');
  });

  describe('latestRun returns the most recent regardless of result', () => {
    const r = runs.latestRun(recipeId);
    assertEqual(r.runId, '20260303-100000', 'latest');
  });

  describe('latestResult returns latest run that has result.json', () => {
    const r = runs.latestResult(recipeId);
    assertEqual(r.runId, '20260202-100000', 'latest reviewed');
    assert(r.hasResult === true, 'hasResult should be true');
  });

  describe('findRun picks by runId or returns null', () => {
    const r = runs.findRun(recipeId, '20260202-100000');
    assertEqual(r.runId, '20260202-100000', 'exact match');
    assert(runs.findRun(recipeId, 'nonexistent') === null, 'missing returns null');
  });

  describe('unknown recipe returns empty / null', () => {
    assertEqual(runs.findRuns('nope__x'), [], 'empty');
    assert(runs.latestRun('nope__x') === null, 'null latest');
    assert(runs.latestResult('nope__x') === null, 'null latestResult');
  });

  describe('loadBaseline returns null if file missing', () => {
    assert(runs.loadBaseline('nope__x') === null, 'missing baseline → null');
  });
} finally {
  cleanup();
}

summary('test_runs_helpers');
