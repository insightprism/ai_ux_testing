// Computes per-viewport flow metrics from a run's per-step log.
// Pure function — no file I/O, no config lookups, no logging.
//
// Input shape (from capture_flow.js):
//   runLogByViewport = [
//     { viewport: 'mobile',  steps: [ { action, path?, url?, duration_ms, ... }, ... ] },
//     { viewport: 'desktop', steps: [ ... ] },
//   ]
//
// Output: flowMetrics object matching the `perViewportMetrics` + roll-up fields
// in docs/SPEC_AI_FLOW_REVIEW.md §8.

const CLICK_ACTIONS = new Set(['click_text', 'click_selector']);
const NAVIGATION_ACTIONS = new Set(['goto']);
const SCROLL_ACTIONS = new Set(['scroll', 'scroll_inside']);

// Returns the viewport-keyed metrics directly (no wrapper). This shape maps
// 1:1 onto flow_report.json.perViewportMetrics so callers can assign it
// without nesting tricks.
function computeFlowMetricsFromRunLog(runLogByViewport) {
  if (!Array.isArray(runLogByViewport)) {
    throw new Error('computeFlowMetricsFromRunLog: runLogByViewport must be an array');
  }
  const metricsByViewport = {};
  for (const viewportEntry of runLogByViewport) {
    if (!viewportEntry || typeof viewportEntry !== 'object') continue;
    if (!Array.isArray(viewportEntry.steps)) continue;
    metricsByViewport[viewportEntry.viewport] = computeSingleViewportMetrics(viewportEntry.steps);
  }
  return metricsByViewport;
}

function computeSingleViewportMetrics(stepsForViewport) {
  let totalDurationMs = 0;
  let totalClickCount = 0;
  let totalNavigationCount = 0;
  let totalScrollCount = 0;
  const stepDurations = [];
  const visitedUrls = [];

  for (const step of stepsForViewport) {
    if (!step || typeof step !== 'object') continue;
    if (isLoginPhase(step)) continue;
    const duration = Number.isFinite(step.duration_ms) ? step.duration_ms : 0;
    totalDurationMs += duration;
    if (CLICK_ACTIONS.has(step.action)) totalClickCount += 1;
    if (NAVIGATION_ACTIONS.has(step.action)) {
      totalNavigationCount += 1;
      if (step.url) visitedUrls.push(step.url);
    }
    if (SCROLL_ACTIONS.has(step.action)) totalScrollCount += 1;
    stepDurations.push({
      stepIndex: stepDurations.length,
      action: step.action,
      path: step.path,
      durationMs: duration,
    });
  }

  return {
    totalDurationMs,
    totalClickCount,
    totalNavigationCount,
    totalScrollCount,
    detectedBacktrackCount: countDetectedBacktracks(visitedUrls),
    stepDurations,
  };
}

function isLoginPhase(step) {
  return step && step.phase === 'login';
}

function countDetectedBacktracks(visitedUrls) {
  const seen = new Set();
  let backtracks = 0;
  for (const url of visitedUrls) {
    if (seen.has(url)) backtracks += 1;
    else seen.add(url);
  }
  return backtracks;
}

module.exports = {
  computeFlowMetricsFromRunLog,
  computeSingleViewportMetrics,
  CLICK_ACTIONS,
  NAVIGATION_ACTIONS,
  SCROLL_ACTIONS,
};
