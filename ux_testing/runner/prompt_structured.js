// Builds PROMPT_STRUCTURED.md — the reviewer contract that produces result.json.
// See docs/SPEC_BASELINE_REGRESSION.md §5.4.
//
// One function, single entry point. Branches on whether a baseline is provided:
//   - null baseline → reviewer freely authors observed keys.
//   - baseline given → baseline.observed top-level keys are inlined as a required shape.

const path = require('path');

function buildStructuredPrompt(run, recipe, baseline = null) {
  const rel = (p) => p.replace(/^runs\//, 'runs/');
  const observedSchema = extractObservedKeys(baseline);

  const lines = [];
  lines.push(`# AI UX Test — Structured Review — ${run.recipe_name}`);
  lines.push('');
  lines.push(`**Recipe:** \`${run.recipe_id}\`  `);
  lines.push(`**Run:** \`${run.started_at}\`  `);
  lines.push(`**Status (mechanical):** \`${run.status}\`${run.error ? `  — ${run.error}` : ''}`);
  if (run.description) {
    lines.push('');
    lines.push(`**Description:** ${run.description}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Your task');
  lines.push('');
  lines.push('Open each screenshot below with your vision tool. For each numbered AI instruction, produce a verdict (`pass` / `fail` / `warn`) with one-sentence evidence quoting what you saw. Then populate `observed` with **structured facts** extracted from the screenshots.');
  lines.push('');
  lines.push('Return **only valid JSON** — no preamble, no markdown fences, no commentary. It must match the skeleton below exactly.');
  lines.push('');

  if (observedSchema) {
    lines.push('### Required `observed` shape (from baseline)');
    lines.push('');
    lines.push('This recipe has an approved baseline. You **must** populate every key listed below in `observed`. If a value is not present in the current run, use `null` or `[]` — do NOT omit the key. Adding extra keys is allowed but will be flagged as schema drift.');
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify({ observed: observedSchema }, null, 2));
    lines.push('```');
    lines.push('');
  } else {
    lines.push('### `observed` guidance (no baseline yet)');
    lines.push('');
    lines.push('No baseline exists for this recipe yet. Populate `observed` with any structured facts you can extract from the screenshots — things a future run could compare against. Prefer short scalar values and small arrays of strings. No prose paragraphs.');
    lines.push('');
    lines.push('Good examples: `"primary_trait": "Neuroticism"`, `"sections_found": ["Overview", "Strengths"]`, `"modal_present": true`, `"error_banners": []`.');
    lines.push('');
  }

  lines.push('## Screenshots');
  lines.push('');
  for (const s of run.screenshots) {
    lines.push(`- \`${s.path}\` — ${s.name} (${s.viewport})`);
  }
  lines.push('');

  lines.push('## AI instructions to evaluate');
  lines.push('');
  const normalized = normalizeForPrompt(run, recipe);
  normalized.forEach((c, i) => {
    const idTag = c.id ? ` (id: ${c.id})` : '';
    lines.push(`${i + 1}. ${c.text}${idTag}`);
  });
  lines.push('');

  lines.push('## Return this exact JSON skeleton');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(buildSkeleton(run, recipe, observedSchema), null, 2));
  lines.push('```');
  lines.push('');
  lines.push('Rules:');
  lines.push('- `schema_version` must be `1`.');
  lines.push('- `reviewed_at` must be an ISO-8601 timestamp (e.g. `2026-04-20T19:15:30Z`).');
  lines.push('- `reviewer` must identify who/what reviewed (e.g. `claude-opus-manual`).');
  lines.push('- `overall_status` is the rollup: `fail` if any check is `fail`, else `warn` if any is `warn`, else `pass`.');
  lines.push('- Each `checks[].instruction` must match the corresponding instruction text verbatim.');
  lines.push('- `observed` values must be JSON primitives, or arrays / objects with primitive leaves. No prose paragraphs.');
  lines.push('');
  lines.push('Save the JSON then run:');
  lines.push('');
  lines.push('```');
  lines.push(`node runner/save_result.js ${run.recipe_id} < path/to/your.json`);
  lines.push('```');

  return lines.join('\n');
}

function extractObservedKeys(baseline) {
  if (!baseline || !baseline.observed || typeof baseline.observed !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(baseline.observed)) {
    if (k === '_schema_frozen') continue;
    out[k] = describeShape(v);
  }
  return Object.keys(out).length ? out : null;
}

function describeShape(v) {
  if (v === null) return '<null | primitive>';
  if (Array.isArray(v)) return v.length ? [describeShape(v[0])] : [];
  const t = typeof v;
  if (t === 'string') return '<string>';
  if (t === 'number') return '<number>';
  if (t === 'boolean') return '<boolean>';
  if (t === 'object') {
    const o = {};
    for (const [k, vv] of Object.entries(v)) o[k] = describeShape(vv);
    return o;
  }
  return `<${t}>`;
}

function buildSkeleton(run, recipe, observedSchema) {
  const normalized = normalizeForPrompt(run, recipe);
  const skeletonObserved = observedSchema || { '<your_key>': '<your_value_here>' };
  return {
    schema_version: 1,
    recipe_id: run.recipe_id,
    run_id: run.started_at,
    reviewed_at: '<ISO-8601 UTC, e.g. 2026-04-20T19:15:30Z>',
    reviewer: 'claude-opus-manual',
    overall_status: '<pass | fail | warn>',
    checks: normalized.map((c) => ({
      ...(c.id ? { id: c.id } : {}),
      instruction: c.text,
      verdict: '<pass | fail | warn>',
      evidence: '<one sentence grounded in what you saw>',
      screenshot_refs: ['<relevant screenshot path>'],
    })),
    observed: skeletonObserved,
    summary: '<short human-readable paragraph>',
  };
}

function normalizeForPrompt(run, recipe) {
  if (Array.isArray(run.checks_normalized)) return run.checks_normalized;
  const source = run.checks || recipe.checks || [];
  return source.map(c => (typeof c === 'string' ? { id: null, text: c } : { id: c.id || null, text: c.text }));
}

module.exports = { buildStructuredPrompt };
