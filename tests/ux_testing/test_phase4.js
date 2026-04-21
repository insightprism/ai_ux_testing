// Phase 4 tests — stable check IDs, multi-baseline discovery, ignore_observed.

const fs = require('fs');
const path = require('path');
const { diffResults } = require('../../ux_testing/lib/diff_engine');
const { validateRecipe } = require('../../ux_testing/lib/schema');
const { normalizeRecipeChecks } = require('../../ux_testing/lib/checks');
const { resolveModel } = require('../../ux_testing/lib/reviewer');
const { assert, assertEqual, describe, summary } = require('./_harness');

describe('Recipe validator accepts {id, text} checks', () => {
  const recipe = {
    id: 'x',
    name: 'x',
    target: { base_url: 'http://localhost:1' },
    steps: [{ action: 'goto', path: '/' }, { action: 'screenshot', name: 's' }],
    checks: [
      'plain text check',
      { id: 'header', text: 'Header present' },
      { text: 'No id but object form' },
    ],
    viewports: ['desktop'],
  };
  const v = validateRecipe(recipe);
  assert(v.ok, `expected valid, got: ${v.errors.join(' | ')}`);
});

describe('Recipe validator rejects bad check id', () => {
  const recipe = {
    id: 'x', name: 'x', target: { base_url: 'http://localhost:1' },
    steps: [{ action: 'goto', path: '/' }, { action: 'screenshot', name: 's' }],
    checks: [{ id: 'has space!', text: 'bad' }],
    viewports: ['desktop'],
  };
  const v = validateRecipe(recipe);
  assert(!v.ok, 'expected invalid');
});

describe('normalizeRecipeChecks handles strings and objects', () => {
  const out = normalizeRecipeChecks(['a', { text: 'b' }, { id: 'c', text: 'cc' }]);
  assertEqual(out, [{ id: null, text: 'a' }, { id: null, text: 'b' }, { id: 'c', text: 'cc' }], 'normalized');
});

describe('diff_engine: id-based match survives text edit (rename-by-id flagged)', () => {
  const baseline = {
    overall_status: 'pass',
    checks: [
      { id: 'header_visible', instruction: 'Header is visible.', verdict: 'pass' },
      { id: 'footer_visible', instruction: 'Footer is visible.', verdict: 'pass' },
    ],
    observed: {},
  };
  const current = {
    overall_status: 'pass',
    checks: [
      { id: 'header_visible', instruction: 'Header appears on the page.', verdict: 'pass' },  // renamed
      { id: 'footer_visible', instruction: 'Footer is visible.', verdict: 'pass' },
    ],
    observed: {},
  };
  const d = diffResults(baseline, current);
  assert(!d.hasRegression, 'no regression');
  assertEqual(d.renamed.length, 1, 'one rename detected by id');
  assertEqual(d.renamed[0].reason, 'same id, different text', 'reason is same-id');
  // The match itself should be "unchanged" not "removed/added".
  const unchangedCount = d.checks.filter(c => c.kind === 'unchanged').length;
  assertEqual(unchangedCount, 2, 'both checks counted as unchanged because ids matched');
});

describe('diff_engine: ignore_observed skips listed keys', () => {
  const baseline = {
    overall_status: 'pass', checks: [],
    observed: { stable: 'x', timestamp: '2026-01-01T00:00:00Z', items: [1, 2] },
  };
  const current = {
    overall_status: 'pass', checks: [],
    observed: { stable: 'x', timestamp: '2026-04-20T12:00:00Z', items: [1, 2] },
  };
  const d = diffResults(baseline, current, { ignoreKeys: ['timestamp'] });
  assert(!d.observed.some(o => o.key === 'timestamp'), 'timestamp should be omitted entirely');
  const stable = d.observed.find(o => o.key === 'stable');
  assert(stable && stable.kind === 'unchanged', 'stable key still tracked');
});

describe('resolveModel presets + claude-/gemini- full ids + error on unknown', () => {
  assertEqual(resolveModel('haiku').provider, 'claude', 'haiku → claude');
  assertEqual(resolveModel('gemini-flash').provider, 'gemini', 'gemini-flash → gemini');
  assertEqual(resolveModel('claude-opus-4-7').provider, 'claude', 'claude-* full id');
  assertEqual(resolveModel('gemini-2.0-flash').provider, 'gemini', 'gemini-* full id');
  assertEqual(resolveModel('mock').provider, 'mock', 'mock preset');
  let threw = false;
  try { resolveModel('gpt-4'); } catch { threw = true; }
  assert(threw, 'unknown model should throw');
});

summary('test_phase4');
