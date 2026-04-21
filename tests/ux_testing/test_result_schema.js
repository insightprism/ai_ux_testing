// Tests for lib/result_schema.js. Phase 1.

const { validateResult } = require('../../ux_testing/lib/result_schema');
const { assert, describe, loadFixture, summary } = require('./_harness');

describe('valid baseline result passes', () => {
  const r = validateResult(loadFixture('baseline_A.json'));
  assert(r.ok === true, `expected ok:true, got ${JSON.stringify(r)}`);
  assert(r.errors.length === 0, `expected no errors, got ${r.errors.join(' | ')}`);
});

describe('result missing required fields is rejected', () => {
  const r = validateResult(loadFixture('result_invalid_missing_fields.json'));
  assert(r.ok === false, 'expected ok:false');
  const missing = ['run_id', 'reviewed_at', 'reviewer', 'overall_status', 'summary'];
  for (const field of missing) {
    assert(r.errors.some(e => e.startsWith(field + ':')), `expected error for missing "${field}", got: ${r.errors.join(' | ')}`);
  }
});

describe('result with bad verdict is rejected', () => {
  const r = validateResult(loadFixture('result_invalid_bad_verdict.json'));
  assert(r.ok === false, 'expected ok:false');
  assert(r.errors.some(e => e.includes('verdict: must be one of')), `expected verdict error, got: ${r.errors.join(' | ')}`);
});

describe('prose in observed is rejected', () => {
  const r = validateResult(loadFixture('result_invalid_prose_in_observed.json'));
  assert(r.ok === false, 'expected ok:false');
  assert(r.errors.some(e => e.includes('observed.long_narrative') && e.includes('prose')), `expected prose error on observed.long_narrative, got: ${r.errors.join(' | ')}`);
});

describe('non-object input is rejected', () => {
  assert(validateResult(null).ok === false, 'null');
  assert(validateResult('string').ok === false, 'string');
  assert(validateResult([1, 2, 3]).ok === false, 'array');
});

describe('wrong schema_version is rejected', () => {
  const data = loadFixture('baseline_A.json');
  data.schema_version = 2;
  const r = validateResult(data);
  assert(r.ok === false, 'expected ok:false');
  assert(r.errors.some(e => e.includes('schema_version')), `expected schema_version error, got: ${r.errors.join(' | ')}`);
});

describe('bad ISO-8601 reviewed_at is rejected', () => {
  const data = loadFixture('baseline_A.json');
  data.reviewed_at = 'yesterday';
  const r = validateResult(data);
  assert(r.ok === false, 'expected ok:false');
  assert(r.errors.some(e => e.includes('reviewed_at') && e.includes('ISO-8601')), `expected reviewed_at error, got: ${r.errors.join(' | ')}`);
});

describe('observed accepts primitives, arrays, and nested objects with primitive leaves', () => {
  const data = loadFixture('baseline_A.json');
  data.observed = {
    _schema_frozen: true,
    str: 'hello',
    num: 42,
    bool: false,
    nul: null,
    arr: ['a', 'b'],
    nested: { count: 3, items: ['x', 'y'] },
  };
  const r = validateResult(data);
  assert(r.ok === true, `expected ok:true, got errors: ${r.errors.join(' | ')}`);
});

describe('prompt builder produces required-keys block only when baseline given', () => {
  const { buildStructuredPrompt } = require('../../ux_testing/runner/prompt_structured');
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

  const noBaseline = buildStructuredPrompt(fakeRun, recipe, null);
  assert(!noBaseline.includes('Required `observed` shape'), 'no-baseline prompt should NOT include required-keys block');
  assert(noBaseline.includes('guidance (no baseline yet)'), 'no-baseline prompt should include the no-baseline guidance');

  const withBaseline = buildStructuredPrompt(fakeRun, recipe, baseline);
  assert(withBaseline.includes('Required `observed` shape'), 'with-baseline prompt should include required-keys block');
  for (const key of ['header_text', 'footer_text', 'sections_found', 'has_login_button', 'error_banners']) {
    assert(withBaseline.includes(key), `with-baseline prompt should mention baseline key "${key}"`);
  }
  assert(!withBaseline.includes('_schema_frozen'), 'with-baseline prompt should NOT expose _schema_frozen to reviewer');
});

summary('test_result_schema');
