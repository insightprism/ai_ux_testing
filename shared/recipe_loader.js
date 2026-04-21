// Recipe schema + validator. Shared between ai_ux_testing (perception review)
// and ai_flow_review (flow quality review). Flow-review-specific fields live
// under the optional `flow_review` block so UX recipes work unchanged.

const ALLOWED_STEP_ACTIONS = new Set([
  'goto',
  'click_text',
  'click_selector',
  'fill',
  'wait',
  'scroll',
  'scroll_inside',
  'screenshot',
]);

const ALLOWED_VIEWPORT_NAMES = new Set(['mobile', 'desktop']);

const DEFAULT_VIEWPORT_SIZES_PX = {
  mobile: { width: 375, height: 812 },
  desktop: { width: 1280, height: 900 },
};

function validateRecipe(recipe) {
  const errors = [];

  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) {
    return { ok: false, errors: ['recipe must be an object'] };
  }

  validateIdentity(recipe, errors);
  validateTarget(recipe, errors);
  validateLogin(recipe, errors);
  validateSteps(recipe, errors);
  validateChecks(recipe, errors);
  validateIgnoreObserved(recipe, errors);
  validateViewports(recipe, errors);
  validateFlowReviewBlock(recipe, errors);

  return errors.length === 0
    ? { ok: true, errors: [] }
    : { ok: false, errors };
}

function validateIdentity(recipe, errors) {
  if (!recipe.id || typeof recipe.id !== 'string' || !/^[a-z0-9_\-]+$/i.test(recipe.id)) {
    errors.push('id is required (alphanumeric, underscore, dash)');
  }
  if (!recipe.name || typeof recipe.name !== 'string') {
    errors.push('name is required');
  }
}

function validateTarget(recipe, errors) {
  const target = recipe.target || {};
  if (!target.base_url || !/^https?:\/\//.test(target.base_url)) {
    errors.push('target.base_url must be http(s) URL');
  }
}

function validateLogin(recipe, errors) {
  if (!recipe.login) return;
  const { url, username, password_env } = recipe.login;
  if (!url) errors.push('login.url is required when login is present');
  if (!username) errors.push('login.username is required when login is present');
  if (!password_env) errors.push('login.password_env is required when login is present');
}

function validateSteps(recipe, errors) {
  if (!Array.isArray(recipe.steps) || recipe.steps.length === 0) {
    errors.push('steps must be a non-empty array');
    return;
  }
  recipe.steps.forEach((step, stepIndex) => {
    if (!step || typeof step !== 'object') {
      errors.push(`step ${stepIndex}: must be an object`);
      return;
    }
    if (!ALLOWED_STEP_ACTIONS.has(step.action)) {
      errors.push(`step ${stepIndex}: unknown action "${step.action}"`);
      return;
    }
    validateStepFields(step, stepIndex, errors);
  });
}

function validateStepFields(step, stepIndex, errors) {
  const label = `step ${stepIndex}`;
  switch (step.action) {
    case 'goto':
      if (!step.path) errors.push(`${label}: goto needs path`);
      break;
    case 'click_text':
      if (!step.text) errors.push(`${label}: click_text needs text`);
      break;
    case 'click_selector':
      if (!step.selector) errors.push(`${label}: click_selector needs selector`);
      break;
    case 'fill':
      if (!step.selector && !step.label) errors.push(`${label}: fill needs selector or label`);
      if (step.value === undefined) errors.push(`${label}: fill needs value`);
      break;
    case 'wait':
      if (typeof step.ms !== 'number') errors.push(`${label}: wait needs ms (number)`);
      break;
    case 'scroll':
      if (!step.direction) errors.push(`${label}: scroll needs direction`);
      break;
    case 'scroll_inside':
      if (!step.selector && !step.text) errors.push(`${label}: scroll_inside needs selector or text`);
      if (!step.direction) errors.push(`${label}: scroll_inside needs direction`);
      break;
    case 'screenshot':
      if (!step.name) errors.push(`${label}: screenshot needs name`);
      break;
  }
}

function validateChecks(recipe, errors) {
  if (!Array.isArray(recipe.checks) || recipe.checks.length === 0) {
    errors.push('checks must be a non-empty array of strings or {id,text} objects');
    return;
  }
  recipe.checks.forEach((check, checkIndex) => {
    if (typeof check === 'string') {
      if (check.trim() === '') errors.push(`check ${checkIndex}: must be non-empty string`);
      return;
    }
    if (check && typeof check === 'object' && !Array.isArray(check)) {
      if (typeof check.text !== 'string' || check.text.trim() === '') {
        errors.push(`check ${checkIndex}: {text} must be non-empty string`);
      }
      if (check.id !== undefined && (typeof check.id !== 'string' || !/^[a-z0-9_\-]+$/i.test(check.id))) {
        errors.push(`check ${checkIndex}: id (if given) must be alphanumeric/underscore/dash`);
      }
      return;
    }
    errors.push(`check ${checkIndex}: must be string or {id,text}`);
  });
}

function validateIgnoreObserved(recipe, errors) {
  if (recipe.ignore_observed === undefined) return;
  if (!Array.isArray(recipe.ignore_observed) || !recipe.ignore_observed.every(v => typeof v === 'string')) {
    errors.push('ignore_observed: must be array of strings when present');
  }
}

function validateViewports(recipe, errors) {
  const viewports = recipe.viewports || ['mobile', 'desktop'];
  if (!Array.isArray(viewports) || viewports.length === 0) {
    errors.push('viewports must be a non-empty array');
    return;
  }
  viewports.forEach((viewportName, viewportIndex) => {
    if (!ALLOWED_VIEWPORT_NAMES.has(viewportName)) {
      errors.push(`viewport ${viewportIndex}: must be one of ${[...ALLOWED_VIEWPORT_NAMES].join(', ')}`);
    }
  });
}

function validateFlowReviewBlock(recipe, errors) {
  if (recipe.flow_review === undefined) return;
  const block = recipe.flow_review;
  if (!block || typeof block !== 'object' || Array.isArray(block)) {
    errors.push('flow_review: must be object when present');
    return;
  }
  if (block.captureVideo !== undefined && typeof block.captureVideo !== 'boolean') {
    errors.push('flow_review.captureVideo: must be boolean when present');
  }
  if (block.flowDurationChangeToleratedPercent !== undefined) {
    const n = block.flowDurationChangeToleratedPercent;
    if (typeof n !== 'number' || n < 0) {
      errors.push('flow_review.flowDurationChangeToleratedPercent: must be non-negative number when present');
    }
  }
  if (block.describedUserIntent !== undefined && typeof block.describedUserIntent !== 'string') {
    errors.push('flow_review.describedUserIntent: must be string when present');
  }
}

module.exports = {
  ALLOWED_STEP_ACTIONS,
  ALLOWED_VIEWPORT_NAMES,
  DEFAULT_VIEWPORT_SIZES_PX,
  validateRecipe,
  // Back-compat aliases for ai_ux_testing — do not use in new code.
  ALLOWED_ACTIONS: ALLOWED_STEP_ACTIONS,
  ALLOWED_VIEWPORTS: ALLOWED_VIEWPORT_NAMES,
  VIEWPORT_SIZES: DEFAULT_VIEWPORT_SIZES_PX,
};
