// Single source of truth for every tunable number or string default.
// Nothing in runner/ or lib/ should hardcode values that belong here.
// Every default is env-overridable so CI, tests, or power-users can tune
// without code changes.

function numberFromEnv(envKey, fallbackValue) {
  const raw = process.env[envKey];
  if (raw === undefined || raw === '') return fallbackValue;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`env var ${envKey}="${raw}" is not a number`);
  }
  return parsed;
}

function stringFromEnv(envKey, fallbackValue) {
  const raw = process.env[envKey];
  return raw === undefined || raw === '' ? fallbackValue : raw;
}

function booleanFromEnv(envKey, fallbackValue) {
  const raw = process.env[envKey];
  if (raw === undefined || raw === '') return fallbackValue;
  return raw === '1' || raw.toLowerCase() === 'true';
}

const DEFAULTS = {
  // Percent duration change above which flow_regression_detector flags a
  // regression. Set above typical network jitter so small variance doesn't trip.
  flowDurationChangeToleratedPercent:
    numberFromEnv('FLOW_DURATION_CHANGE_TOLERATED_PERCENT', 25),

  // Navigation step-wait timeout (ms). `goto` and similar waits can be long on
  // apps with long-polling connections — separate knob from interaction timeout.
  stepNavigationTimeoutMs:
    numberFromEnv('FLOW_STEP_NAVIGATION_TIMEOUT_MS', 30000),

  // Click / scroll / fill timeout (ms).
  stepInteractionTimeoutMs:
    numberFromEnv('FLOW_STEP_INTERACTION_TIMEOUT_MS', 8000),

  // Small pause after each step to let layout settle (ms). Important for
  // scroll / click_inside where DOM may still be resolving.
  postStepSettleMs:
    numberFromEnv('FLOW_POST_STEP_SETTLE_MS', 300),

  // Reviewer output token budget.
  reviewerOutputMaxTokens:
    numberFromEnv('FLOW_REVIEWER_OUTPUT_MAX_TOKENS', 4096),

  // Maximum length for any free-text field in a flow_report (friction evidence
  // bullet, suggestion). Guards against reviewer returning prose paragraphs.
  reviewerPromptTextMaxChars:
    numberFromEnv('FLOW_REVIEWER_PROMPT_TEXT_MAX_CHARS', 400),

  // Disk management — screenshots and videos have very different per-unit sizes
  // so they have separate caps.
  keepNewestScreenshotCount:
    numberFromEnv('FLOW_KEEP_NEWEST_SCREENSHOT_COUNT', 100),
  keepNewestVideoCount:
    numberFromEnv('FLOW_KEEP_NEWEST_VIDEO_COUNT', 20),

  // Default reviewer model — Sonnet by design (half of Opus cost, still good at
  // friction reasoning). Override with --model flag on any CLI.
  defaultReviewerModel:
    stringFromEnv('FLOW_REVIEWER_DEFAULT_MODEL', 'sonnet'),

  // Viewport sizes (pixels). Kept here so we never hardcode them in runner/.
  viewportSizesPx: {
    mobile:  { widthPx: 375,  heightPx: 812 },
    desktop: { widthPx: 1280, heightPx: 900 },
  },

  // Whether ai_flow_review also writes an `.md` summary alongside flow_report.json.
  writeHumanReadableReport:
    booleanFromEnv('FLOW_WRITE_HUMAN_READABLE_REPORT', true),
};

module.exports = {
  DEFAULTS,
  numberFromEnv,
  stringFromEnv,
  booleanFromEnv,
};
