// Tests for lib/diff_engine.js. Phase 2.

const { diffResults } = require('../../ux_testing/lib/diff_engine');
const { assert, assertEqual, describe, loadFixture, summary } = require('./_harness');

const baseline = loadFixture('baseline_A.json');
const baselineWithFail = loadFixture('baseline_A_with_fail.json');

describe('unchanged run — no regression, no schema break', () => {
  const cur = loadFixture('run_A_unchanged.json');
  const d = diffResults(baseline, cur);
  assert(d.hasRegression === false, 'no regression expected');
  assert(d.hasSchemaBreak === false, 'no schema break expected');
  assert(d.checks.every(c => c.kind === 'unchanged'), `all checks should be unchanged; got ${d.checks.map(c => c.kind).join(',')}`);
  assert(d.observed.every(o => o.kind === 'unchanged'), 'all observed should be unchanged');
  assert(d.summary.startsWith('OK:'), `summary should start with OK, got: ${d.summary}`);
});

describe('regression — pass → fail on check[1]', () => {
  const cur = loadFixture('run_A_regression.json');
  const d = diffResults(baseline, cur);
  assert(d.hasRegression === true, 'regression expected');
  const header = d.checks.find(c => c.instruction === 'Header shows the product name.');
  assert(header.kind === 'regression', `check should be regression, got ${header.kind}`);
  assertEqual(header.baselineVerdict, 'pass', 'baseline verdict');
  assertEqual(header.currentVerdict, 'fail', 'current verdict');
  // observed.header_text should flip from "DatsMe" → null
  const headerObs = d.observed.find(o => o.key === 'header_text');
  assert(headerObs.kind === 'changed', `header_text should be changed, got ${headerObs.kind}`);
  assert(d.summary.startsWith('REGRESSION:'), `summary should start with REGRESSION, got: ${d.summary}`);
});

describe('improvement — fail → pass on check[1]', () => {
  const cur = loadFixture('run_A_improvement.json');
  const d = diffResults(baselineWithFail, cur);
  assert(d.hasRegression === false, 'no regression expected (improvement, not regression)');
  const header = d.checks.find(c => c.instruction === 'Header shows the product name.');
  assert(header.kind === 'improvement', `check should be improvement, got ${header.kind}`);
});

describe('missing key — schema break', () => {
  const cur = loadFixture('run_A_missing_key.json');
  const d = diffResults(baseline, cur);
  assert(d.hasSchemaBreak === true, 'schema break expected');
  const missing = d.observed.find(o => o.key === 'error_banners');
  assert(missing.kind === 'missing', `error_banners should be missing, got ${missing.kind}`);
  assert(d.summary.startsWith('SCHEMA_BREAK:') || d.summary.startsWith('REGRESSION:'), `summary should reflect schema break, got: ${d.summary}`);
});

describe('extra key — flagged, not schema break', () => {
  const cur = loadFixture('run_A_extra_key.json');
  const d = diffResults(baseline, cur);
  assert(d.hasSchemaBreak === false, 'extra key should not be schema break (missing is)');
  const extra = d.observed.find(o => o.key === 'new_cta_visible');
  assert(extra.kind === 'extra', `new_cta_visible should be extra, got ${extra.kind}`);
});

describe('renamed check — rename heuristic fires at same position', () => {
  const cur = loadFixture('run_A_renamed_check.json');
  const d = diffResults(baseline, cur);
  assert(d.renamed.length === 1, `expected 1 rename hit, got ${d.renamed.length}`);
  const r = d.renamed[0];
  assertEqual(r.index, 2, 'rename at position 2');
  assert(r.was.startsWith('Footer has a copyright'), `was text: ${r.was}`);
  assert(r.now.startsWith('Footer displays a copyright'), `now text: ${r.now}`);
  // still reported as removed + added
  assert(d.checks.some(c => c.kind === 'removed'), 'removed should still appear');
  assert(d.checks.some(c => c.kind === 'added'), 'added should still appear');
});

describe('array_changed — added and removed items detected', () => {
  const cur = JSON.parse(JSON.stringify(loadFixture('run_A_unchanged.json')));
  cur.observed.sections_found = ['hero', 'footer', 'new_section'];
  const d = diffResults(baseline, cur);
  const sections = d.observed.find(o => o.key === 'sections_found');
  assert(sections.kind === 'array_changed', `expected array_changed, got ${sections.kind}`);
  assertEqual(sections.added, ['new_section'], 'added sections');
  assertEqual(sections.removed, ['features'], 'removed sections');
});

describe('_schema_frozen is not surfaced in observed diff', () => {
  const cur = loadFixture('run_A_unchanged.json');
  const d = diffResults(baseline, cur);
  assert(!d.observed.some(o => o.key === '_schema_frozen'), '_schema_frozen should be filtered out');
});

summary('test_diff_engine');
