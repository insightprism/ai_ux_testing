#!/usr/bin/env node
// Prepare a run for review in Claude Code (or any AI chat with filesystem access).
//
// Reads the run's PROMPT_STRUCTURED.md, rewrites relative screenshot paths to
// absolute paths so Claude Code's Read tool can open them from any cwd, and
// either copies the result to the clipboard (if a clipboard tool is available)
// or writes it to a "paste-ready" file in the run folder.
//
// Usage:
//   node runner/prepare_review.js <recipe-id>                  # latest run
//   node runner/prepare_review.js <recipe-id> --run <ts>       # specific run
//   node runner/prepare_review.js <recipe-id> --stdout         # print to stdout, no clipboard/file
//
// After pasting into Claude Code and getting JSON back, save it with:
//   node runner/save_result.js <recipe-id> < response.json

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, latestRun, findRun } = require('../lib/runs');

function parseArgs(argv) {
  const out = { recipeId: null, runId: null, stdout: false };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--run') { out.runId = args[++i]; continue; }
    if (a === '--stdout') { out.stdout = true; continue; }
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
  console.error('  node runner/prepare_review.js <recipe-id> [--run <timestamp>] [--stdout]');
  console.error('');
  console.error('Rewrites screenshot paths in PROMPT_STRUCTURED.md to absolute paths and');
  console.error('copies the prompt to the clipboard (or writes it to PASTE_ME.md if no');
  console.error('clipboard tool is available). Paste the result into Claude Code.');
}

// Rewrite relative screenshot paths (`runs/<...>/<file>.png`) to absolute paths
// so Claude Code can find them no matter where it's invoked from.
function absolutizeScreenshotPaths(markdown) {
  return markdown.replace(/`(runs\/[^`]+\.png)`/g, (_, rel) => {
    return '`' + path.join(ROOT, rel) + '`';
  });
}

function copyToClipboard(text) {
  const candidates = [
    { cmd: 'xclip', args: ['-selection', 'clipboard'] },
    { cmd: 'xsel',  args: ['--clipboard', '--input'] },
    { cmd: 'wl-copy', args: [] },
    { cmd: 'pbcopy', args: [] },        // macOS
    { cmd: 'clip.exe', args: [] },      // WSL
  ];
  for (const c of candidates) {
    const probe = spawnSync('which', [c.cmd], { encoding: 'utf8' });
    if (probe.status !== 0) continue;
    const res = spawnSync(c.cmd, c.args, { input: text, encoding: 'utf8' });
    if (res.status === 0) return c.cmd;
  }
  return null;
}

function main() {
  const { recipeId, runId, stdout } = parseArgs(process.argv);
  if (!recipeId) { printUsage(); process.exit(1); }

  const run = runId ? findRun(recipeId, runId) : latestRun(recipeId);
  if (!run) {
    console.error(runId ? `no run matching ${recipeId}__${runId}` : `no runs found for "${recipeId}"`);
    process.exit(1);
  }

  const promptPath = path.join(run.dir, 'PROMPT_STRUCTURED.md');
  if (!fs.existsSync(promptPath)) {
    console.error(`run is missing PROMPT_STRUCTURED.md — re-run the recipe.`);
    process.exit(1);
  }
  const raw = fs.readFileSync(promptPath, 'utf8');
  const prepared = absolutizeScreenshotPaths(raw);

  if (stdout) {
    process.stdout.write(prepared);
    return;
  }

  const clip = copyToClipboard(prepared);
  if (clip) {
    console.log(`Prompt copied to clipboard via ${clip}.`);
    console.log(`  run:    ${path.relative(ROOT, run.dir)}`);
    console.log('');
    console.log('Next steps:');
    console.log('  1. Paste into Claude Code (or any AI with filesystem access + vision).');
    console.log('  2. Claude returns JSON. Save it to a file, e.g. /tmp/response.json');
    console.log(`  3. node runner/save_result.js ${recipeId} < /tmp/response.json`);
    console.log(`  4. node runner/diff.js ${recipeId}`);
    return;
  }

  // No clipboard tool — fall back to a sibling file with absolute paths.
  const pasteFile = path.join(run.dir, 'PASTE_ME.md');
  fs.writeFileSync(pasteFile, prepared);
  console.log('No clipboard tool found (xclip / xsel / wl-copy / pbcopy / clip.exe).');
  console.log(`Wrote paste-ready prompt to ${path.relative(ROOT, pasteFile)}`);
  console.log('');
  console.log('Next steps:');
  console.log(`  1. Open ${path.relative(ROOT, pasteFile)} and copy its contents.`);
  console.log('  2. Paste into Claude Code (or any AI with filesystem access + vision).');
  console.log('  3. Claude returns JSON. Save it to a file, e.g. /tmp/response.json');
  console.log(`  4. node runner/save_result.js ${recipeId} < /tmp/response.json`);
  console.log(`  5. node runner/diff.js ${recipeId}`);
}

try { main(); } catch (e) { console.error('Error:', e.message); process.exit(1); }
