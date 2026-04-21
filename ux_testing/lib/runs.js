const path = require('path');
const { createRunDiscovery } = require('../../shared/run_discovery');

const ROOT = path.resolve(__dirname, '..');
const RUNS_DIR = path.join(ROOT, 'runs');
const BASELINES_DIR = path.join(ROOT, 'baselines');

const discovery = createRunDiscovery({
  runsDir: RUNS_DIR,
  baselinesDir: BASELINES_DIR,
  resultFileName: 'result.json',
});

module.exports = {
  ROOT,
  RUNS_DIR,
  BASELINES_DIR,
  findRuns: discovery.findRuns,
  latestRun: discovery.latestRun,
  latestResult: discovery.latestResult,
  findRun: discovery.findRun,
  baselinePath: discovery.baselinePath,
  listBaselines: discovery.listBaselines,
  loadBaseline: discovery.loadBaseline,
  loadResult: discovery.loadResult,
  ensureBaselinesDir: discovery.ensureBaselinesDir,
};
