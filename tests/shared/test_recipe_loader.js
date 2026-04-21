const { validateRecipe } = require('../../shared/recipe_loader');
const { assert, describe, summary } = require('./_harness');

function minimalRecipe(overrides = {}) {
  return Object.assign({
    id: 'x',
    name: 'x',
    target: { base_url: 'http://localhost:1' },
    steps: [{ action: 'goto', path: '/' }, { action: 'screenshot', name: 'home' }],
    checks: ['check one'],
    viewports: ['desktop'],
  }, overrides);
}

describe('validateRecipe accepts a minimal valid recipe', () => {
  const result = validateRecipe(minimalRecipe());
  assert(result.ok, `expected ok; errors: ${result.errors.join(' | ')}`);
});

describe('flow_review block validated when present', () => {
  const okRecipe = minimalRecipe({
    flow_review: {
      captureVideo: true,
      flowDurationChangeToleratedPercent: 30,
      describedUserIntent: 'friend visits sara',
    },
  });
  assert(validateRecipe(okRecipe).ok, 'valid flow_review block should pass');

  const badRecipe = minimalRecipe({
    flow_review: {
      captureVideo: 'yes',
      flowDurationChangeToleratedPercent: -5,
      describedUserIntent: 42,
    },
  });
  const badResult = validateRecipe(badRecipe);
  assert(!badResult.ok, 'bad flow_review should fail');
  assert(badResult.errors.some(e => e.includes('captureVideo')), 'captureVideo error');
  assert(badResult.errors.some(e => e.includes('flowDurationChangeToleratedPercent')), 'percent error');
  assert(badResult.errors.some(e => e.includes('describedUserIntent')), 'intent error');
});

describe('back-compat aliases exist', () => {
  const { ALLOWED_ACTIONS, ALLOWED_VIEWPORTS, VIEWPORT_SIZES } = require('../../shared/recipe_loader');
  assert(ALLOWED_ACTIONS instanceof Set, 'ALLOWED_ACTIONS alias');
  assert(ALLOWED_VIEWPORTS instanceof Set, 'ALLOWED_VIEWPORTS alias');
  assert(VIEWPORT_SIZES.mobile && VIEWPORT_SIZES.desktop, 'VIEWPORT_SIZES alias');
});

summary('test_recipe_loader');
