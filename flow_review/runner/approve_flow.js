#!/usr/bin/env node
// Promotes a reviewed flow run's flow_report.json to a reference report.
// Named references supported via --name (default: "default").

const fs = require('fs');
const path = require('path');
const { validateFlowReport } = require('../lib/flow_report_schema');
const {
  PROJECT_ROOT,
  FLOW_REFERENCE_REPORTS_DIR,
  latestFlowRunWithReport,
  findFlowRun,
  loadFlowReport,
  ensureReferenceFlowReportsDir,
  referenceFlowReportPath,
} = require('../lib/flow_run_discovery');

function parseCliArgs(argv) {
  const parsed = { recipeId: null, runId: null, referenceName: 'default' };
  const args = argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--run')  { parsed.runId = args[++index]; continue; }
    if (token === '--name') { parsed.referenceName = args[++index]; continue; }
    if (token === '--help' || token === '-h') { printUsage(); process.exit(0); }
    if (!parsed.recipeId) { parsed.recipeId = token; continue; }
    console.error(`Unknown argument: ${token}`);
    process.exit(1);
  }
  return parsed;
}

function printUsage() {
  console.error('Usage: node runner/approve_flow.js <recipe-id> [--run <ts>] [--name <reference-name>]');
}

function main() {
  const { recipeId, runId, referenceName } = parseCliArgs(process.argv);
  if (!recipeId) { printUsage(); process.exit(1); }

  const flowRun = runId ? findFlowRun(recipeId, runId) : latestFlowRunWithReport(recipeId);
  if (!flowRun) {
    console.error(runId ? `no flow run ${recipeId}__${runId}` : `no reviewed flow runs for "${recipeId}"`);
    process.exit(1);
  }
  if (!flowRun.hasResult) {
    console.error(`run ${flowRun.dirName} has no flow_report.json — run review_flow.js first.`);
    process.exit(1);
  }

  const flowReport = loadFlowReport(flowRun.dir);
  const validation = validateFlowReport(flowReport);
  if (!validation.ok) {
    console.error('flow_report.json is invalid — cannot approve:');
    for (const error of validation.errors) console.error('  - ' + error);
    process.exit(2);
  }

  const referenceReport = { ...flowReport, _isReference: true };

  ensureReferenceFlowReportsDir();
  const useFolderLayout = referenceName !== 'default'
    || fs.existsSync(path.join(FLOW_REFERENCE_REPORTS_DIR, recipeId));
  let targetPath;
  if (useFolderLayout) {
    const folder = path.join(FLOW_REFERENCE_REPORTS_DIR, recipeId);
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    targetPath = path.join(folder, `${referenceName}.json`);
  } else {
    targetPath = referenceFlowReportPath(recipeId);
  }

  const existedBefore = fs.existsSync(targetPath);
  fs.writeFileSync(targetPath, JSON.stringify(referenceReport, null, 2) + '\n');

  console.log(`${existedBefore ? 'Replaced' : 'Wrote'} ${path.relative(PROJECT_ROOT, targetPath)}`);
  console.log(`  reference name: ${referenceName}`);
  console.log(`  source run:     ${path.relative(PROJECT_ROOT, flowRun.dir)}`);
  console.log(`  verdict:        ${flowReport.frictionVerdict}`);
}

try { main(); } catch (error) { console.error('Error:', error.message); process.exit(1); }
