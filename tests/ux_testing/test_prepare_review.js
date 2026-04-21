// Tests for runner/prepare_review.js — the paste-to-Claude-Code helper.
//
// Covers:
//   - absolute-path rewriting of screenshot references
//   - non-PNG paths and non-runs/ paths are left alone
//   - idempotence (already-absolute paths stay absolute)
//   - CLI surface: --stdout, --run, missing run folder, missing prompt,
//     clipboard fallback to PASTE_ME.md

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { assert, assertEqual, describe, summary } = require('./_harness');

const ROOT = path.resolve(__dirname, '..', '..', 'ux_testing');
const RUNS_DIR = path.join(ROOT, 'runs');
const SCRIPT = path.join(ROOT, 'runner', 'prepare_review.js');

// Scratch namespace so these folders never collide with real runs.
const NS = '__test_prepare_review__';
const recipeId = `${NS}__recipe`;

function scratchDir(ts) {
  return path.join(RUNS_DIR, `${recipeId}__${ts}`);
}

function writePrompt(dir, body) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'PROMPT_STRUCTURED.md'), body);
}

function cleanup() {
  if (!fs.existsSync(RUNS_DIR)) return;
  for (const d of fs.readdirSync(RUNS_DIR)) {
    if (d.startsWith(recipeId + '__')) fs.rmSync(path.join(RUNS_DIR, d), { recursive: true, force: true });
  }
}

function runScript(args, { env = {} } = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

// Import the module directly to exercise its pure path-rewrite helper.
// absolutizeScreenshotPaths isn't exported, so we re-implement the exact
// regex and assert our CLI output matches it — keeps this a black-box test.
function expectedAbsolutize(md) {
  return md.replace(/`(runs\/[^`]+\.png)`/g, (_, rel) => '`' + path.join(ROOT, rel) + '`');
}

try {
  cleanup();

  // Set up two scratch runs. The newer one ("b") is the "latest"; "a" is older.
  const tsA = '20250101-100000';
  const tsB = '20250101-110000';
  const dirA = scratchDir(tsA);
  const dirB = scratchDir(tsB);

  const promptA = [
    '# Header',
    '',
    '## Screenshots',
    '',
    '- `runs/' + path.basename(dirA) + '/01_home_desktop.png` — home (desktop)',
    '- `runs/' + path.basename(dirA) + '/02_profile_mobile.png` — profile (mobile)',
    '',
    '## Not a screenshot path',
    '',
    '- `runs/' + path.basename(dirA) + '/run.json` is metadata, not an image.',
    '- `some/other/path/logo.png` is not in runs/, leave it alone.',
    '',
  ].join('\n');
  writePrompt(dirA, promptA);

  const promptB = [
    '# Newer',
    '',
    '- `runs/' + path.basename(dirB) + '/01_shot_desktop.png` — shot',
    '',
  ].join('\n');
  writePrompt(dirB, promptB);

  describe('--stdout: rewrites runs/*.png paths to absolute paths', () => {
    const r = runScript([recipeId, '--run', tsA, '--stdout']);
    assertEqual(r.status, 0, `exit code (stderr: ${r.stderr})`);
    const out = r.stdout;
    assert(out.includes('`' + path.join(ROOT, 'runs', path.basename(dirA), '01_home_desktop.png') + '`'),
      '01 screenshot should be absolute');
    assert(out.includes('`' + path.join(ROOT, 'runs', path.basename(dirA), '02_profile_mobile.png') + '`'),
      '02 screenshot should be absolute');
    assertEqual(out, expectedAbsolutize(promptA), 'full output matches pure-function rewrite');
  });

  describe('--stdout: leaves non-PNG and non-runs/ paths alone', () => {
    const r = runScript([recipeId, '--run', tsA, '--stdout']);
    const out = r.stdout;
    assert(out.includes('`runs/' + path.basename(dirA) + '/run.json`'), 'run.json path untouched');
    assert(out.includes('`some/other/path/logo.png`'), 'non-runs/ path untouched');
    // Negative check: no /runs/<dir>/run.json got absolutized.
    assert(!out.includes(path.join(ROOT, 'runs', path.basename(dirA), 'run.json')),
      'run.json was NOT absolutized (only *.png in runs/ should be)');
  });

  describe('--stdout: writes no clipboard file (pure stdout path)', () => {
    const before = fs.existsSync(path.join(dirA, 'PASTE_ME.md'));
    const r = runScript([recipeId, '--run', tsA, '--stdout']);
    assertEqual(r.status, 0, 'exit code');
    const after = fs.existsSync(path.join(dirA, 'PASTE_ME.md'));
    assertEqual(before, false, 'no PASTE_ME.md before');
    assertEqual(after, false, 'no PASTE_ME.md after (--stdout must not write files)');
  });

  describe('latest-run selection: no --run flag picks newest timestamp', () => {
    const r = runScript([recipeId, '--stdout']);
    assertEqual(r.status, 0, 'exit code');
    assert(r.stdout.includes('# Newer'), 'should emit the newer run\'s prompt body');
    assert(!r.stdout.includes('# Header'), 'should NOT emit the older run\'s body');
  });

  describe('--run picks the specific run even when older', () => {
    const r = runScript([recipeId, '--run', tsA, '--stdout']);
    assert(r.stdout.includes('# Header'), 'explicit --run should select tsA even though tsB is newer');
  });

  describe('clipboard fallback: writes PASTE_ME.md when no clipboard tool is available', () => {
    // Force "no clipboard tool" by putting an empty PATH so `which` finds nothing.
    const pasteFile = path.join(dirA, 'PASTE_ME.md');
    if (fs.existsSync(pasteFile)) fs.unlinkSync(pasteFile);

    const r = runScript([recipeId, '--run', tsA], { env: { PATH: '/nonexistent' } });
    assertEqual(r.status, 0, `exit code (stderr: ${r.stderr})`);
    assert(fs.existsSync(pasteFile), 'PASTE_ME.md should be written on fallback');
    const contents = fs.readFileSync(pasteFile, 'utf8');
    assertEqual(contents, expectedAbsolutize(promptA), 'PASTE_ME.md has the absolutized prompt');
    assert(r.stdout.includes('No clipboard tool found'), 'stdout explains the fallback');
    assert(r.stdout.includes('PASTE_ME.md'), 'stdout mentions the fallback file');
  });

  describe('idempotence: already-absolute PNG paths stay unchanged', () => {
    const absPrompt = '- `' + path.join(ROOT, 'runs', 'whatever', '01.png') + '` — shot\n';
    // Writing to a fresh scratch dir so the inner read path is clean.
    const tsC = '20250101-120000';
    const dirC = scratchDir(tsC);
    writePrompt(dirC, absPrompt);
    const r = runScript([recipeId, '--run', tsC, '--stdout']);
    assertEqual(r.status, 0, 'exit code');
    assertEqual(r.stdout, absPrompt, 'absolute paths survive a second pass unchanged');
  });

  describe('error: missing recipe/run', () => {
    const r = runScript([`${NS}__does_not_exist`, '--stdout']);
    assert(r.status !== 0, 'should exit non-zero');
    assert(/no runs found/i.test(r.stderr), `stderr should explain missing runs; got: ${r.stderr}`);
  });

  describe('error: --run pointing at nonexistent timestamp', () => {
    const r = runScript([recipeId, '--run', '99999999-000000', '--stdout']);
    assert(r.status !== 0, 'should exit non-zero');
    assert(/no run matching/i.test(r.stderr), `stderr should explain missing run; got: ${r.stderr}`);
  });

  describe('error: run folder exists but has no PROMPT_STRUCTURED.md', () => {
    const tsD = '20250101-130000';
    const dirD = scratchDir(tsD);
    fs.mkdirSync(dirD, { recursive: true });
    // Intentionally do NOT write PROMPT_STRUCTURED.md.
    const r = runScript([recipeId, '--run', tsD, '--stdout']);
    assert(r.status !== 0, 'should exit non-zero');
    assert(/PROMPT_STRUCTURED\.md/.test(r.stderr), `stderr should mention the missing file; got: ${r.stderr}`);
  });

  describe('error: no recipe id given', () => {
    const r = runScript([]);
    assert(r.status !== 0, 'should exit non-zero');
    assert(/usage/i.test(r.stderr), 'stderr should show usage');
  });

  describe('error: unknown flag', () => {
    const r = runScript([recipeId, '--no-such-flag']);
    assert(r.status !== 0, 'should exit non-zero');
    assert(/unknown argument/i.test(r.stderr), `stderr should flag unknown arg; got: ${r.stderr}`);
  });
} finally {
  cleanup();
}

summary('test_prepare_review');
