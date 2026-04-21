// Pure: compares two flow reports, returns a list of detected regressions and
// notable non-regression changes. No I/O.

const FRICTION_VERDICT_ORDER = { low: 0, medium: 1, high: 2 };

function detectFlowRegressions({
  referenceFlowReport,
  candidateFlowReport,
  flowDurationChangeToleratedPercent,
}) {
  if (!referenceFlowReport) {
    throw new Error('detectFlowRegressions: referenceFlowReport is required');
  }
  if (!candidateFlowReport) {
    throw new Error('detectFlowRegressions: candidateFlowReport is required');
  }
  if (typeof flowDurationChangeToleratedPercent !== 'number') {
    throw new Error('detectFlowRegressions: flowDurationChangeToleratedPercent must be a number');
  }

  const changesByViewport = {};
  const detectedRegressions = [];
  const detectedImprovements = [];

  const referenceMetricsByViewport = referenceFlowReport.perViewportMetrics || {};
  const candidateMetricsByViewport = candidateFlowReport.perViewportMetrics || {};
  const viewportNames = new Set([
    ...Object.keys(referenceMetricsByViewport),
    ...Object.keys(candidateMetricsByViewport),
  ]);

  for (const viewportName of viewportNames) {
    const comparison = compareViewportMetrics({
      referenceMetrics: referenceMetricsByViewport[viewportName],
      candidateMetrics: candidateMetricsByViewport[viewportName],
      flowDurationChangeToleratedPercent,
    });
    changesByViewport[viewportName] = comparison;
    for (const regression of comparison.regressionsDetected) {
      detectedRegressions.push({ viewport: viewportName, ...regression });
    }
    for (const improvement of comparison.improvementsDetected) {
      detectedImprovements.push({ viewport: viewportName, ...improvement });
    }
  }

  const verdictChange = compareFrictionVerdict(referenceFlowReport.frictionVerdict, candidateFlowReport.frictionVerdict);
  if (verdictChange.isRegression) {
    detectedRegressions.push({
      viewport: '(overall)',
      fieldName: 'frictionVerdict',
      referenceValue: referenceFlowReport.frictionVerdict,
      candidateValue: candidateFlowReport.frictionVerdict,
    });
  } else if (verdictChange.isImprovement) {
    detectedImprovements.push({
      viewport: '(overall)',
      fieldName: 'frictionVerdict',
      referenceValue: referenceFlowReport.frictionVerdict,
      candidateValue: candidateFlowReport.frictionVerdict,
    });
  }

  return {
    hasRegression: detectedRegressions.length > 0,
    detectedRegressions,
    detectedImprovements,
    changesByViewport,
    overallVerdictChange: verdictChange,
    toleratedDurationChangePercent: flowDurationChangeToleratedPercent,
  };
}

function compareViewportMetrics({
  referenceMetrics,
  candidateMetrics,
  flowDurationChangeToleratedPercent,
}) {
  if (!referenceMetrics || !candidateMetrics) {
    return { regressionsDetected: [], improvementsDetected: [], notes: ['reference or candidate missing this viewport'] };
  }
  const regressionsDetected = [];
  const improvementsDetected = [];

  const clickDelta = candidateMetrics.totalClickCount - referenceMetrics.totalClickCount;
  if (clickDelta > 0) {
    regressionsDetected.push({
      fieldName: 'totalClickCount',
      referenceValue: referenceMetrics.totalClickCount,
      candidateValue: candidateMetrics.totalClickCount,
      delta: clickDelta,
    });
  } else if (clickDelta < 0) {
    improvementsDetected.push({
      fieldName: 'totalClickCount',
      referenceValue: referenceMetrics.totalClickCount,
      candidateValue: candidateMetrics.totalClickCount,
      delta: clickDelta,
    });
  }

  const durationChangePercent = computePercentChange(referenceMetrics.totalDurationMs, candidateMetrics.totalDurationMs);
  if (durationChangePercent > flowDurationChangeToleratedPercent) {
    regressionsDetected.push({
      fieldName: 'totalDurationMs',
      referenceValue: referenceMetrics.totalDurationMs,
      candidateValue: candidateMetrics.totalDurationMs,
      changePercent: durationChangePercent,
    });
  } else if (durationChangePercent < -flowDurationChangeToleratedPercent) {
    improvementsDetected.push({
      fieldName: 'totalDurationMs',
      referenceValue: referenceMetrics.totalDurationMs,
      candidateValue: candidateMetrics.totalDurationMs,
      changePercent: durationChangePercent,
    });
  }

  const backtrackDelta = candidateMetrics.detectedBacktrackCount - referenceMetrics.detectedBacktrackCount;
  if (backtrackDelta > 0) {
    regressionsDetected.push({
      fieldName: 'detectedBacktrackCount',
      referenceValue: referenceMetrics.detectedBacktrackCount,
      candidateValue: candidateMetrics.detectedBacktrackCount,
      delta: backtrackDelta,
    });
  }

  return { regressionsDetected, improvementsDetected };
}

function compareFrictionVerdict(referenceVerdict, candidateVerdict) {
  const referenceRank = FRICTION_VERDICT_ORDER[referenceVerdict];
  const candidateRank = FRICTION_VERDICT_ORDER[candidateVerdict];
  if (referenceRank === undefined || candidateRank === undefined) {
    return { isRegression: false, isImprovement: false, unchanged: false };
  }
  if (candidateRank > referenceRank) return { isRegression: true, isImprovement: false, unchanged: false };
  if (candidateRank < referenceRank) return { isRegression: false, isImprovement: true, unchanged: false };
  return { isRegression: false, isImprovement: false, unchanged: true };
}

function computePercentChange(referenceValue, candidateValue) {
  if (!Number.isFinite(referenceValue) || referenceValue === 0) return 0;
  return ((candidateValue - referenceValue) / referenceValue) * 100;
}

module.exports = {
  detectFlowRegressions,
  compareFrictionVerdict,
  FRICTION_VERDICT_ORDER,
};
