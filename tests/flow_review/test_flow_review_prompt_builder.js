const {
  buildFlowReviewPrompt,
  VERBATIM_EVALUATOR_INSTRUCTION,
} = require('../../flow_review/lib/flow_review_prompt_builder');
const { assert, describe, summary } = require('./_harness');

const exampleCapturedRun = {
  recipeId: 'recipe_x',
  recipeName: 'Recipe X',
  runId: '20260101-100000',
  screenshots: [
    { name: 'home', viewport: 'mobile',  path: 'flow_runs/x/01_home_mobile.png' },
    { name: 'home', viewport: 'desktop', path: 'flow_runs/x/01_home_desktop.png' },
  ],
};
const exampleFlowMetrics = {
  perViewport: {
    mobile:  { totalClickCount: 3, totalDurationMs: 1200, totalNavigationCount: 1, totalScrollCount: 1, detectedBacktrackCount: 0, stepDurations: [] },
    desktop: { totalClickCount: 3, totalDurationMs: 1100, totalNavigationCount: 1, totalScrollCount: 1, detectedBacktrackCount: 0, stepDurations: [] },
  },
};
const exampleRecipe = {
  id: 'recipe_x',
  name: 'Recipe X',
  description: 'Visit and view',
  flow_review: { describedUserIntent: 'a friend opens the profile to read the personality report' },
};

describe('prompt includes verbatim evaluator instruction', () => {
  const prompt = buildFlowReviewPrompt({ capturedRun: exampleCapturedRun, flowMetrics: exampleFlowMetrics, recipe: exampleRecipe });
  assert(prompt.includes(VERBATIM_EVALUATOR_INSTRUCTION), 'verbatim instruction missing');
});

describe('prompt includes metrics JSON fence', () => {
  const prompt = buildFlowReviewPrompt({ capturedRun: exampleCapturedRun, flowMetrics: exampleFlowMetrics, recipe: exampleRecipe });
  assert(prompt.includes('totalClickCount'), 'metrics mentioned');
  assert(prompt.includes('```json'), 'has json fence');
});

describe('prompt surfaces described user intent', () => {
  const prompt = buildFlowReviewPrompt({ capturedRun: exampleCapturedRun, flowMetrics: exampleFlowMetrics, recipe: exampleRecipe });
  assert(prompt.includes('a friend opens the profile'), 'intent present');
});

describe('prompt lists screenshots when present', () => {
  const prompt = buildFlowReviewPrompt({ capturedRun: exampleCapturedRun, flowMetrics: exampleFlowMetrics, recipe: exampleRecipe });
  assert(prompt.includes('01_home_mobile.png'), 'mobile screenshot listed');
  assert(prompt.includes('01_home_desktop.png'), 'desktop screenshot listed');
});

describe('prompt includes reference block when reference given', () => {
  const referenceFlowReport = {
    frictionVerdict: 'low',
    frictionEvidenceBulletPoints: ['Reference evidence one.'],
  };
  const prompt = buildFlowReviewPrompt({
    capturedRun: exampleCapturedRun,
    flowMetrics: exampleFlowMetrics,
    recipe: exampleRecipe,
    referenceFlowReport,
  });
  assert(prompt.includes('Reference shape (from prior approved report)'), 'reference section shown');
  assert(prompt.includes('Reference evidence one.'), 'reference evidence echoed');
});

describe('prompt skips reference block when no reference', () => {
  const prompt = buildFlowReviewPrompt({ capturedRun: exampleCapturedRun, flowMetrics: exampleFlowMetrics, recipe: exampleRecipe });
  assert(!prompt.includes('Reference shape'), 'no reference block when absent');
});

summary('test_flow_review_prompt_builder');
