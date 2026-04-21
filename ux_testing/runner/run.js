#!/usr/bin/env node
// Playwright runner. Reads a recipe JSON, performs login + steps at each
// viewport, captures full-page screenshots, and writes a run folder
// containing run.json and PROMPT.md (ready to paste into an AI chat).
//
// Usage:
//   node runner/run.js <recipe-id>
//   node runner/run.js recipes/<file>.json

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { chromium } = require('playwright');
const { validateRecipe, VIEWPORT_SIZES } = require('../lib/schema');
const { buildStructuredPrompt } = require('./prompt_structured');
const { loadBaseline } = require('../lib/runs');
const { normalizeRecipeChecks } = require('../lib/checks');

const ROOT = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(ROOT, '..');
const RECIPES_DIR = path.join(ROOT, 'recipes');
const RUNS_DIR = path.join(ROOT, 'runs');
const ENV_FILE = path.join(PROJECT_ROOT, '.env.local');

function loadEnvFile() {
  if (!fs.existsSync(ENV_FILE)) return;
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1);
    if (!(k in process.env)) process.env[k] = v;
  }
}

function loadRecipe(arg) {
  let file = arg;
  if (!fs.existsSync(file)) file = path.join(RECIPES_DIR, `${arg}.json`);
  if (!fs.existsSync(file)) throw new Error(`recipe not found: ${arg}`);
  const recipe = JSON.parse(fs.readFileSync(file, 'utf8'));
  const v = validateRecipe(recipe);
  if (!v.ok) throw new Error(`invalid recipe:\n  - ${v.errors.join('\n  - ')}`);
  return recipe;
}

function timestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// ----- login (best-effort, selector-free) -----
async function attemptLogin(page, recipe, log) {
  if (!recipe.login) return;
  const { url, username, password_env } = recipe.login;
  const password = process.env[password_env];
  if (!password) {
    throw new Error(`password env var ${password_env} not set — add to .env.local`);
  }

  const target = /^https?:\/\//.test(url)
    ? url
    : recipe.target.base_url.replace(/\/$/, '') + (url.startsWith('/') ? url : '/' + url);
  log.push({ phase: 'login', action: 'goto', url: target });
  await page.goto(target, { waitUntil: 'networkidle' });

  // Find the first text-ish input and the password input.
  const userInput = await page.$([
    'input[name="username"]',
    'input[name="handle"]',
    'input[name="email"]',
    'input[autocomplete="username"]',
    'input[type="text"]',
    'input:not([type])',
  ].join(', '));
  const passInput = await page.$('input[type="password"]');
  if (!userInput || !passInput) throw new Error('could not locate login inputs on ' + target);

  await userInput.fill(username);
  await passInput.fill(password);

  const submit =
    (await page.$('button[type="submit"]')) ||
    (await page.$('button:has-text("Log in")')) ||
    (await page.$('button:has-text("Login")')) ||
    (await page.$('button:has-text("Sign in")')) ||
    (await page.$('button:has-text("Continue")'));
  if (submit) {
    await Promise.all([
      page.waitForLoadState('networkidle').catch(() => {}),
      submit.click(),
    ]);
  } else {
    await passInput.press('Enter');
    await page.waitForLoadState('networkidle').catch(() => {});
  }
  await page.waitForTimeout(800);
  log.push({ phase: 'login', action: 'submitted', url: page.url() });
}

// ----- step execution -----
async function runStep(page, step, ctx, log) {
  const base = ctx.baseUrl.replace(/\/$/, '');
  switch (step.action) {
    case 'goto': {
      const target = /^https?:\/\//.test(step.path) ? step.path : base + step.path;
      await page.goto(target, { waitUntil: 'networkidle' });
      log.push({ action: 'goto', path: step.path, url: page.url(), ok: true });
      break;
    }
    case 'click_text': {
      const locator = page.getByText(step.text, { exact: false }).first();
      await locator.waitFor({ state: 'visible', timeout: 8000 });
      await locator.click();
      await page.waitForLoadState('networkidle').catch(() => {});
      log.push({ action: 'click_text', text: step.text, ok: true });
      break;
    }
    case 'click_selector': {
      await page.locator(step.selector).first().click();
      await page.waitForLoadState('networkidle').catch(() => {});
      log.push({ action: 'click_selector', selector: step.selector, ok: true });
      break;
    }
    case 'fill': {
      let loc;
      if (step.selector) loc = page.locator(step.selector).first();
      else loc = page.getByLabel(step.label).first();
      await loc.fill(String(step.value));
      log.push({ action: 'fill', label: step.label, selector: step.selector, ok: true });
      break;
    }
    case 'wait': {
      await page.waitForTimeout(step.ms);
      log.push({ action: 'wait', ms: step.ms, ok: true });
      break;
    }
    case 'scroll': {
      await page.evaluate(({ direction, amount }) => {
        if (direction === 'top') window.scrollTo(0, 0);
        else if (direction === 'bottom') window.scrollTo(0, document.body.scrollHeight);
        else if (direction === 'up') window.scrollBy(0, -(amount || 800));
        else window.scrollBy(0, amount || 800);
      }, { direction: step.direction, amount: step.amount });
      await page.waitForTimeout(300);
      log.push({ action: 'scroll', direction: step.direction, ok: true });
      break;
    }
    case 'scroll_inside': {
      // Scrolls the nearest scrollable ancestor of the target element.
      // Target can be given as CSS `selector` OR visible `text` on the modal.
      let handle;
      if (step.selector) {
        handle = await page.locator(step.selector).first().elementHandle();
      } else {
        handle = await page.getByText(step.text, { exact: false }).first().elementHandle();
      }
      if (!handle) throw new Error(`scroll_inside: could not locate target (selector="${step.selector}" text="${step.text}")`);
      await page.evaluate(({ el, direction, amount }) => {
        const isScrollable = (node) => {
          if (!(node instanceof Element)) return false;
          const s = getComputedStyle(node);
          const oy = s.overflowY;
          return (oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight;
        };
        let node = el;
        while (node && node !== document.body && !isScrollable(node)) node = node.parentElement;
        if (!node || node === document.body) {
          // Fall back to document scroll so the step doesn't silently no-op.
          if (direction === 'top') window.scrollTo(0, 0);
          else if (direction === 'bottom') window.scrollTo(0, document.body.scrollHeight);
          else if (direction === 'up') window.scrollBy(0, -(amount || 600));
          else window.scrollBy(0, amount || 600);
          return 'fell_back_to_window';
        }
        if (direction === 'top') node.scrollTop = 0;
        else if (direction === 'bottom') node.scrollTop = node.scrollHeight;
        else if (direction === 'up') node.scrollTop -= (amount || 600);
        else node.scrollTop += (amount || 600);
        return 'ok';
      }, { el: handle, direction: step.direction, amount: step.amount });
      await page.waitForTimeout(300);
      log.push({ action: 'scroll_inside', direction: step.direction, target: step.selector || step.text, ok: true });
      break;
    }
    case 'screenshot': {
      const file = path.join(ctx.outDir, `${pad(ctx.shotIndex++)}_${step.name}_${ctx.viewport}.png`);
      await page.screenshot({ path: file, fullPage: true });
      ctx.screenshots.push({ name: step.name, viewport: ctx.viewport, path: path.relative(ROOT, file) });
      log.push({ action: 'screenshot', name: step.name, viewport: ctx.viewport, ok: true });
      break;
    }
    default:
      log.push({ action: step.action, ok: false, error: 'unknown action' });
  }
}

function pad(n) { return String(n).padStart(2, '0'); }

// Prune old screenshots before writing new ones — keep only the N newest PNGs.
function runCleanup() {
  const script = path.join(ROOT, 'cleanup_runs.sh');
  if (!fs.existsSync(script)) return;
  const result = spawnSync('bash', [script], { cwd: ROOT, encoding: 'utf8' });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.status !== 0 && result.stderr) process.stderr.write(result.stderr);
}

// ----- orchestration -----
async function runRecipe(recipe) {
  loadEnvFile();
  runCleanup();
  const runId = timestamp();
  const outDir = path.join(RUNS_DIR, `${recipe.id}__${runId}`);
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const allLog = [];
  const allScreens = [];
  let status = 'completed';
  let error = null;

  try {
    for (const viewport of recipe.viewports) {
      const size = VIEWPORT_SIZES[viewport];
      const context = await browser.newContext({
        viewport: size,
        userAgent: viewport === 'mobile'
          ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
          : undefined,
      });
      const page = await context.newPage();
      const vpLog = [];
      const ctx = { baseUrl: recipe.target.base_url, outDir, viewport, shotIndex: 1, screenshots: [] };

      try {
        await attemptLogin(page, recipe, vpLog);
        for (const step of recipe.steps) {
          await runStep(page, step, ctx, vpLog);
        }
      } catch (stepErr) {
        vpLog.push({ action: 'ERROR', error: stepErr.message });
        status = 'failed';
        error = stepErr.message;
        // capture failure screenshot
        const file = path.join(outDir, `99_FAILURE_${viewport}.png`);
        try { await page.screenshot({ path: file, fullPage: true }); ctx.screenshots.push({ name: 'FAILURE', viewport, path: path.relative(ROOT, file) }); } catch {}
      }
      allScreens.push(...ctx.screenshots);
      allLog.push({ viewport, steps: vpLog });
      await context.close();
    }
  } finally {
    await browser.close();
  }

  const runJson = {
    recipe_id: recipe.id,
    recipe_name: recipe.name,
    description: recipe.description || '',
    base_url: recipe.target.base_url,
    started_at: runId,
    status,
    error,
    viewports: recipe.viewports,
    checks: normalizeRecipeChecks(recipe.checks).map(c => c.text),
    checks_normalized: normalizeRecipeChecks(recipe.checks),
    screenshots: allScreens,
    steps_log: allLog,
  };
  fs.writeFileSync(path.join(outDir, 'run.json'), JSON.stringify(runJson, null, 2));

  // Human-pasteable prompt for the AI reviewer.
  const prompt = buildPrompt(runJson, outDir);
  fs.writeFileSync(path.join(outDir, 'PROMPT.md'), prompt);

  // Structured-review prompt. When a baseline exists, inline its observed keys
  // so the reviewer returns the same shape.
  const baseline = loadBaseline(recipe.id);
  const structuredPrompt = buildStructuredPrompt(runJson, recipe, baseline);
  fs.writeFileSync(path.join(outDir, 'PROMPT_STRUCTURED.md'), structuredPrompt);

  return { outDir, runJson };
}

function buildPrompt(run, outDir) {
  const relDir = path.relative(ROOT, outDir);
  const lines = [];
  lines.push(`# AI UX Test Review — ${run.recipe_name}`);
  lines.push('');
  lines.push(`**Recipe:** \`${run.recipe_id}\`  `);
  lines.push(`**Run:** \`${run.started_at}\`  `);
  lines.push(`**Status:** \`${run.status}\`${run.error ? `  — ${run.error}` : ''}`);
  lines.push('');
  lines.push(`**Description:** ${run.description || '(none)'}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Instructions for the AI');
  lines.push('');
  lines.push('Open each screenshot listed below with your vision tool and evaluate the checks. For each check, report ✅ pass / ❌ fail / ⚠️ unclear, and quote what you actually saw in the image. If any screenshot shows an error banner, empty state, or broken layout, call that out even if it is not in the checks list.');
  lines.push('');
  lines.push('## Screenshots');
  lines.push('');
  for (const s of run.screenshots) {
    lines.push(`- \`${s.path}\` — ${s.name} (${s.viewport})`);
  }
  lines.push('');
  lines.push('## Checks to evaluate');
  lines.push('');
  run.checks.forEach((c, i) => lines.push(`${i + 1}. ${c}`));
  lines.push('');
  lines.push('## Step log (for context)');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(run.steps_log, null, 2));
  lines.push('```');
  lines.push('');
  lines.push(`Full run record: \`${path.join(relDir, 'run.json')}\``);
  return lines.join('\n');
}

function parseRunArgs(argv) {
  const out = { arg: null, review: false, model: null, prepare: false };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--review') { out.review = true; continue; }
    if (a === '--model')  { out.model = args[++i]; out.review = true; continue; }
    if (a === '--prepare') { out.prepare = true; continue; }
    if (!out.arg) { out.arg = a; continue; }
    console.error(`Unknown argument: ${a}`);
    process.exit(1);
  }
  if (!out.review && process.env.AI_UX_TEST_AUTO_REVIEW === '1') out.review = true;
  if (out.review && out.prepare) {
    console.error('--review and --prepare are mutually exclusive (pick the API path or the paste-to-Claude-Code path).');
    process.exit(1);
  }
  return out;
}

async function main() {
  const { arg, review, model, prepare } = parseRunArgs(process.argv);
  if (!arg) {
    console.error('usage: node runner/run.js <recipe-id | path-to-recipe.json> [--review [--model <preset|id>] | --prepare]');
    process.exit(1);
  }
  const recipe = loadRecipe(arg);
  console.log(`Running recipe: ${recipe.id} (${recipe.name})`);
  const { outDir, runJson } = await runRecipe(recipe);
  console.log(`\n=== done (${runJson.status}) ===`);
  console.log(`  run folder: ${path.relative(ROOT, outDir)}`);
  console.log(`  screenshots: ${runJson.screenshots.length}`);
  console.log(`  feed to AI (freeform):   ${path.relative(ROOT, path.join(outDir, 'PROMPT.md'))}`);
  console.log(`  feed to AI (structured): ${path.relative(ROOT, path.join(outDir, 'PROMPT_STRUCTURED.md'))}`);

  if (runJson.status !== 'completed') process.exit(2);

  if (review) {
    console.log('\n--- auto-review (API) ---');
    await runAutoReview(recipe.id, model);
  } else if (prepare) {
    console.log('\n--- prepare for Claude Code (no API call) ---');
    runPrepare(recipe.id);
  }
}

async function runAutoReview(recipeId, model) {
  // Invoke the review CLI in-process so errors surface cleanly.
  const args = [recipeId];
  if (model) args.push('--model', model);
  args.push('--force');
  const child = spawnSync(process.execPath, [path.join(__dirname, 'review.js'), ...args], {
    cwd: ROOT, stdio: 'inherit',
  });
  if (child.status !== 0) process.exit(child.status || 2);
}

function runPrepare(recipeId) {
  const child = spawnSync(process.execPath, [path.join(__dirname, 'prepare_review.js'), recipeId], {
    cwd: ROOT, stdio: 'inherit',
  });
  if (child.status !== 0) process.exit(child.status || 2);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
