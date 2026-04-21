// Dispatches review requests to a provider-specific adapter.
//
// Supported preset names (map to current production model ids):
//   haiku        -> claude-haiku-4-5
//   sonnet       -> claude-sonnet-4-6
//   opus         -> claude-opus-4-7
//   gemini-flash -> gemini-2.0-flash
//   gemini-pro   -> gemini-2.5-pro
//   mock         -> mock-reviewer (offline)
//
// You can also pass a full provider model id; anything starting with
// "claude-" routes to Claude, anything starting with "gemini-" routes to
// Gemini. This makes it easy to swap to a new model without code changes.

const MODEL_PRESETS = {
  'haiku':        { provider: 'claude', modelId: 'claude-haiku-4-5' },
  'sonnet':       { provider: 'claude', modelId: 'claude-sonnet-4-6' },
  'opus':         { provider: 'claude', modelId: 'claude-opus-4-7' },
  'gemini-flash': { provider: 'gemini', modelId: 'gemini-2.0-flash' },
  'gemini-pro':   { provider: 'gemini', modelId: 'gemini-2.5-pro' },
  'mock':         { provider: 'mock',   modelId: 'mock-reviewer' },
};

function resolveReviewerModel(inputName) {
  const requested = inputName || 'haiku';
  if (MODEL_PRESETS[requested]) return MODEL_PRESETS[requested];
  if (requested.startsWith('claude-')) return { provider: 'claude', modelId: requested };
  if (requested.startsWith('gemini-')) return { provider: 'gemini', modelId: requested };
  if (requested === 'mock') return MODEL_PRESETS.mock;
  throw new Error(
    `Unknown reviewer model "${requested}". Presets: ${Object.keys(MODEL_PRESETS).join(', ')}. ` +
    `Or pass a full claude-* / gemini-* id.`,
  );
}

function getReviewerAdapter(inputName) {
  const resolved = resolveReviewerModel(inputName);
  return { ...resolved, reviewer: loadAdapterForProvider(resolved.provider) };
}

function loadAdapterForProvider(providerName) {
  switch (providerName) {
    case 'claude': return require('./claude_reviewer');
    case 'gemini': return require('./gemini_reviewer');
    case 'mock':   return require('./mock_reviewer');
    default: throw new Error(`Unsupported reviewer provider: ${providerName}`);
  }
}

module.exports = {
  MODEL_PRESETS,
  resolveReviewerModel,
  getReviewerAdapter,
  // Back-compat alias used by ai_ux_testing today.
  resolveModel: resolveReviewerModel,
  getReviewer: getReviewerAdapter,
};
