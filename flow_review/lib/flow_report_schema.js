// Schema + validator for flow_report.json (see SPEC_AI_FLOW_REVIEW §8).
// Pure module. No file I/O; callers handle read/write.

const { DEFAULTS } = require('../config/defaults');

const FLOW_REPORT_SCHEMA_VERSION = 1;
const ALLOWED_FRICTION_VERDICTS = new Set(['low', 'medium', 'high']);
const ALLOWED_VIEWPORT_NAMES_FOR_METRICS = new Set(['mobile', 'desktop']);

function validateFlowReport(flowReport) {
  const errors = [];
  if (!flowReport || typeof flowReport !== 'object' || Array.isArray(flowReport)) {
    return { ok: false, errors: ['flowReport must be an object'] };
  }
  if (flowReport.schemaVersion !== FLOW_REPORT_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${FLOW_REPORT_SCHEMA_VERSION}`);
  }
  requireNonEmptyString(flowReport, 'recipeId', errors);
  requireNonEmptyString(flowReport, 'runId', errors);
  requireIsoTimestamp(flowReport, 'reviewedAt', errors);
  requireNonEmptyString(flowReport, 'reviewerModel', errors);
  requireNonEmptyString(flowReport, 'humanReadableSummary', errors);

  if (!ALLOWED_FRICTION_VERDICTS.has(flowReport.frictionVerdict)) {
    errors.push(`frictionVerdict must be one of ${[...ALLOWED_FRICTION_VERDICTS].join('/')}`);
  }
  validateEvidenceArray(flowReport, 'frictionEvidenceBulletPoints', errors);
  validateEvidenceArray(flowReport, 'suggestedFlowImprovements', errors);
  validatePerViewportMetrics(flowReport.perViewportMetrics, errors);

  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
}

function requireNonEmptyString(object, key, errors) {
  if (typeof object[key] !== 'string' || object[key].trim() === '') {
    errors.push(`${key}: must be non-empty string`);
  }
}

function requireIsoTimestamp(object, key, errors) {
  if (typeof object[key] !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(object[key])) {
    errors.push(`${key}: must be ISO-8601 (start with YYYY-MM-DDT...)`);
  }
}

function validateEvidenceArray(flowReport, key, errors) {
  const value = flowReport[key];
  if (!Array.isArray(value)) {
    errors.push(`${key}: must be an array`);
    return;
  }
  value.forEach((entry, index) => {
    if (typeof entry !== 'string' || entry.trim() === '') {
      errors.push(`${key}[${index}]: must be non-empty string`);
      return;
    }
    if (entry.length > DEFAULTS.reviewerPromptTextMaxChars) {
      errors.push(`${key}[${index}]: exceeds ${DEFAULTS.reviewerPromptTextMaxChars} chars — keep it terse`);
    }
  });
}

function validatePerViewportMetrics(perViewportMetrics, errors) {
  if (!perViewportMetrics || typeof perViewportMetrics !== 'object' || Array.isArray(perViewportMetrics)) {
    errors.push('perViewportMetrics: must be an object keyed by viewport name');
    return;
  }
  const keys = Object.keys(perViewportMetrics);
  if (keys.length === 0) {
    errors.push('perViewportMetrics: must contain at least one viewport');
    return;
  }
  for (const viewportName of keys) {
    if (!ALLOWED_VIEWPORT_NAMES_FOR_METRICS.has(viewportName)) {
      errors.push(`perViewportMetrics.${viewportName}: unknown viewport name`);
      continue;
    }
    validateSingleViewportMetrics(perViewportMetrics[viewportName], viewportName, errors);
  }
}

function validateSingleViewportMetrics(metrics, viewportName, errors) {
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) {
    errors.push(`perViewportMetrics.${viewportName}: must be object`);
    return;
  }
  const requiredNonNegativeIntKeys = [
    'totalDurationMs',
    'totalClickCount',
    'totalNavigationCount',
    'totalScrollCount',
    'detectedBacktrackCount',
  ];
  for (const key of requiredNonNegativeIntKeys) {
    const value = metrics[key];
    if (typeof value !== 'number' || value < 0) {
      errors.push(`perViewportMetrics.${viewportName}.${key}: must be non-negative number`);
    }
  }
  if (!Array.isArray(metrics.stepDurations)) {
    errors.push(`perViewportMetrics.${viewportName}.stepDurations: must be array`);
  }
}

module.exports = {
  FLOW_REPORT_SCHEMA_VERSION,
  ALLOWED_FRICTION_VERDICTS,
  ALLOWED_VIEWPORT_NAMES_FOR_METRICS,
  validateFlowReport,
};
