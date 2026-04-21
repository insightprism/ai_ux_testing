#!/usr/bin/env node
// Validates AI-returned JSON and writes it to the latest run's result.json.
// See docs/SPEC_BASELINE_REGRESSION.md §5.7 (manual reviewer path).
//
// Usage:
//   node runner/save_result.js <recipe-id> < path/to/ai_output.json
//   node runner/save_result.js <recipe-id> path/to/ai_output.json
//   node runner/save_result.js <recipe-id> --run <timestamp> < path/to/ai_output.json

const fs = require('fs');
const path = require('path');
const { validateResult } = require('../lib/result_schema');
const { ROOT, latestRun, findRun } = require('../lib/runs');

function parseArgs(argv) {
  const out = { recipeId: null, runId: null, filePath: null };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--run') { out.runId = args[++i]; continue; }
    if (a === '--help' || a === '-h') { printUsage(); process.exit(0); }
    if (!out.recipeId) { out.recipeId = a; continue; }
    out.filePath = a;
  }
  return out;
}

function printUsage() {
  console.error('Usage:');
  console.error('  node runner/save_result.js <recipe-id> [file.json]');
  console.error('  node runner/save_result.js <recipe-id> --run <timestamp> [file.json]');
  console.error('');
  console.error('Reads JSON from stdin if no file is given. Validates it against lib/result_schema.js,');
  console.error('then writes it to runs/<recipe-id>__<timestamp>/result.json.');
}

function findRunDir(recipeId, runId) {
  const hit = runId ? findRun(recipeId, runId) : latestRun(recipeId);
  if (!hit) {
    throw new Error(runId
      ? `no run matching ${recipeId}__${runId}`
      : `no runs found for recipe "${recipeId}"`);
  }
  return hit;
}

function readJson(filePath) {
  const raw = filePath
    ? fs.readFileSync(filePath, 'utf8')
    : fs.readFileSync(0, 'utf8');
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('no JSON input (stdin or file was empty)');
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    throw new Error(`invalid JSON: ${e.message}`);
  }
}

function main() {
  const { recipeId, runId, filePath } = parseArgs(process.argv);
  if (!recipeId) { printUsage(); process.exit(1); }

  const run = findRunDir(recipeId, runId);
  const resultPath = path.join(run.dir, 'result.json');

  const parsed = readJson(filePath);
  const { ok, errors } = validateResult(parsed);
  if (!ok) {
    console.error('Validation failed:');
    for (const e of errors) console.error('  - ' + e);
    process.exit(2);
  }

  if (parsed.recipe_id !== recipeId) {
    console.error(`recipe_id mismatch: file says "${parsed.recipe_id}", target is "${recipeId}"`);
    process.exit(2);
  }
  if (parsed.run_id !== run.runId) {
    console.error(`run_id mismatch: file says "${parsed.run_id}", target run is "${run.runId}"`);
    console.error(`  (use --run ${parsed.run_id} to target that run explicitly)`);
    process.exit(2);
  }

  fs.writeFileSync(resultPath, JSON.stringify(parsed, null, 2) + '\n');
  console.log(`Wrote ${path.relative(ROOT, resultPath)}`);
  console.log(`  overall_status: ${parsed.overall_status}`);
  console.log(`  checks: ${parsed.checks.length} (${parsed.checks.filter(c => c.verdict === 'pass').length} pass, ${parsed.checks.filter(c => c.verdict === 'fail').length} fail, ${parsed.checks.filter(c => c.verdict === 'warn').length} warn)`);
  console.log(`  observed keys: ${Object.keys(parsed.observed).filter(k => k !== '_schema_frozen').join(', ') || '(none)'}`);
}

try { main(); } catch (e) { console.error('Error:', e.message); process.exit(1); }
