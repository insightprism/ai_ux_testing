// Builds the Markdown prompt sent to the AI reviewer for flow-quality review.
// Pure: no network, no file writes. Takes the run, computed flow metrics, the
// recipe, and an optional reference report whose observed keys/shape must be
// matched.

const {
  FLOW_REPORT_SCHEMA_VERSION,
  ALLOWED_FRICTION_VERDICTS,
} = require('./flow_report_schema');

const VERBATIM_EVALUATOR_INSTRUCTION =
  'You are evaluating the flow a reasonable first-time user would have going ' +
  'through these steps. Count clicks, flag backtracks where the user went ' +
  'somewhere and came back, identify moments where a user would hesitate. ' +
  'Backtracks visible in the recipe itself may be intentional test coverage — ' +
  'weight hesitation moments and screen complexity over raw backtrack counts.';

function buildFlowReviewPrompt({
  capturedRun,
  flowMetrics,
  recipe,
  referenceFlowReport = null,
}) {
  const lines = [];
  lines.push(`# Flow Review — ${capturedRun.recipeName || recipe.name}`);
  lines.push('');
  lines.push(`**Recipe:** \`${capturedRun.recipeId}\`  `);
  lines.push(`**Run:** \`${capturedRun.runId}\`  `);
  if (recipe.description) {
    lines.push(`**Description:** ${recipe.description}`);
  }
  if (recipe.flow_review && recipe.flow_review.describedUserIntent) {
    lines.push('');
    lines.push(`**User intent being tested:** ${recipe.flow_review.describedUserIntent}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Your task');
  lines.push('');
  lines.push(VERBATIM_EVALUATOR_INSTRUCTION);
  lines.push('');
  lines.push('Return ONLY valid JSON matching the skeleton at the end of this prompt.');
  lines.push('No preamble, no markdown fences, no commentary.');
  lines.push('');

  lines.push('## Measured metrics (already computed — do not re-guess these)');
  lines.push('');
  lines.push('Copy this object verbatim into your JSON response as `perViewportMetrics`.');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify({ perViewportMetrics: flowMetrics }, null, 2));
  lines.push('```');
  lines.push('');

  if (Array.isArray(capturedRun.screenshots) && capturedRun.screenshots.length) {
    lines.push('## Screenshots');
    lines.push('');
    for (const screenshot of capturedRun.screenshots) {
      lines.push(`- \`${screenshot.path}\` — ${screenshot.name} (${screenshot.viewport})`);
    }
    lines.push('');
  }

  if (referenceFlowReport) {
    lines.push('## Reference shape (from prior approved report)');
    lines.push('');
    lines.push('Keep the same keys and verdict vocabulary so the report is comparable.');
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify({
      frictionVerdict: referenceFlowReport.frictionVerdict,
      evidenceKeysUsedLastTime: (referenceFlowReport.frictionEvidenceBulletPoints || []).slice(0, 3),
    }, null, 2));
    lines.push('```');
    lines.push('');
  }

  lines.push('## Return this JSON skeleton');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(buildReturnJsonSkeleton(capturedRun), null, 2));
  lines.push('```');
  lines.push('');
  lines.push('Rules:');
  lines.push(`- \`schemaVersion\` must be \`${FLOW_REPORT_SCHEMA_VERSION}\`.`);
  lines.push(`- \`frictionVerdict\` must be one of: ${[...ALLOWED_FRICTION_VERDICTS].map(v => `\`${v}\``).join(', ')}.`);
  lines.push('- `frictionEvidenceBulletPoints` and `suggestedFlowImprovements` — short strings, no prose paragraphs.');
  lines.push('- Use the measured metrics above verbatim in `perViewportMetrics` — do not recompute.');
  return lines.join('\n');
}

function buildReturnJsonSkeleton(capturedRun) {
  return {
    schemaVersion: FLOW_REPORT_SCHEMA_VERSION,
    recipeId: capturedRun.recipeId,
    runId: capturedRun.runId,
    reviewedAt: '<ISO-8601 UTC, e.g. 2026-04-20T19:15:30Z>',
    reviewerModel: '<model id — will be set by the runner>',
    perViewportMetrics: '<copy verbatim from the measured metrics block above>',
    frictionVerdict: `<one of: ${[...ALLOWED_FRICTION_VERDICTS].join('|')}>`,
    frictionEvidenceBulletPoints: ['<short string>', '...'],
    suggestedFlowImprovements: ['<short string>', '...'],
    humanReadableSummary: '<2-4 sentences summarising the friction and what to try>',
  };
}

module.exports = {
  buildFlowReviewPrompt,
  VERBATIM_EVALUATOR_INSTRUCTION,
};
