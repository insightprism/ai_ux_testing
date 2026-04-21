// Structured AI-review result schema.
// See docs/SPEC_BASELINE_REGRESSION.md §5.3.

const SCHEMA_VERSION = 1;
const ALLOWED_VERDICTS = new Set(['pass', 'fail', 'warn']);
const ALLOWED_STATUSES = new Set(['pass', 'fail', 'warn']);

function validateResult(result) {
  const errors = [];

  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return { ok: false, errors: ['result must be an object'] };
  }

  if (result.schema_version !== SCHEMA_VERSION) {
    errors.push(`schema_version must be ${SCHEMA_VERSION}`);
  }
  requireString(result, 'recipe_id', errors);
  requireString(result, 'run_id', errors);
  requireString(result, 'reviewed_at', errors);
  if (result.reviewed_at && !/^\d{4}-\d{2}-\d{2}T/.test(result.reviewed_at)) {
    errors.push('reviewed_at must be ISO-8601 (start with YYYY-MM-DDT...)');
  }
  requireString(result, 'reviewer', errors);
  requireEnum(result, 'overall_status', ALLOWED_STATUSES, errors);
  requireString(result, 'summary', errors);

  if (!Array.isArray(result.checks)) {
    errors.push('checks must be an array');
  } else {
    result.checks.forEach((c, i) => validateCheck(c, i, errors));
  }

  if (!result.observed || typeof result.observed !== 'object' || Array.isArray(result.observed)) {
    errors.push('observed must be an object');
  } else {
    validateObserved(result.observed, errors);
  }

  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
}

function validateCheck(c, i, errors) {
  if (!c || typeof c !== 'object') {
    errors.push(`checks[${i}]: must be an object`);
    return;
  }
  if (typeof c.instruction !== 'string' || c.instruction.trim() === '') {
    errors.push(`checks[${i}].instruction: must be non-empty string`);
  }
  if (c.id !== undefined && c.id !== null) {
    if (typeof c.id !== 'string' || !/^[a-z0-9_\-]+$/i.test(c.id)) {
      errors.push(`checks[${i}].id: must be alphanumeric/underscore/dash or null when present`);
    }
  }
  if (!ALLOWED_VERDICTS.has(c.verdict)) {
    errors.push(`checks[${i}].verdict: must be one of ${[...ALLOWED_VERDICTS].join('/')}`);
  }
  if (typeof c.evidence !== 'string' || c.evidence.trim() === '') {
    errors.push(`checks[${i}].evidence: must be non-empty string`);
  }
  if (c.screenshot_refs !== undefined) {
    if (!Array.isArray(c.screenshot_refs) || !c.screenshot_refs.every(s => typeof s === 'string')) {
      errors.push(`checks[${i}].screenshot_refs: must be array of strings when present`);
    }
  }
}

// observed may contain JSON primitives or arrays/objects whose leaves are primitives.
// Long prose strings aren't structurally invalid, but the spec says "no nested prose paragraphs" —
// we flag string VALUES whose length exceeds a threshold, treating them as soft violations so the
// reviewer is nudged toward structured facts (not freeform essays).
const MAX_OBSERVED_STRING = 400;

function validateObserved(obj, errors, pathPrefix = 'observed') {
  for (const [key, value] of Object.entries(obj)) {
    if (key === '_schema_frozen') {
      if (typeof value !== 'boolean') {
        errors.push(`${pathPrefix}._schema_frozen: must be boolean when present`);
      }
      continue;
    }
    validateObservedValue(value, errors, `${pathPrefix}.${key}`);
  }
}

function validateObservedValue(value, errors, path) {
  if (value === null) return;
  const t = typeof value;
  if (t === 'string') {
    if (value.length > MAX_OBSERVED_STRING) {
      errors.push(`${path}: string value exceeds ${MAX_OBSERVED_STRING} chars — observed must be structured facts, not prose`);
    }
    return;
  }
  if (t === 'number' || t === 'boolean') return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => validateObservedValue(v, errors, `${path}[${i}]`));
    return;
  }
  if (t === 'object') {
    for (const [k, v] of Object.entries(value)) validateObservedValue(v, errors, `${path}.${k}`);
    return;
  }
  errors.push(`${path}: unsupported type ${t}`);
}

function requireString(o, key, errors) {
  if (typeof o[key] !== 'string' || o[key].trim() === '') {
    errors.push(`${key}: must be non-empty string`);
  }
}

function requireEnum(o, key, allowed, errors) {
  if (!allowed.has(o[key])) {
    errors.push(`${key}: must be one of ${[...allowed].join('/')}`);
  }
}

module.exports = {
  SCHEMA_VERSION,
  ALLOWED_VERDICTS,
  ALLOWED_STATUSES,
  MAX_OBSERVED_STRING,
  validateResult,
};
