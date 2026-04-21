const { validateFlowReport } = require('../../flow_review/lib/flow_report_schema');
const { assert, describe, summary } = require('./_harness');

function goodReport(overrides = {}) {
  return Object.assign({
    schemaVersion: 1,
    recipeId: 'x',
    runId: '20260101-120000',
    reviewedAt: '2026-01-01T12:10:00Z',
    reviewerModel: 'claude-sonnet-4-6',
    frictionVerdict: 'medium',
    frictionEvidenceBulletPoints: ['User must scroll past Favorites.'],
    suggestedFlowImprovements: ['Move Personality card above Favorites on mobile.'],
    humanReadableSummary: 'Mid-tier friction; two specific fixes available.',
    perViewportMetrics: {
      mobile: {
        totalDurationMs: 1000,
        totalClickCount: 2,
        totalNavigationCount: 1,
        totalScrollCount: 1,
        detectedBacktrackCount: 0,
        stepDurations: [],
      },
    },
  }, overrides);
}

describe('valid report passes', () => {
  const r = validateFlowReport(goodReport());
  assert(r.ok, `expected ok; errors: ${r.errors.join(' | ')}`);
});

describe('schemaVersion mismatch rejected', () => {
  const r = validateFlowReport(goodReport({ schemaVersion: 2 }));
  assert(!r.ok);
  assert(r.errors.some(e => e.includes('schemaVersion')));
});

describe('unknown friction verdict rejected', () => {
  const r = validateFlowReport(goodReport({ frictionVerdict: 'bad' }));
  assert(!r.ok);
  assert(r.errors.some(e => e.includes('frictionVerdict')));
});

describe('over-length evidence string rejected', () => {
  const longString = 'a'.repeat(1000);
  const r = validateFlowReport(goodReport({ frictionEvidenceBulletPoints: [longString] }));
  assert(!r.ok);
  assert(r.errors.some(e => e.includes('frictionEvidenceBulletPoints')));
});

describe('missing perViewportMetrics rejected', () => {
  const r = validateFlowReport(goodReport({ perViewportMetrics: {} }));
  assert(!r.ok);
  assert(r.errors.some(e => e.includes('perViewportMetrics')));
});

describe('negative metric value rejected', () => {
  const r = validateFlowReport(goodReport({
    perViewportMetrics: { mobile: {
      totalDurationMs: -1,
      totalClickCount: 0,
      totalNavigationCount: 0,
      totalScrollCount: 0,
      detectedBacktrackCount: 0,
      stepDurations: [],
    }},
  }));
  assert(!r.ok);
  assert(r.errors.some(e => e.includes('totalDurationMs')));
});

summary('test_flow_report_schema');
