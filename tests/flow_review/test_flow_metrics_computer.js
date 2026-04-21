const {
  computeFlowMetricsFromRunLog,
  computeSingleViewportMetrics,
} = require('../../flow_review/lib/flow_metrics_computer');
const { assert, assertEqual, describe, summary } = require('./_harness');

describe('empty log produces empty metricsByViewport', () => {
  assertEqual(computeFlowMetricsFromRunLog([]), {}, 'empty');
});

describe('counts clicks, navigations, scrolls, durations', () => {
  const m = computeSingleViewportMetrics([
    { action: 'goto', url: 'http://x/a', duration_ms: 500 },
    { action: 'click_text', text: 'A', duration_ms: 200 },
    { action: 'scroll', direction: 'down', duration_ms: 50 },
    { action: 'click_selector', selector: '.x', duration_ms: 150 },
    { action: 'scroll_inside', direction: 'down', duration_ms: 60 },
    { action: 'goto', url: 'http://x/b', duration_ms: 400 },
  ]);
  assertEqual(m.totalClickCount, 2, 'clicks');
  assertEqual(m.totalNavigationCount, 2, 'navigations');
  assertEqual(m.totalScrollCount, 2, 'scrolls');
  assertEqual(m.totalDurationMs, 500 + 200 + 50 + 150 + 60 + 400, 'duration sum');
  assert(m.stepDurations.length === 6, 'stepDurations populated');
});

describe('login-phase steps excluded from metrics', () => {
  const m = computeSingleViewportMetrics([
    { phase: 'login', action: 'goto',  url: 'http://x/login', duration_ms: 300 },
    { phase: 'login', action: 'submitted', url: 'http://x/',   duration_ms: 100 },
    { action: 'goto', url: 'http://x/home', duration_ms: 200 },
  ]);
  assertEqual(m.totalNavigationCount, 1, 'only real goto counted');
  assertEqual(m.totalDurationMs, 200, 'login duration excluded');
});

describe('backtrack detection', () => {
  const m = computeSingleViewportMetrics([
    { action: 'goto', url: 'http://x/a', duration_ms: 100 },
    { action: 'goto', url: 'http://x/b', duration_ms: 100 },
    { action: 'goto', url: 'http://x/a', duration_ms: 100 }, // revisit
    { action: 'goto', url: 'http://x/a', duration_ms: 100 }, // revisit
  ]);
  assertEqual(m.detectedBacktrackCount, 2, 'two revisits');
});

describe('missing duration_ms falls back to 0', () => {
  const m = computeSingleViewportMetrics([
    { action: 'goto', url: 'http://x/a' },
    { action: 'click_text', text: 'A' },
  ]);
  assertEqual(m.totalDurationMs, 0, 'missing durations treated as zero');
});

describe('aggregates per viewport', () => {
  const result = computeFlowMetricsFromRunLog([
    { viewport: 'mobile',  steps: [{ action: 'click_text', duration_ms: 100 }] },
    { viewport: 'desktop', steps: [{ action: 'click_text', duration_ms: 200 }, { action: 'click_text', duration_ms: 200 }] },
  ]);
  assertEqual(result.mobile.totalClickCount, 1, 'mobile');
  assertEqual(result.desktop.totalClickCount, 2, 'desktop');
});

summary('test_flow_metrics_computer');
