#!/usr/bin/env node
// Drives Playwright through a flow, captures per-step timing, screenshots,
// and (optionally) video. Produces flow_run.json + flow_metrics.json.
//
// Usage:
//   node runner/capture_flow.js <recipe-id>
//   node runner/capture_flow.js <recipe-id> --review
//   node runner/capture_flow.js <recipe-id> --model opus --review

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { chromium } = require('playwright');
const { loadEnvironmentVariables } = require('../../shared/env_loader');
const { DEFAULT_VIEWPORT_SIZES_PX } = require('../../shared/recipe_loader');
const { buildFlowReviewPrompt } = require('../lib/flow_review_prompt_builder');
const { computeFlowMetricsFromRunLog } = require('../lib/flow_metrics_computer');
const { resolveRecipeById } = require('../lib/flow_recipe_resolver');
const { PROJECT_ROOT, MONOREPO_ROOT, FLOW_RUNS_DIR } = require('../lib/flow_run_discovery');
const { DEFAULTS } = require('../config/defaults');

const MOBILE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function parseCliArgs(argv) {
  const parsed = { recipeIdOrPath: null, runReviewer: false, reviewerModel: null };
  const args = argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--review') { parsed.runReviewer = true; continue; }
    if (token === '--model')  { parsed.reviewerModel = args[index + 1]; index += 1; parsed.runReviewer = true; continue; }
    if (token === '--help' || token === '-h') { printUsage(); process.exit(0); }
    if (!parsed.recipeIdOrPath) { parsed.recipeIdOrPath = token; continue; }
    console.error(`Unknown argument: ${token}`);
    process.exit(1);
  }
  return parsed;
}

function printUsage() {
  console.error('Usage: node runner/capture_flow.js <recipe-id> [--review] [--model <preset|id>]');
}

function timestampForRunFolder() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

async function performLogin(page, recipe, stepLogForViewport) {
  if (!recipe.login) return;
  const { url: loginUrl, username, password_env: passwordEnvVarName } = recipe.login;
  const password = process.env[passwordEnvVarName];
  if (!password) {
    throw new Error(`password env var ${passwordEnvVarName} not set — add to .env.local`);
  }
  const targetUrl = /^https?:\/\//.test(loginUrl)
    ? loginUrl
    : recipe.target.base_url.replace(/\/$/, '') + (loginUrl.startsWith('/') ? loginUrl : '/' + loginUrl);
  stepLogForViewport.push({ phase: 'login', action: 'goto', url: targetUrl, duration_ms: 0 });
  await page.goto(targetUrl, {
    waitUntil: 'networkidle',
    timeout: DEFAULTS.stepNavigationTimeoutMs,
  });
  const usernameInput = await page.$(
    'input[name="username"], input[name="handle"], input[name="email"], input[autocomplete="username"], input[type="text"], input:not([type])',
  );
  const passwordInput = await page.$('input[type="password"]');
  if (!usernameInput || !passwordInput) {
    throw new Error('could not locate login inputs on ' + targetUrl);
  }
  await usernameInput.fill(username);
  await passwordInput.fill(password);
  const submitButton =
    (await page.$('button[type="submit"]')) ||
    (await page.$('button:has-text("Log in")')) ||
    (await page.$('button:has-text("Login")')) ||
    (await page.$('button:has-text("Sign in")')) ||
    (await page.$('button:has-text("Continue")'));
  if (submitButton) {
    await Promise.all([
      page.waitForLoadState('networkidle').catch(() => {}),
      submitButton.click(),
    ]);
  } else {
    await passwordInput.press('Enter');
    await page.waitForLoadState('networkidle').catch(() => {});
  }
  await page.waitForTimeout(DEFAULTS.postStepSettleMs);
  stepLogForViewport.push({ phase: 'login', action: 'submitted', url: page.url(), duration_ms: 0 });
}

async function runSingleStep(page, step, captureContext, stepLogForViewport) {
  const baseUrl = captureContext.baseUrl.replace(/\/$/, '');
  const stepStartMs = Date.now();
  switch (step.action) {
    case 'goto': {
      const targetUrl = /^https?:\/\//.test(step.path) ? step.path : baseUrl + step.path;
      await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: DEFAULTS.stepNavigationTimeoutMs });
      appendStepLog(stepLogForViewport, { action: 'goto', path: step.path, url: page.url() }, stepStartMs);
      return;
    }
    case 'click_text': {
      const locator = page.getByText(step.text, { exact: false }).first();
      await locator.waitFor({ state: 'visible', timeout: DEFAULTS.stepInteractionTimeoutMs });
      await locator.click();
      await page.waitForLoadState('networkidle').catch(() => {});
      appendStepLog(stepLogForViewport, { action: 'click_text', text: step.text }, stepStartMs);
      return;
    }
    case 'click_selector': {
      await page.locator(step.selector).first().click({ timeout: DEFAULTS.stepInteractionTimeoutMs });
      await page.waitForLoadState('networkidle').catch(() => {});
      appendStepLog(stepLogForViewport, { action: 'click_selector', selector: step.selector }, stepStartMs);
      return;
    }
    case 'fill': {
      const locator = step.selector
        ? page.locator(step.selector).first()
        : page.getByLabel(step.label).first();
      await locator.fill(String(step.value));
      appendStepLog(stepLogForViewport, { action: 'fill', label: step.label, selector: step.selector }, stepStartMs);
      return;
    }
    case 'wait': {
      await page.waitForTimeout(step.ms);
      appendStepLog(stepLogForViewport, { action: 'wait', ms: step.ms }, stepStartMs);
      return;
    }
    case 'scroll': {
      await page.evaluate(({ direction, amount }) => {
        if (direction === 'top') window.scrollTo(0, 0);
        else if (direction === 'bottom') window.scrollTo(0, document.body.scrollHeight);
        else if (direction === 'up') window.scrollBy(0, -(amount || 800));
        else window.scrollBy(0, amount || 800);
      }, { direction: step.direction, amount: step.amount });
      await page.waitForTimeout(DEFAULTS.postStepSettleMs);
      appendStepLog(stepLogForViewport, { action: 'scroll', direction: step.direction }, stepStartMs);
      return;
    }
    case 'scroll_inside': {
      const handle = step.selector
        ? await page.locator(step.selector).first().elementHandle()
        : await page.getByText(step.text, { exact: false }).first().elementHandle();
      if (!handle) throw new Error(`scroll_inside: could not locate target`);
      await page.evaluate(({ el, direction, amount }) => {
        const isScrollable = (node) => {
          if (!(node instanceof Element)) return false;
          const style = getComputedStyle(node);
          return (style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight;
        };
        let node = el;
        while (node && node !== document.body && !isScrollable(node)) node = node.parentElement;
        if (!node || node === document.body) {
          if (direction === 'top') window.scrollTo(0, 0);
          else if (direction === 'bottom') window.scrollTo(0, document.body.scrollHeight);
          else if (direction === 'up') window.scrollBy(0, -(amount || 600));
          else window.scrollBy(0, amount || 600);
          return;
        }
        if (direction === 'top') node.scrollTop = 0;
        else if (direction === 'bottom') node.scrollTop = node.scrollHeight;
        else if (direction === 'up') node.scrollTop -= (amount || 600);
        else node.scrollTop += (amount || 600);
      }, { el: handle, direction: step.direction, amount: step.amount });
      await page.waitForTimeout(DEFAULTS.postStepSettleMs);
      appendStepLog(stepLogForViewport, { action: 'scroll_inside' }, stepStartMs);
      return;
    }
    case 'screenshot': {
      const fileName = `${String(captureContext.screenshotIndex).padStart(2, '0')}_${step.name}_${captureContext.viewport}.png`;
      captureContext.screenshotIndex += 1;
      const filePath = path.join(captureContext.outDir, fileName);
      await page.screenshot({ path: filePath, fullPage: true });
      captureContext.screenshots.push({
        name: step.name,
        viewport: captureContext.viewport,
        path: path.relative(PROJECT_ROOT, filePath),
      });
      appendStepLog(stepLogForViewport, { action: 'screenshot', name: step.name }, stepStartMs);
      return;
    }
    default:
      appendStepLog(stepLogForViewport, { action: step.action, error: 'unknown action' }, stepStartMs);
  }
}

function appendStepLog(stepLogForViewport, entry, startMs) {
  stepLogForViewport.push({ ...entry, duration_ms: Date.now() - startMs });
}

async function captureFlowForRecipe({ recipe, recipePath }) {
  loadEnvironmentVariables({ projectRoot: MONOREPO_ROOT });
  const runId = timestampForRunFolder();
  const outDir = path.join(FLOW_RUNS_DIR, `${recipe.id}__${runId}`);
  fs.mkdirSync(outDir, { recursive: true });

  const shouldCaptureVideo = !!(recipe.flow_review && recipe.flow_review.captureVideo);
  const viewportSizes = DEFAULT_VIEWPORT_SIZES_PX;
  const browser = await chromium.launch({ headless: true });
  const allStepLog = [];
  const allScreenshots = [];
  const videoPaths = [];
  let runStatus = 'completed';
  let runError = null;

  try {
    for (const viewportName of (recipe.viewports || ['mobile', 'desktop'])) {
      const viewportSize = viewportSizes[viewportName];
      const contextOptions = {
        viewport: { width: viewportSize.width, height: viewportSize.height },
        userAgent: viewportName === 'mobile' ? MOBILE_USER_AGENT : undefined,
      };
      if (shouldCaptureVideo) {
        contextOptions.recordVideo = {
          dir: outDir,
          size: { width: viewportSize.width, height: viewportSize.height },
        };
      }
      const context = await browser.newContext(contextOptions);
      const page = await context.newPage();
      const stepLogForViewport = [];
      const captureContext = {
        baseUrl: recipe.target.base_url,
        outDir,
        viewport: viewportName,
        screenshotIndex: 1,
        screenshots: [],
      };
      try {
        await performLogin(page, recipe, stepLogForViewport);
        for (const step of recipe.steps) {
          await runSingleStep(page, step, captureContext, stepLogForViewport);
        }
      } catch (stepError) {
        stepLogForViewport.push({ action: 'ERROR', error: stepError.message });
        runStatus = 'failed';
        runError = stepError.message;
      }
      allScreenshots.push(...captureContext.screenshots);
      allStepLog.push({ viewport: viewportName, steps: stepLogForViewport });
      const videoInstance = page.video();
      await context.close();
      if (shouldCaptureVideo && videoInstance) {
        const sourcePath = await videoInstance.path().catch(() => null);
        if (sourcePath && fs.existsSync(sourcePath)) {
          const renamedPath = path.join(outDir, `flow_${viewportName}.webm`);
          fs.renameSync(sourcePath, renamedPath);
          videoPaths.push({ viewport: viewportName, path: path.relative(PROJECT_ROOT, renamedPath) });
        }
      }
    }
  } finally {
    await browser.close();
  }

  const metricsByViewport = computeFlowMetricsFromRunLog(allStepLog);

  const flowRunJson = {
    recipeId: recipe.id,
    recipeName: recipe.name,
    recipePath: path.relative(PROJECT_ROOT, recipePath),
    runId,
    status: runStatus,
    error: runError,
    baseUrl: recipe.target.base_url,
    viewports: recipe.viewports || ['mobile', 'desktop'],
    screenshots: allScreenshots,
    videos: videoPaths,
    stepLogByViewport: allStepLog,
  };
  fs.writeFileSync(path.join(outDir, 'flow_run.json'), JSON.stringify(flowRunJson, null, 2));
  fs.writeFileSync(path.join(outDir, 'flow_metrics.json'), JSON.stringify({
    schemaVersion: 1,
    recipeId: recipe.id,
    runId,
    perViewportMetrics: metricsByViewport,
  }, null, 2));

  const { loadReferenceFlowReport } = require('../lib/flow_run_discovery');
  const referenceFlowReport = loadReferenceFlowReport(recipe.id);
  const promptMarkdown = buildFlowReviewPrompt({
    capturedRun: flowRunJson,
    flowMetrics: metricsByViewport,
    recipe,
    referenceFlowReport,
  });
  fs.writeFileSync(path.join(outDir, 'FLOW_REVIEW_PROMPT.md'), promptMarkdown);

  return { outDir, flowRunJson, metricsByViewport };
}

async function main() {
  const cliArgs = parseCliArgs(process.argv);
  if (!cliArgs.recipeIdOrPath) { printUsage(); process.exit(1); }

  const { recipe, recipePath } = resolveRecipeById(cliArgs.recipeIdOrPath);
  console.log(`Capturing flow: ${recipe.id} (${recipe.name})`);
  const { outDir, flowRunJson } = await captureFlowForRecipe({ recipe, recipePath });

  console.log(`\n=== capture done (${flowRunJson.status}) ===`);
  console.log(`  run folder: ${path.relative(PROJECT_ROOT, outDir)}`);
  console.log(`  screenshots: ${flowRunJson.screenshots.length}`);
  if (flowRunJson.videos.length) console.log(`  videos:      ${flowRunJson.videos.length}`);
  console.log(`  prompt:      ${path.relative(PROJECT_ROOT, path.join(outDir, 'FLOW_REVIEW_PROMPT.md'))}`);

  if (flowRunJson.status !== 'completed') process.exit(2);

  if (cliArgs.runReviewer) {
    console.log('\n--- flow review ---');
    const reviewArgs = [recipe.id];
    if (cliArgs.reviewerModel) reviewArgs.push('--model', cliArgs.reviewerModel);
    const child = spawnSync(
      process.execPath,
      [path.join(__dirname, 'review_flow.js'), ...reviewArgs],
      { cwd: PROJECT_ROOT, stdio: 'inherit' },
    );
    if (child.status !== 0) process.exit(child.status || 2);
  }
}

main().catch(error => { console.error('FATAL:', error.message); process.exit(1); });
