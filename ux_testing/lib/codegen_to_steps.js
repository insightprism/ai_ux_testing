// Parse a Playwright codegen javascript file into our recipe-step schema.
//
// Codegen emits JS like:
//
//   const { chromium } = require('playwright');
//   (async () => {
//     const browser = await chromium.launch({ headless: false });
//     const context = await browser.newContext();
//     const page = await context.newPage();
//     await page.goto('http://localhost:19995/');
//     await page.getByRole('link', { name: 'Personality' }).click();
//     await page.getByLabel('Username').fill('markly.1');
//     await page.locator('#x').click();
//     ...
//     await browser.close();
//   })();
//
// We translate each `await page.xxx(...)` call into a recipe step. Anything
// we don't recognize becomes a `click_selector` fallback when it's a click,
// or is skipped if it's irrelevant (launch/newContext/newPage/close).

function parseCodegenScript(source, options = {}) {
  const { baseUrl = '' } = options;
  const lines = source.split('\n').map(l => l.trim()).filter(Boolean);
  const steps = [];
  const warnings = [];
  let lastWasNavigation = false;
  let autoShotIdx = 1;

  const maybeInsertShot = (reason) => {
    if (!lastWasNavigation) return;
    steps.push({ action: 'wait', ms: 800 });
    steps.push({ action: 'screenshot', name: `auto_${autoShotIdx++}_${reason}` });
    lastWasNavigation = false;
  };

  for (const line of lines) {
    if (!line.startsWith('await page.')) continue;

    // page.goto('URL')
    let m = line.match(/^await page\.goto\(\s*(['"`])(.+?)\1\s*(?:,\s*[^)]*)?\)\s*;?$/);
    if (m) {
      const target = m[2];
      const path = toPath(target, baseUrl);
      steps.push({ action: 'goto', path });
      lastWasNavigation = true;
      continue;
    }

    // page.getByText(...).click()  or  page.getByRole(..., { name: '...' }).click()
    m = line.match(/^await page\.getByText\(\s*(['"`])(.+?)\1\s*(?:,\s*[^)]*)?\)(?:\.[a-zA-Z0-9_]+\([^)]*\))*\.click\(\s*\)\s*;?$/);
    if (m) {
      maybeInsertShot('before_click');
      steps.push({ action: 'click_text', text: m[2] });
      lastWasNavigation = true;
      continue;
    }
    m = line.match(/^await page\.getByRole\(\s*(['"`])[^'"`]+\1\s*,\s*\{\s*name:\s*(['"`])(.+?)\2[^}]*\}\s*\)(?:\.[a-zA-Z0-9_]+\([^)]*\))*\.click\(\s*\)\s*;?$/);
    if (m) {
      maybeInsertShot('before_click');
      steps.push({ action: 'click_text', text: m[3] });
      lastWasNavigation = true;
      continue;
    }
    m = line.match(/^await page\.getByLabel\(\s*(['"`])(.+?)\1\s*(?:,\s*[^)]*)?\)(?:\.[a-zA-Z0-9_]+\([^)]*\))*\.click\(\s*\)\s*;?$/);
    if (m) {
      maybeInsertShot('before_click');
      steps.push({ action: 'click_text', text: m[2] });
      lastWasNavigation = true;
      continue;
    }

    // page.getByLabel('X').fill('Y')   or   .getByPlaceholder('X').fill('Y')
    m = line.match(/^await page\.(getByLabel|getByPlaceholder)\(\s*(['"`])(.+?)\2\s*(?:,\s*[^)]*)?\)(?:\.[a-zA-Z0-9_]+\([^)]*\))*\.fill\(\s*(['"`])(.*?)\4\s*\)\s*;?$/);
    if (m) {
      const label = m[3];
      const value = m[5];
      const step = { action: 'fill', label, value };
      scrubPasswordInPlace(step, label);
      steps.push(step);
      continue;
    }

    // page.locator('SEL').fill('Y')
    m = line.match(/^await page\.locator\(\s*(['"`])(.+?)\1\s*\)(?:\.[a-zA-Z0-9_]+\([^)]*\))*\.fill\(\s*(['"`])(.*?)\3\s*\)\s*;?$/);
    if (m) {
      const selector = m[2];
      const value = m[4];
      const step = { action: 'fill', selector, value };
      scrubPasswordInPlace(step, selector);
      steps.push(step);
      continue;
    }

    // page.locator('SEL').click()
    m = line.match(/^await page\.locator\(\s*(['"`])(.+?)\1\s*\)(?:\.[a-zA-Z0-9_]+\([^)]*\))*\.click\(\s*\)\s*;?$/);
    if (m) {
      maybeInsertShot('before_click');
      steps.push({ action: 'click_selector', selector: m[2] });
      lastWasNavigation = true;
      continue;
    }

    // page.press('Enter')  or  page.keyboard.press('Enter') — we generally ignore key presses
    // except Enter after fill often submits a form → treat as a wait + navigation marker.
    if (/^await page\.(keyboard\.)?press\(\s*['"`]Enter['"`]/.test(line)) {
      steps.push({ action: 'wait', ms: 600 });
      lastWasNavigation = true;
      continue;
    }

    // unrecognised — record a warning (not an error — recording may still be useful).
    warnings.push(line);
  }

  // Final trailing screenshot so at least one exists if user didn't add any.
  if (steps.length && !steps.some(s => s.action === 'screenshot')) {
    steps.push({ action: 'wait', ms: 800 });
    steps.push({ action: 'screenshot', name: `auto_final` });
  } else if (lastWasNavigation) {
    steps.push({ action: 'wait', ms: 800 });
    steps.push({ action: 'screenshot', name: `auto_${autoShotIdx++}_final` });
  }

  return { steps, warnings };
}

function toPath(url, baseUrl) {
  if (!baseUrl) return url;
  if (url.startsWith(baseUrl)) {
    const tail = url.slice(baseUrl.length);
    return tail.startsWith('/') ? tail : '/' + tail;
  }
  return url;
}

// If a fill step looks like a password entry, strip the value and flag it.
// Heuristics: label/selector contains "password" or "pwd" (case-insensitive)
// OR the selector targets an input of type=password.
function scrubPasswordInPlace(step, marker) {
  const m = (marker || '').toLowerCase();
  const looksPassword =
    /password|passwd|pwd/.test(m) ||
    /type=["']?password/.test(m);
  if (!looksPassword) return;
  step.value = '';
  step.needs_password_env = true;
}

module.exports = { parseCodegenScript };
