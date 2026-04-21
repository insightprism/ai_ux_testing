#!/usr/bin/env node
// Promote a reviewed run to the baseline for its recipe.
// See docs/SPEC_BASELINE_REGRESSION.md §5.5.
//
// Usage:
//   node runner/approve.js <recipe-id>                     # latest reviewed run
//   node runner/approve.js <recipe-id> --run <timestamp>   # specific run
//
// Approval is explicit; there is no auto-promotion. The copy lives at
// baselines/<recipe-id>.json with observed._schema_frozen = true.

const fs = require('fs');
const path = require('path');
const { validateResult } = require('../lib/result_schema');
const {
  ROOT, latestResult, findRun, baselinePath, ensureBaselinesDir, loadResult,
} = require('../lib/runs');

function parseArgs(argv) {
  const out = { recipeId: null, runId: null, name: 'default' };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--run') { out.runId = args[++i]; continue; }
    if (a === '--name') { out.name = args[++i]; continue; }
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
  console.error('  node runner/approve.js <recipe-id> [--run <timestamp>] [--name <baseline-name>]');
}

function main() {
  const { recipeId, runId, name } = parseArgs(process.argv);
  if (!recipeId) { printUsage(); process.exit(1); }

  const run = runId ? findRun(recipeId, runId) : latestResult(recipeId);
  if (!run) {
    console.error(runId
      ? `No run matching ${recipeId}__${runId}`
      : `No reviewed run found for "${recipeId}" (run has result.json). Run the recipe and save_result.js first.`);
    process.exit(1);
  }
  if (!run.hasResult) {
    console.error(`Run ${recipeId}__${run.runId} has no result.json — paste PROMPT_STRUCTURED.md to reviewer and save it with save_result.js first.`);
    process.exit(1);
  }

  const result = loadResult(run.dir);
  const v = validateResult(result);
  if (!v.ok) {
    console.error(`Run's result.json is invalid — cannot approve:`);
    for (const e of v.errors) console.error('  - ' + e);
    process.exit(2);
  }

  const baseline = JSON.parse(JSON.stringify(result));
  baseline.observed = baseline.observed || {};
  baseline.observed._schema_frozen = true;

  ensureBaselinesDir();
  // For named baselines (or when user already has a folder), use the folder layout.
  const useFolder = name !== 'default' || fs.existsSync(path.join(require('../lib/runs').BASELINES_DIR, recipeId));
  let outPath;
  if (useFolder) {
    const folder = path.join(require('../lib/runs').BASELINES_DIR, recipeId);
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    outPath = path.join(folder, `${name}.json`);
  } else {
    outPath = baselinePath(recipeId);
  }
  const existed = fs.existsSync(outPath);
  fs.writeFileSync(outPath, JSON.stringify(baseline, null, 2) + '\n');

  console.log(`${existed ? 'Replaced' : 'Wrote'} ${path.relative(ROOT, outPath)}`);
  console.log(`  baseline name:  ${name}`);
  console.log(`  source run:     ${path.relative(ROOT, run.dir)}`);
  console.log(`  overall_status: ${baseline.overall_status}`);
  const observedKeys = Object.keys(baseline.observed).filter(k => k !== '_schema_frozen');
  console.log(`  observed keys:  ${observedKeys.join(', ') || '(none)'}`);
  console.log(`  schema frozen:  true`);
}

try { main(); } catch (e) { console.error('Error:', e.message); process.exit(1); }
