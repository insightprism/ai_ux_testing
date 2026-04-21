// Mock reviewer for offline pipeline tests. Produces a minimal valid UX
// result.json (perception review) without hitting any network. For flow
// review, the consuming tool should pass its own expected shape — this
// reviewer isn't aware of flow-review schemas.

async function runReview({ modelId, promptMarkdown, screenshots, dryRun = false }) {
  if (dryRun) {
    return { dryRun: true, url: '(mock)', model: modelId, numImages: screenshots.length };
  }
  const instructions = extractInstructionsFromPrompt(promptMarkdown);
  const observedFromBaseline = extractBaselineObservedFromPrompt(promptMarkdown);
  const recipeId = extractFieldFromPrompt(promptMarkdown, 'Recipe');
  const runId = extractFieldFromPrompt(promptMarkdown, 'Run');

  return {
    schema_version: 1,
    recipe_id: recipeId || 'unknown',
    run_id: runId || 'unknown',
    reviewed_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    reviewer: 'mock-reviewer',
    overall_status: 'pass',
    checks: instructions.map(text => ({
      instruction: text,
      verdict: 'pass',
      evidence: 'Mock reviewer — no vision inspection.',
      screenshot_refs: [],
    })),
    observed: observedFromBaseline || { mock: true },
    summary: 'Mock review completed.',
  };
}

function extractFieldFromPrompt(markdown, label) {
  const pattern = new RegExp(`\\*\\*${label}:\\*\\*\\s*\`([^\`]+)\``);
  const match = markdown.match(pattern);
  return match ? match[1] : null;
}

function extractInstructionsFromPrompt(markdown) {
  const aiInstructionSection = markdown.split('## AI instructions to evaluate')[1];
  if (!aiInstructionSection) return [];
  const bulletList = aiInstructionSection.split('## Return')[0];
  const instructions = [];
  for (const line of bulletList.split('\n')) {
    const match = line.match(/^\d+\.\s+(.*)$/);
    if (match) instructions.push(match[1].trim());
  }
  return instructions;
}

function extractBaselineObservedFromPrompt(markdown) {
  const blockAfterBaselineHeader = markdown.split('Required `observed` shape (from baseline)')[1];
  if (!blockAfterBaselineHeader) return null;
  const fenceMatch = blockAfterBaselineHeader.match(/```json\s*([\s\S]*?)```/);
  if (!fenceMatch) return null;
  try {
    const parsed = JSON.parse(fenceMatch[1]);
    if (!parsed.observed) return null;
    const placeholders = {};
    for (const key of Object.keys(parsed.observed)) placeholders[key] = null;
    return placeholders;
  } catch {
    return null;
  }
}

module.exports = {
  runReview,
  review: runReview,
};
