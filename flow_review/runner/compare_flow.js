#!/usr/bin/env node
// Compares the latest reviewed flow run against the recipe's reference flow
// report. Exits 0 on clean, 2 on regression detected.

const fs = require('fs');
const path = require('path');
const { detectFlowRegressions } = require('../lib/flow_regression_detector');
const {
  PROJECT_ROOT,
  latestFlowRunWithReport,
  findFlowRun,
  loadReferenceFlowReport,
  loadFlowReport,
  referenceFlowReportPath,
} = require('../lib/flow_run_discovery');
const { resolveRecipeById } = require('../lib/flow_recipe_resolver');
const { DEFAULTS } = require('../config/defaults');

function parseCliArgs(argv) {
  const parsed = { recipeId: null, runId: null, referenceName: 'default', verbose: false };
  const args = argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--run')      { parsed.runId = args[++index]; continue; }
    if (token === '--reference'){ parsed.referenceName = args[++index]; continue; }
    if (token === '--verbose' || token === '-v') { parsed.verbose = true; continue; }
    if (token === '--help' || token === '-h') { printUsage(); process.exit(0); }
    if (!parsed.recipeId) { parsed.recipeId = token; continue; }
    console.error(`Unknown argument: ${token}`);
    process.exit(1);
  }
  return parsed;
}

function printUsage() {
  console.error('Usage: node runner/compare_flow.js <recipe-id> [--run <ts>] [--reference <name>] [-v]');
}

function main() {
  const { recipeId, runId, referenceName, verbose } = parseCliArgs(process.argv);
  if (!recipeId) { printUsage(); process.exit(1); }

  const referenceFlowReport = loadReferenceFlowReport(recipeId, referenceName);
  if (!referenceFlowReport) {
    console.log(`No reference "${referenceName}" for "${recipeId}" — run approve_flow.js first.`);
    console.log(`  Expected at: ${path.relative(PROJECT_ROOT, referenceFlowReportPath(recipeId, referenceName))}`);
    process.exit(0);
  }

  const flowRun = runId ? findFlowRun(recipeId, runId) : latestFlowRunWithReport(recipeId);
  if (!flowRun) {
    console.error(runId ? `no flow run ${recipeId}__${runId}` : `no reviewed flow runs for "${recipeId}"`);
    process.exit(1);
  }
  if (!flowRun.hasResult) {
    console.error(`run ${flowRun.dirName} has no flow_report.json — run review_flow.js first.`);
    process.exit(1);
  }

  const candidateFlowReport = loadFlowReport(flowRun.dir);

  const tolerancePercent = resolveDurationTolerancePercentFor(recipeId);
  const comparisonResult = detectFlowRegressions({
    referenceFlowReport,
    candidateFlowReport,
    flowDurationChangeToleratedPercent: tolerancePercent,
  });

  const comparisonMarkdown = renderComparisonMarkdown({
    recipeId,
    referenceName,
    flowRunDirName: flowRun.dirName,
    referenceFlowReport,
    candidateFlowReport,
    comparisonResult,
    tolerancePercent,
    verbose,
  });
  const comparisonPath = path.join(flowRun.dir, 'flow_comparison.md');
  fs.writeFileSync(comparisonPath, comparisonMarkdown);

  printStdoutSummary({ recipeId, flowRun, candidateFlowReport, referenceFlowReport, comparisonResult });
  console.log('');
  console.log(`Wrote ${path.relative(PROJECT_ROOT, comparisonPath)}`);

  if (comparisonResult.hasRegression) process.exit(2);
}

function resolveDurationTolerancePercentFor(recipeId) {
  try {
    const { recipe } = resolveRecipeById(recipeId);
    if (recipe.flow_review && typeof recipe.flow_review.flowDurationChangeToleratedPercent === 'number') {
      return recipe.flow_review.flowDurationChangeToleratedPercent;
    }
  } catch { /* fall through to default */ }
  return DEFAULTS.flowDurationChangeToleratedPercent;
}

function renderComparisonMarkdown({
  recipeId,
  referenceName,
  flowRunDirName,
  referenceFlowReport,
  candidateFlowReport,
  comparisonResult,
  tolerancePercent,
  verbose,
}) {
  const lines = [];
  lines.push(`# Flow comparison — ${recipeId}`);
  lines.push('');
  lines.push(`Reference: \`flow_reference_reports/${recipeId}${referenceName === 'default' ? '' : '/' + referenceName}.json\``);
  lines.push(`Candidate: \`flow_runs/${flowRunDirName}/flow_report.json\``);
  lines.push(`Duration change tolerance: ${tolerancePercent}%`);
  lines.push('');
  lines.push(`**Verdict:** ${referenceFlowReport.frictionVerdict} → ${candidateFlowReport.frictionVerdict}`);
  lines.push('');
  if (comparisonResult.detectedRegressions.length) {
    lines.push('## Regressions');
    for (const regression of comparisonResult.detectedRegressions) {
      lines.push(`- [${regression.viewport}] ${regression.fieldName}: ${JSON.stringify(regression.referenceValue)} → ${JSON.stringify(regression.candidateValue)}` +
        (regression.delta !== undefined ? ` (Δ ${regression.delta > 0 ? '+' : ''}${regression.delta})` : '') +
        (regression.changePercent !== undefined ? ` (${regression.changePercent.toFixed(1)}%)` : ''));
    }
    lines.push('');
  } else {
    lines.push('## Regressions');
    lines.push('- none detected');
    lines.push('');
  }
  if (comparisonResult.detectedImprovements.length) {
    lines.push('## Improvements');
    for (const improvement of comparisonResult.detectedImprovements) {
      lines.push(`- [${improvement.viewport}] ${improvement.fieldName}: ${JSON.stringify(improvement.referenceValue)} → ${JSON.stringify(improvement.candidateValue)}`);
    }
    lines.push('');
  }
  if (verbose) {
    lines.push('## Candidate suggestions');
    for (const suggestion of candidateFlowReport.suggestedFlowImprovements || []) lines.push(`- ${suggestion}`);
  }
  return lines.join('\n');
}

function printStdoutSummary({ recipeId, flowRun, candidateFlowReport, referenceFlowReport, comparisonResult }) {
  console.log(`Flow comparison — ${recipeId}`);
  console.log(`  reference verdict: ${referenceFlowReport.frictionVerdict}`);
  console.log(`  candidate verdict: ${candidateFlowReport.frictionVerdict}`);
  console.log(`  candidate run:     ${flowRun.dirName}`);
  if (comparisonResult.detectedRegressions.length) {
    console.log('\n  Regressions:');
    for (const regression of comparisonResult.detectedRegressions) {
      const deltaText = regression.delta !== undefined ? ` (Δ ${regression.delta})` : '';
      const pctText = regression.changePercent !== undefined ? ` (${regression.changePercent.toFixed(1)}%)` : '';
      console.log(`    [${regression.viewport}] ${regression.fieldName}: ${JSON.stringify(regression.referenceValue)} → ${JSON.stringify(regression.candidateValue)}${deltaText}${pctText}`);
    }
  } else {
    console.log('  no regressions detected');
  }
  if (comparisonResult.detectedImprovements.length) {
    console.log('\n  Improvements:');
    for (const improvement of comparisonResult.detectedImprovements) {
      console.log(`    [${improvement.viewport}] ${improvement.fieldName}: ${JSON.stringify(improvement.referenceValue)} → ${JSON.stringify(improvement.candidateValue)}`);
    }
  }
}

try { main(); } catch (error) { console.error('Error:', error.message); process.exit(1); }
