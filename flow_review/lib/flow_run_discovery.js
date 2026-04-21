// Flow-review-specific thin wrapper around the shared run-discovery helper.
// Distinguishes our artefacts (flow_report.json, flow_runs/, flow_reference_reports/)
// from the ai_ux_testing ones.

const path = require('path');
const { createRunDiscovery } = require('../../shared/run_discovery');

const PROJECT_ROOT = path.resolve(__dirname, '..');
// Monorepo root — where the shared .env.local lives (ux_testing + flow_review siblings).
const MONOREPO_ROOT = path.resolve(PROJECT_ROOT, '..');
const FLOW_RUNS_DIR = path.join(PROJECT_ROOT, 'flow_runs');
const FLOW_REFERENCE_REPORTS_DIR = path.join(PROJECT_ROOT, 'flow_reference_reports');
const RECIPES_DIR = path.join(PROJECT_ROOT, 'recipes');

const discovery = createRunDiscovery({
  runsDir: FLOW_RUNS_DIR,
  baselinesDir: FLOW_REFERENCE_REPORTS_DIR,
  resultFileName: 'flow_report.json',
});

module.exports = {
  PROJECT_ROOT,
  MONOREPO_ROOT,
  FLOW_RUNS_DIR,
  FLOW_REFERENCE_REPORTS_DIR,
  RECIPES_DIR,
  findFlowRuns:                   discovery.findRuns,
  latestFlowRun:                  discovery.latestRun,
  latestFlowRunWithReport:        discovery.latestResult,
  findFlowRun:                    discovery.findRun,
  referenceFlowReportPath:        discovery.baselinePath,
  listReferenceFlowReports:       discovery.listBaselines,
  loadReferenceFlowReport:        discovery.loadBaseline,
  loadFlowReport:                 discovery.loadResult,
  ensureReferenceFlowReportsDir:  discovery.ensureBaselinesDir,
};
