// Pure diff logic — no I/O. Comparing a baseline result.json against a
// current-run result.json. Used by runner/diff.js and tested in tests/.
// See docs/SPEC_BASELINE_REGRESSION.md §5.6.
//
// Output shape:
//   {
//     overall:   { baseline, current },
//     checks:    [ { instruction, baselineVerdict, currentVerdict, kind, note? } ],
//     renamed:   [ { index, was, now } ],      // rename-heuristic hits
//     observed:  [ { key, kind, baseline?, current?, added?, removed? } ],
//     hasRegression: boolean,
//     hasSchemaBreak: boolean,
//     summary:   string,                        // one-line
//   }
//
// `kind` enums:
//   checks:   'unchanged' | 'regression' | 'improvement' | 'flipped' | 'removed' | 'added'
//   observed: 'unchanged' | 'changed' | 'array_changed' | 'missing' | 'extra'

function diffResults(baseline, current, options = {}) {
  const ignoreKeys = new Set(options.ignoreKeys || []);
  const overall = {
    baseline: baseline.overall_status,
    current: current.overall_status,
  };

  const { checks, renamed, hasCheckRegression } = diffChecks(baseline.checks || [], current.checks || []);
  const { observed, hasSchemaBreak } = diffObserved(baseline.observed || {}, current.observed || {}, ignoreKeys);

  const hasRegression = hasCheckRegression;
  const summary = buildSummary(overall, checks, observed, renamed, hasRegression, hasSchemaBreak);

  return { overall, checks, renamed, observed, hasRegression, hasSchemaBreak, summary };
}

function diffChecks(baseChecks, curChecks) {
  // Prefer id-based matching when both sides have ids; fall back to instruction text.
  // Rename heuristic: same id, different instruction text OR same position, unmatched both sides.
  const baseById = new Map();
  const byInstrBase = new Map();
  baseChecks.forEach((c, i) => {
    if (c.id) baseById.set(c.id, { ...c, _index: i });
    byInstrBase.set(c.instruction, { ...c, _index: i });
  });
  const curById = new Map();
  const byInstrCur = new Map();
  curChecks.forEach((c, i) => {
    if (c.id) curById.set(c.id, { ...c, _index: i });
    byInstrCur.set(c.instruction, { ...c, _index: i });
  });

  const checks = [];
  const renamed = [];
  let hasCheckRegression = false;
  const matchedBaseIndices = new Set();
  const matchedCurIndices = new Set();

  baseChecks.forEach((base, i) => {
    let cur = null;
    let matchedBy = null;
    if (base.id && curById.has(base.id)) {
      cur = curById.get(base.id);
      matchedBy = 'id';
    } else if (byInstrCur.has(base.instruction)) {
      cur = byInstrCur.get(base.instruction);
      // Don't claim a by-text match if the current side's id differs from baseline's id
      // (they're different checks that happen to share text).
      if (base.id && cur.id && base.id !== cur.id) {
        cur = null;
      } else {
        matchedBy = 'text';
      }
    }
    if (!cur) {
      checks.push({ instruction: base.instruction, baselineVerdict: base.verdict, currentVerdict: null, kind: 'removed', id: base.id || null });
      return;
    }
    matchedBaseIndices.add(i);
    matchedCurIndices.add(cur._index);
    const kind = classifyVerdictDiff(base.verdict, cur.verdict);
    checks.push({ instruction: cur.instruction, baselineVerdict: base.verdict, currentVerdict: cur.verdict, kind, id: base.id || cur.id || null });
    if (kind === 'regression') hasCheckRegression = true;
    if (matchedBy === 'id' && base.instruction !== cur.instruction) {
      renamed.push({ index: i, was: base.instruction, now: cur.instruction, reason: 'same id, different text' });
    }
  });

  curChecks.forEach((cur, i) => {
    if (matchedCurIndices.has(i)) return;
    checks.push({ instruction: cur.instruction, baselineVerdict: null, currentVerdict: cur.verdict, kind: 'added', id: cur.id || null });
  });

  // Position-based rename heuristic for the no-id case: removed baseline[i] + added current[i].
  baseChecks.forEach((base, i) => {
    if (matchedBaseIndices.has(i)) return;
    const cur = curChecks[i];
    if (!cur || matchedCurIndices.has(i)) return;
    if (base.id && cur.id && base.id !== cur.id) return; // different ids = not a rename
    if (!base.id && !cur.id) {
      renamed.push({ index: i, was: base.instruction, now: cur.instruction, reason: 'same position' });
    }
  });

  return { checks, renamed, hasCheckRegression };
}

function classifyVerdictDiff(prev, now) {
  if (prev === now) return 'unchanged';
  if (prev === 'pass' && now !== 'pass') return 'regression';
  if (prev !== 'pass' && now === 'pass') return 'improvement';
  return 'flipped';
}

function diffObserved(baseObs, curObs, ignoreKeys = new Set()) {
  const baseKeys = Object.keys(baseObs).filter(k => k !== '_schema_frozen' && !ignoreKeys.has(k));
  const curKeys = Object.keys(curObs).filter(k => k !== '_schema_frozen' && !ignoreKeys.has(k));
  const allKeys = new Set([...baseKeys, ...curKeys]);

  const observed = [];
  let hasSchemaBreak = false;

  for (const key of allKeys) {
    const inBase = baseKeys.includes(key);
    const inCur = curKeys.includes(key);
    if (inBase && !inCur) {
      observed.push({ key, kind: 'missing', baseline: baseObs[key] });
      hasSchemaBreak = true;
      continue;
    }
    if (!inBase && inCur) {
      observed.push({ key, kind: 'extra', current: curObs[key] });
      continue;
    }
    const b = baseObs[key];
    const c = curObs[key];
    if (Array.isArray(b) && Array.isArray(c)) {
      const added = c.filter(v => !arrayIncludesDeep(b, v));
      const removed = b.filter(v => !arrayIncludesDeep(c, v));
      if (added.length || removed.length) {
        observed.push({ key, kind: 'array_changed', baseline: b, current: c, added, removed });
      } else {
        observed.push({ key, kind: 'unchanged', baseline: b, current: c });
      }
      continue;
    }
    if (JSON.stringify(b) === JSON.stringify(c)) {
      observed.push({ key, kind: 'unchanged', baseline: b, current: c });
    } else {
      observed.push({ key, kind: 'changed', baseline: b, current: c });
    }
  }

  return { observed, hasSchemaBreak };
}

function arrayIncludesDeep(arr, value) {
  const v = JSON.stringify(value);
  return arr.some(x => JSON.stringify(x) === v);
}

function buildSummary(overall, checks, observed, renamed, hasRegression, hasSchemaBreak) {
  const nRegression = checks.filter(c => c.kind === 'regression').length;
  const nImprovement = checks.filter(c => c.kind === 'improvement').length;
  const nUnchanged = checks.filter(c => c.kind === 'unchanged').length;
  const nAdded = checks.filter(c => c.kind === 'added').length;
  const nRemoved = checks.filter(c => c.kind === 'removed').length;
  const nMissing = observed.filter(o => o.kind === 'missing').length;
  const nExtra = observed.filter(o => o.kind === 'extra').length;
  const nChanged = observed.filter(o => o.kind === 'changed' || o.kind === 'array_changed').length;

  const bits = [];
  bits.push(`${nUnchanged} passing`);
  if (nRegression) bits.push(`${nRegression} regression${nRegression === 1 ? '' : 's'}`);
  if (nImprovement) bits.push(`${nImprovement} improvement${nImprovement === 1 ? '' : 's'}`);
  if (nAdded) bits.push(`${nAdded} new`);
  if (nRemoved) bits.push(`${nRemoved} removed`);
  if (nChanged) bits.push(`${nChanged} field change${nChanged === 1 ? '' : 's'}`);
  if (nMissing) bits.push(`${nMissing} missing key${nMissing === 1 ? '' : 's'}`);
  if (nExtra) bits.push(`${nExtra} extra key${nExtra === 1 ? '' : 's'}`);
  if (renamed.length) bits.push(`${renamed.length} likely rename${renamed.length === 1 ? '' : 's'}`);

  const status = hasRegression ? 'REGRESSION'
    : hasSchemaBreak ? 'SCHEMA_BREAK'
    : 'OK';
  return `${status}: ${bits.join(', ')}.`;
}

module.exports = { diffResults };
