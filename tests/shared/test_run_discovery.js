const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRunDiscovery } = require('../../shared/run_discovery');
const { assert, assertEqual, describe, summary } = require('./_harness');

const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'run-discovery-test-'));
const runsDir = path.join(scratchRoot, 'runs');
const baselinesDir = path.join(scratchRoot, 'baselines');
fs.mkdirSync(runsDir, { recursive: true });
fs.mkdirSync(baselinesDir, { recursive: true });

const recipeId = 'recipe_x';
fs.mkdirSync(path.join(runsDir, `${recipeId}__20260101-100000`));
fs.mkdirSync(path.join(runsDir, `${recipeId}__20260202-100000`));
fs.mkdirSync(path.join(runsDir, `${recipeId}__20260303-100000`));
fs.writeFileSync(path.join(runsDir, `${recipeId}__20260202-100000`, 'result.json'), '{}');

const discovery = createRunDiscovery({ runsDir, baselinesDir });

try {
  describe('findRuns newest first with hasResult flags', () => {
    const runs = discovery.findRuns(recipeId);
    assertEqual(runs.map(r => r.runId), ['20260303-100000', '20260202-100000', '20260101-100000'], 'order');
    assertEqual(runs.map(r => r.hasResult), [false, true, false], 'hasResult flags');
  });

  describe('latestRun returns newest regardless of result', () => {
    assertEqual(discovery.latestRun(recipeId).runId, '20260303-100000', 'latest');
  });

  describe('latestResult returns newest reviewed', () => {
    assertEqual(discovery.latestResult(recipeId).runId, '20260202-100000', 'latest reviewed');
  });

  describe('findRun returns null on miss', () => {
    assert(discovery.findRun(recipeId, 'nope') === null, 'miss returns null');
  });

  describe('loadBaseline returns null when file absent', () => {
    assert(discovery.loadBaseline(recipeId) === null, 'no file -> null');
  });

  describe('flat + folder baseline layouts both discoverable', () => {
    fs.writeFileSync(path.join(baselinesDir, `${recipeId}.json`), JSON.stringify({ flat: true }));
    assertEqual(discovery.loadBaseline(recipeId), { flat: true }, 'flat loads');
    fs.mkdirSync(path.join(baselinesDir, recipeId), { recursive: true });
    fs.writeFileSync(path.join(baselinesDir, recipeId, 'default.json'), JSON.stringify({ folder: true }));
    assertEqual(discovery.loadBaseline(recipeId), { folder: true }, 'folder default wins when both present');
    fs.writeFileSync(path.join(baselinesDir, recipeId, 'staging.json'), JSON.stringify({ env: 'staging' }));
    assertEqual(discovery.listBaselines(recipeId), ['default', 'staging'], 'named baselines listed');
  });
} finally {
  fs.rmSync(scratchRoot, { recursive: true, force: true });
}

summary('test_run_discovery');
