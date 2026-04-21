#!/usr/bin/env node
// Reads a captured flow run, sends the screenshots + flow prompt to the AI
// reviewer, validates the response, writes flow_report.json + flow_report.md.
//
// Usage:
//   node runner/review_flow.js <recipe-id>
//   node runner/review_flow.js <recipe-id> --run <timestamp>
//   node runner/review_flow.js <recipe-id> --model <preset|id>
//   node runner/review_flow.js <recipe-id> --dry-run
//   node runner/review_flow.js <recipe-id> --force

const fs = require('fs');
const path = require('path');
const { loadEnvironmentVariables } = require('../../shared/env_loader');
const { getReviewerAdapter } = require('../../shared/reviewer');
const { validateFlowReport } = require('../lib/flow_report_schema');
const {
  PROJECT_ROOT,
  MONOREPO_ROOT,
  FLOW_RUNS_DIR,
  latestFlowRun,
  findFlowRun,
} = require('../lib/flow_run_discovery');
const { DEFAULTS } = require('../config/defaults');

function parseCliArgs(argv) {
  const parsed = {
    recipeId: null,
    runId: null,
    reviewerModel: null,
    isDryRun: false,
    overwriteExisting: false,
  };
  const args = argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--run')     { parsed.runId = args[++index]; continue; }
    if (token === '--model')   { parsed.reviewerModel = args[++index]; continue; }
    if (token === '--dry-run') { parsed.isDryRun = true; continue; }
    if (token === '--force')   { parsed.overwriteExisting = true; continue; }
    if (token === '--help' || token === '-h') { printUsage(); process.exit(0); }
    if (!parsed.recipeId) { parsed.recipeId = token; continue; }
    console.error(`Unknown argument: ${token}`);
    process.exit(1);
  }
  return parsed;
}

function printUsage() {
  console.error('Usage: node runner/review_flow.js <recipe-id> [--run <ts>] [--model <preset|id>] [--dry-run] [--force]');
}

function encodeScreenshotForReview(screenshotRecord) {
  const absolutePath = path.join(PROJECT_ROOT, screenshotRecord.path);
  return {
    path: screenshotRecord.path,
    label: path.basename(screenshotRecord.path),
    mediaType: 'image/png',
    base64: fs.readFileSync(absolutePath).toString('base64'),
  };
}

async function main() {
  loadEnvironmentVariables({ projectRoot: MONOREPO_ROOT });
  const { recipeId, runId, reviewerModel, isDryRun, overwriteExisting } = parseCliArgs(process.argv);
  if (!recipeId) { printUsage(); process.exit(1); }

  const flowRun = runId ? findFlowRun(recipeId, runId) : latestFlowRun(recipeId);
  if (!flowRun) {
    console.error(runId ? `no flow run matching ${recipeId}__${runId}` : `no flow runs found for "${recipeId}"`);
    process.exit(1);
  }

  const flowReportPath = path.join(flowRun.dir, 'flow_report.json');
  if (fs.existsSync(flowReportPath) && !overwriteExisting) {
    console.error(`flow_report.json already exists — pass --force to overwrite.`);
    process.exit(1);
  }

  const promptPath = path.join(flowRun.dir, 'FLOW_REVIEW_PROMPT.md');
  if (!fs.existsSync(promptPath)) {
    console.error('run is missing FLOW_REVIEW_PROMPT.md — recapture the flow.');
    process.exit(1);
  }
  const promptMarkdown = fs.readFileSync(promptPath, 'utf8');

  const flowRunJson = JSON.parse(fs.readFileSync(path.join(flowRun.dir, 'flow_run.json'), 'utf8'));
  const screenshotsForReview = (flowRunJson.screenshots || []).map(encodeScreenshotForReview);

  const modelToUse = reviewerModel || DEFAULTS.defaultReviewerModel;
  const { modelId, provider, reviewer } = getReviewerAdapter(modelToUse);
  console.log(`Reviewing flow ${recipeId}__${flowRun.runId} with ${provider}:${modelId} (${screenshotsForReview.length} screenshots)…`);

  let reviewerOutput;
  try {
    reviewerOutput = await reviewer.runReview({
      modelId,
      promptMarkdown,
      screenshots: screenshotsForReview,
      dryRun: isDryRun,
      maxOutputTokens: DEFAULTS.reviewerOutputMaxTokens,
    });
  } catch (error) {
    console.error('Reviewer call failed:', error.message);
    process.exit(2);
  }

  if (isDryRun) {
    console.log('Dry run — nothing sent. Summary:');
    console.log(JSON.stringify(reviewerOutput, null, 2));
    return;
  }

  reviewerOutput.reviewerModel = modelId;
  if (!reviewerOutput.reviewedAt || reviewerOutput.reviewedAt.startsWith('<')) {
    reviewerOutput.reviewedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  }
  if (reviewerOutput.recipeId !== recipeId) reviewerOutput.recipeId = recipeId;
  if (reviewerOutput.runId !== flowRun.runId) reviewerOutput.runId = flowRun.runId;

  const validation = validateFlowReport(reviewerOutput);
  if (!validation.ok) {
    const invalidPath = path.join(flowRun.dir, 'flow_report_invalid.json');
    fs.writeFileSync(invalidPath, JSON.stringify(reviewerOutput, null, 2));
    console.error('Reviewer returned invalid flow report:');
    for (const error of validation.errors) console.error('  - ' + error);
    console.error(`Raw output saved to ${path.relative(PROJECT_ROOT, invalidPath)}`);
    process.exit(2);
  }

  fs.writeFileSync(flowReportPath, JSON.stringify(reviewerOutput, null, 2) + '\n');

  if (DEFAULTS.writeHumanReadableReport) {
    const reportMarkdownPath = path.join(flowRun.dir, 'flow_report.md');
    fs.writeFileSync(reportMarkdownPath, renderHumanReadableFlowReport(reviewerOutput));
  }

  console.log(`Wrote ${path.relative(PROJECT_ROOT, flowReportPath)}`);
  console.log(`  frictionVerdict: ${reviewerOutput.frictionVerdict}`);
  console.log(`  evidence: ${reviewerOutput.frictionEvidenceBulletPoints.length} bullets`);
  console.log(`  suggestions: ${reviewerOutput.suggestedFlowImprovements.length} items`);
}

function renderHumanReadableFlowReport(flowReport) {
  const lines = [];
  lines.push(`# Flow report — ${flowReport.recipeId}`);
  lines.push('');
  lines.push(`**Reviewed at:** ${flowReport.reviewedAt}  `);
  lines.push(`**Reviewer model:** ${flowReport.reviewerModel}  `);
  lines.push(`**Friction verdict:** \`${flowReport.frictionVerdict}\``);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(flowReport.humanReadableSummary);
  lines.push('');
  lines.push('## Friction evidence');
  lines.push('');
  for (const bullet of flowReport.frictionEvidenceBulletPoints) lines.push(`- ${bullet}`);
  lines.push('');
  lines.push('## Suggested improvements');
  lines.push('');
  for (const suggestion of flowReport.suggestedFlowImprovements) lines.push(`- ${suggestion}`);
  lines.push('');
  lines.push('## Per-viewport metrics');
  lines.push('');
  for (const [viewportName, metrics] of Object.entries(flowReport.perViewportMetrics)) {
    lines.push(`### ${viewportName}`);
    lines.push(`- Duration: ${metrics.totalDurationMs} ms`);
    lines.push(`- Clicks: ${metrics.totalClickCount}`);
    lines.push(`- Navigations: ${metrics.totalNavigationCount}`);
    lines.push(`- Scrolls: ${metrics.totalScrollCount}`);
    lines.push(`- Backtracks: ${metrics.detectedBacktrackCount}`);
    lines.push('');
  }
  return lines.join('\n');
}

main().catch(error => { console.error('FATAL:', error.message); process.exit(1); });
