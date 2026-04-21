const { detectFlowRegressions } = require('../../flow_review/lib/flow_regression_detector');
const { assert, assertEqual, describe, summary } = require('./_harness');

function reportWithMetrics({ verdict = 'low', clicks = 3, durationMs = 1000, backtracks = 0 } = {}) {
  return {
    frictionVerdict: verdict,
    perViewportMetrics: {
      mobile: { totalClickCount: clicks, totalDurationMs: durationMs, totalNavigationCount: 1, totalScrollCount: 1, detectedBacktrackCount: backtracks, stepDurations: [] },
    },
  };
}

describe('no change → no regression', () => {
  const result = detectFlowRegressions({
    referenceFlowReport: reportWithMetrics(),
    candidateFlowReport: reportWithMetrics(),
    flowDurationChangeToleratedPercent: 25,
  });
  assert(!result.hasRegression, 'should have no regression');
  assertEqual(result.detectedRegressions, [], 'no regressions');
});

describe('extra click → regression', () => {
  const result = detectFlowRegressions({
    referenceFlowReport: reportWithMetrics({ clicks: 3 }),
    candidateFlowReport: reportWithMetrics({ clicks: 5 }),
    flowDurationChangeToleratedPercent: 25,
  });
  assert(result.hasRegression);
  assert(result.detectedRegressions.some(r => r.fieldName === 'totalClickCount'));
});

describe('duration within tolerance → no regression', () => {
  const result = detectFlowRegressions({
    referenceFlowReport: reportWithMetrics({ durationMs: 1000 }),
    candidateFlowReport: reportWithMetrics({ durationMs: 1200 }),
    flowDurationChangeToleratedPercent: 25,
  });
  assert(!result.hasRegression, '20% change within 25% tolerance');
});

describe('duration over tolerance → regression', () => {
  const result = detectFlowRegressions({
    referenceFlowReport: reportWithMetrics({ durationMs: 1000 }),
    candidateFlowReport: reportWithMetrics({ durationMs: 1400 }),
    flowDurationChangeToleratedPercent: 25,
  });
  assert(result.hasRegression);
  assert(result.detectedRegressions.some(r => r.fieldName === 'totalDurationMs'));
});

describe('verdict worsens → regression', () => {
  const result = detectFlowRegressions({
    referenceFlowReport: reportWithMetrics({ verdict: 'low' }),
    candidateFlowReport: reportWithMetrics({ verdict: 'medium' }),
    flowDurationChangeToleratedPercent: 25,
  });
  assert(result.hasRegression);
  assert(result.detectedRegressions.some(r => r.fieldName === 'frictionVerdict'));
});

describe('verdict improves → improvement', () => {
  const result = detectFlowRegressions({
    referenceFlowReport: reportWithMetrics({ verdict: 'high' }),
    candidateFlowReport: reportWithMetrics({ verdict: 'medium' }),
    flowDurationChangeToleratedPercent: 25,
  });
  assert(!result.hasRegression);
  assert(result.detectedImprovements.some(i => i.fieldName === 'frictionVerdict'));
});

describe('extra backtrack → regression', () => {
  const result = detectFlowRegressions({
    referenceFlowReport: reportWithMetrics({ backtracks: 0 }),
    candidateFlowReport: reportWithMetrics({ backtracks: 2 }),
    flowDurationChangeToleratedPercent: 25,
  });
  assert(result.hasRegression);
  assert(result.detectedRegressions.some(r => r.fieldName === 'detectedBacktrackCount'));
});

summary('test_flow_regression_detector');
