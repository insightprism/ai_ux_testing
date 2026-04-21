// Tests for runner/prompt_structured.js baseline-injection path. Phase 2.

const { buildStructuredPrompt } = require('../../ux_testing/runner/prompt_structured');
const { assert, describe, loadFixture, summary } = require('./_harness');

const recipe = loadFixture('recipe_A.json');
const baseline = loadFixture('baseline_A.json');

const fakeRun = {
  recipe_id: 'recipe_a',
  recipe_name: 'Recipe A',
  started_at: '20260420-182842',
  status: 'completed',
  description: 'test',
  screenshots: [{ name: 'home', viewport: 'desktop', path: 'runs/fake/01_home_desktop.png' }],
  checks: recipe.checks,
};

describe('with baseline: required-keys block includes every baseline observed key', () => {
  const p = buildStructuredPrompt(fakeRun, recipe, baseline);
  for (const key of ['header_text', 'footer_text', 'sections_found', 'has_login_button', 'error_banners']) {
    assert(p.includes(key), `prompt must mention baseline key "${key}"`);
  }
});

describe('with baseline: _schema_frozen is NEVER exposed to the reviewer', () => {
  const p = buildStructuredPrompt(fakeRun, recipe, baseline);
  assert(!p.includes('_schema_frozen'), `_schema_frozen must not appear in prompt; found in:\n${p}`);
});

describe('without baseline: guidance section is shown instead', () => {
  const p = buildStructuredPrompt(fakeRun, recipe, null);
  assert(p.includes('guidance (no baseline yet)'), 'should include no-baseline guidance');
  assert(!p.includes('Required `observed` shape'), 'should not include required-keys block');
});

describe('skeleton JSON uses baseline observed keys when baseline given', () => {
  const p = buildStructuredPrompt(fakeRun, recipe, baseline);
  // Skeleton observed block should list the baseline keys, not the generic <your_key>.
  const i = p.indexOf('"observed":');
  assert(i > 0, 'observed block present in skeleton');
  const tail = p.slice(i, i + 500);
  assert(!tail.includes('<your_key>'), 'generic placeholder should not appear when baseline is given');
  assert(tail.includes('header_text'), 'skeleton should mention header_text');
});

summary('test_prompt_structured');
