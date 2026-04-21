#!/usr/bin/env node
// Diff the latest reviewed run against the recipe's baseline.
// See docs/SPEC_BASELINE_REGRESSION.md §5.6.
//
// Usage:
//   node runner/diff.js <recipe-id>
//   node runner/diff.js <recipe-id> --run <timestamp>
//   node runner/diff.js <recipe-id> --verbose
//
// Exit codes:
//   0  — no regression, no schema break (unchanged / improvements / additions only)
//   2  — regression or schema break detected
//   1  — error (no baseline, no result, etc.)

const fs = require('fs');
const path = require('path');
const { diffResults } = require('../lib/diff_engine');
const { ROOT, latestResult, findRun, loadBaseline, loadResult, baselinePath } = require('../lib/runs');

function loadRecipeIgnoreKeys(recipeId) {
  const file = path.join(ROOT, 'recipes', `${recipeId}.json`);
  if (!fs.existsSync(file)) return [];
  try {
    const recipe = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(recipe.ignore_observed) ? recipe.ignore_observed : [];
  } catch { return []; }
}

function parseArgs(argv) {
  const out = { recipeId: null, runId: null, baselineName: 'default', verbose: false };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--run') { out.runId = args[++i]; continue; }
    if (a === '--baseline') { out.baselineName = args[++i]; continue; }
    if (a === '--verbose' || a === '-v') { out.verbose = true; continue; }
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
  console.error('  node runner/diff.js <recipe-id>');
  console.error('  node runner/diff.js <recipe-id> --run <timestamp>');
  console.error('  node runner/diff.js <recipe-id> --verbose');
}

function main() {
  const { recipeId, runId, baselineName, verbose } = parseArgs(process.argv);
  if (!recipeId) { printUsage(); process.exit(1); }

  const baseline = loadBaseline(recipeId, baselineName);
  if (!baseline) {
    console.log(`No baseline "${baselineName}" yet for "${recipeId}" — run approve.js to set one.`);
    console.log(`  Expected at: ${path.relative(ROOT, baselinePath(recipeId, baselineName))}`);
    process.exit(0);
  }

  const run = runId ? findRun(recipeId, runId) : latestResult(recipeId);
  if (!run) {
    console.error(runId
      ? `No run matching ${recipeId}__${runId}`
      : `No reviewed run found for "${recipeId}" — run the recipe and save_result.js first.`);
    process.exit(1);
  }
  if (!run.hasResult) {
    console.error(`Run ${run.dirName} has no result.json — paste PROMPT_STRUCTURED.md to reviewer and save it first.`);
    process.exit(1);
  }

  const current = loadResult(run.dir);
  const ignoreKeys = loadRecipeIgnoreKeys(recipeId);
  const d = diffResults(baseline, current, { ignoreKeys });

  const md = renderMarkdown(recipeId, run, baseline, current, d, verbose);
  const outPath = path.join(run.dir, 'diff.md');
  fs.writeFileSync(outPath, md);

  // stdout: compact, colored-ish summary.
  printStdout(recipeId, run, baseline, d, verbose);
  console.log('');
  console.log(`Wrote ${path.relative(ROOT, outPath)}`);

  if (d.hasRegression || d.hasSchemaBreak) process.exit(2);
}

function renderMarkdown(recipeId, run, baseline, current, d, verbose) {
  const lines = [];
  lines.push(`# Diff — ${recipeId}`);
  lines.push('');
  lines.push(`Baseline: \`baselines/${recipeId}.json\` (reviewed ${baseline.reviewed_at})`);
  lines.push(`Current:  \`runs/${run.dirName}/result.json\` (reviewed ${current.reviewed_at})`);
  lines.push('');
  lines.push(`**Summary:** ${d.summary}`);
  lines.push('');

  lines.push('## Status');
  lines.push(`- overall: ${d.overall.baseline} → ${d.overall.current} ${statusIcon(d.overall)}`);
  lines.push('');

  lines.push('## Checks');
  for (const c of d.checks) {
    const icon = checkIcon(c.kind);
    switch (c.kind) {
      case 'regression':
        lines.push(`- ${icon} "${c.instruction}": ${c.baselineVerdict} → ${c.currentVerdict} (regression)`);
        break;
      case 'improvement':
        lines.push(`- ${icon} "${c.instruction}": ${c.baselineVerdict} → ${c.currentVerdict} (improvement)`);
        break;
      case 'flipped':
        lines.push(`- ${icon} "${c.instruction}": ${c.baselineVerdict} → ${c.currentVerdict}`);
        break;
      case 'removed':
        lines.push(`- ${icon} "${c.instruction}": removed from current run`);
        break;
      case 'added':
        lines.push(`- ${icon} "${c.instruction}": new (verdict ${c.currentVerdict})`);
        break;
      case 'unchanged':
        if (verbose) lines.push(`- ${icon} "${c.instruction}": unchanged (${c.currentVerdict})`);
        break;
    }
  }
  if (!verbose && d.checks.every(c => c.kind === 'unchanged')) {
    lines.push('- all checks unchanged');
  }
  lines.push('');

  if (d.renamed.length) {
    lines.push('### Possibly renamed checks');
    for (const r of d.renamed) {
      lines.push(`- ⚠️  Check at position ${r.index} may have been renamed:`);
      lines.push(`    was: "${r.was}"`);
      lines.push(`    now: "${r.now}"`);
    }
    lines.push('');
  }

  lines.push('## Observed fields');
  for (const o of d.observed) {
    switch (o.kind) {
      case 'missing':
        lines.push(`- ❌ \`${o.key}\`: missing in current (baseline had \`${JSON.stringify(o.baseline)}\`) — schema break`);
        break;
      case 'extra':
        lines.push(`- ⚠️  \`${o.key}\`: extra in current (\`${JSON.stringify(o.current)}\`) — not in baseline`);
        break;
      case 'changed':
        lines.push(`- 🔸 \`${o.key}\`: \`${JSON.stringify(o.baseline)}\` → \`${JSON.stringify(o.current)}\``);
        break;
      case 'array_changed':
        if (o.added.length) lines.push(`- 🔸 \`${o.key}\`: added ${JSON.stringify(o.added)}`);
        if (o.removed.length) lines.push(`- 🔸 \`${o.key}\`: removed ${JSON.stringify(o.removed)}`);
        break;
      case 'unchanged':
        if (verbose) lines.push(`- ✅ \`${o.key}\`: unchanged`);
        break;
    }
  }
  if (!verbose && d.observed.every(o => o.kind === 'unchanged')) {
    lines.push('- all observed fields unchanged');
  }
  lines.push('');

  return lines.join('\n');
}

function statusIcon(o) {
  if (o.baseline === o.current) return '✅';
  if (o.current === 'fail') return '❌';
  if (o.current === 'warn') return '⚠️';
  return '🔸';
}

function checkIcon(kind) {
  return kind === 'regression' ? '❌'
    : kind === 'improvement' ? '🟢'
    : kind === 'removed' ? '➖'
    : kind === 'added' ? '➕'
    : kind === 'flipped' ? '🔸'
    : '✅';
}

function printStdout(recipeId, run, baseline, d, verbose) {
  console.log(`Diff — ${recipeId}`);
  console.log(`  baseline:  ${baseline.reviewed_at}`);
  console.log(`  current:   ${run.dirName} (${d.overall.current})`);
  console.log(`  ${d.summary}`);
  const notable = d.checks.filter(c => c.kind !== 'unchanged');
  if (notable.length) {
    console.log('');
    console.log('  Checks:');
    for (const c of notable) {
      console.log(`    [${c.kind}] ${c.instruction}`);
    }
  }
  const notableObs = d.observed.filter(o => o.kind !== 'unchanged');
  if (notableObs.length) {
    console.log('');
    console.log('  Observed:');
    for (const o of notableObs) {
      if (o.kind === 'array_changed') {
        if (o.added.length) console.log(`    [added]   ${o.key}: ${JSON.stringify(o.added)}`);
        if (o.removed.length) console.log(`    [removed] ${o.key}: ${JSON.stringify(o.removed)}`);
      } else if (o.kind === 'changed') {
        console.log(`    [changed] ${o.key}: ${JSON.stringify(o.baseline)} → ${JSON.stringify(o.current)}`);
      } else {
        console.log(`    [${o.kind}] ${o.key}`);
      }
    }
  }
  if (d.renamed.length) {
    console.log('');
    console.log('  Possibly renamed checks:');
    for (const r of d.renamed) {
      console.log(`    position ${r.index}: "${r.was}" → "${r.now}"`);
    }
  }
}

try { main(); } catch (e) { console.error('Error:', e.message); process.exit(1); }
