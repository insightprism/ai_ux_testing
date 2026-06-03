#!/usr/bin/env node
// Runs an AI reviewer over a run folder, producing result.json.
// See docs/SPEC_BASELINE_REGRESSION.md §5.7.
//
// Usage:
//   node runner/review.js <recipe-id>
//   node runner/review.js <recipe-id> --run <timestamp>
//   node runner/review.js <recipe-id> --model <preset|id>     # haiku (default), sonnet, opus, gemini-flash, gemini-pro, mock, claude-*, gemini-*
//   node runner/review.js <recipe-id> --dry-run               # print what would be sent, send nothing
//   node runner/review.js <recipe-id> --force                 # overwrite existing result.json
//
// On success, writes runs/<...>/result.json. On invalid output, writes the raw
// reviewer reply to runs/<...>/result_invalid.json and exits non-zero.

const fs = require('fs');
const path = require('path');
const { loadEnv } = require('../lib/env_loader');
const { validateResult } = require('../lib/result_schema');
const { ROOT, latestRun, findRun } = require('../lib/runs');
const { getReviewer, resolveModel } = require('../lib/reviewer');

function parseArgs(argv) {
  const out = { recipeId: null, runId: null, model: null, dryRun: false, force: false, report: null };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--run') { out.runId = args[++i]; continue; }
    if (a === '--model') { out.model = args[++i]; continue; }
    if (a === '--dry-run') { out.dryRun = true; continue; }
    if (a === '--force') { out.force = true; continue; }
    // --report <path>: ALSO copy the validated result.json to <path>, so a caller (e.g. Testbench's
    // script-method executor, which substitutes {report_path}) gets the result at a deterministic
    // location without having to discover the latest run folder. The canonical run-folder
    // result.json is still written as before.
    if (a === '--report') { out.report = args[++i]; continue; }
    if (a === '--help' || a === '-h') { printUsage(); process.exit(0); }
    if (!out.recipeId) { out.recipeId = a; continue; }
    console.error(`Unknown argument: ${a}`);
    printUsage();
    process.exit(1);
  }
  return out;
}

function printUsage() {
  console.error('Usage:');
  console.error('  node runner/review.js <recipe-id> [--run <ts>] [--model <preset|id>] [--dry-run] [--force] [--report <path>]');
  console.error('');
  console.error('  --report <path>  also write the validated result.json to <path> (for CI / Testbench ingest).');
  console.error('');
  console.error('Models (presets or full ids):');
  console.error('  haiku (default), sonnet, opus, gemini-flash, gemini-pro, mock');
  console.error('  claude-<model-id>, gemini-<model-id>');
}

function encodeScreenshot(runDir, rel) {
  const abs = path.join(ROOT, rel);
  const data = fs.readFileSync(abs);
  return {
    path: rel,
    label: path.basename(rel),
    mediaType: 'image/png',
    base64: data.toString('base64'),
  };
}

async function main() {
  loadEnv();
  const { recipeId, runId, model, dryRun, force, report } = parseArgs(process.argv);
  if (!recipeId) { printUsage(); process.exit(1); }

  const run = runId ? findRun(recipeId, runId) : latestRun(recipeId);
  if (!run) {
    console.error(runId ? `no run matching ${recipeId}__${runId}` : `no runs found for "${recipeId}"`);
    process.exit(1);
  }

  const resultPath = path.join(run.dir, 'result.json');
  if (fs.existsSync(resultPath) && !force) {
    console.error(`result.json already exists at ${path.relative(ROOT, resultPath)} — pass --force to overwrite.`);
    process.exit(1);
  }

  const promptPath = path.join(run.dir, 'PROMPT_STRUCTURED.md');
  if (!fs.existsSync(promptPath)) {
    console.error(`run is missing PROMPT_STRUCTURED.md — re-run the recipe.`);
    process.exit(1);
  }
  const promptMarkdown = fs.readFileSync(promptPath, 'utf8');

  const runJsonPath = path.join(run.dir, 'run.json');
  if (!fs.existsSync(runJsonPath)) { console.error('run.json missing'); process.exit(1); }
  const runJson = JSON.parse(fs.readFileSync(runJsonPath, 'utf8'));
  const screenshots = (runJson.screenshots || []).map(s => encodeScreenshot(run.dir, s.path));

  const { modelId, provider, reviewer } = getReviewer(model);
  console.log(`Reviewing ${recipeId}__${run.runId} with ${provider}:${modelId} (${screenshots.length} screenshots)…`);

  let parsed;
  try {
    parsed = await reviewer.review({ modelId, promptMarkdown, screenshots, dryRun });
  } catch (e) {
    console.error('Reviewer call failed:', e.message);
    process.exit(2);
  }

  if (dryRun) {
    console.log('Dry run — nothing sent. Summary:');
    console.log(JSON.stringify(parsed, null, 2));
    return;
  }

  const v = validateResult(parsed);
  if (!v.ok) {
    const invalidPath = path.join(run.dir, 'result_invalid.json');
    fs.writeFileSync(invalidPath, JSON.stringify(parsed, null, 2));
    console.error('Reviewer returned invalid result:');
    for (const e of v.errors) console.error('  - ' + e);
    console.error(`Raw output saved to ${path.relative(ROOT, invalidPath)}`);
    process.exit(2);
  }

  if (parsed.recipe_id !== recipeId || parsed.run_id !== run.runId) {
    console.error(`Mismatch: reviewer produced recipe_id="${parsed.recipe_id}" run_id="${parsed.run_id}", expected "${recipeId}"/"${run.runId}". Overwriting the fields.`);
    parsed.recipe_id = recipeId;
    parsed.run_id = run.runId;
  }

  const serialized = JSON.stringify(parsed, null, 2) + '\n';
  fs.writeFileSync(resultPath, serialized);
  console.log(`Wrote ${path.relative(ROOT, resultPath)}`);
  console.log(`  overall_status: ${parsed.overall_status}`);
  console.log(`  checks: ${parsed.checks.length} (${parsed.checks.filter(c => c.verdict === 'pass').length} pass, ${parsed.checks.filter(c => c.verdict === 'fail').length} fail, ${parsed.checks.filter(c => c.verdict === 'warn').length} warn)`);

  // --report <path>: also drop the validated result at a caller-given location (CI / Testbench
  // ingest), so the consumer never has to discover the latest run folder.
  if (report) {
    fs.mkdirSync(path.dirname(path.resolve(report)), { recursive: true });
    fs.writeFileSync(report, serialized);
    console.log(`Also wrote ${report} (--report)`);
  }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
