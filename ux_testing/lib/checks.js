// Normalize recipe checks into a uniform {id, text} shape.
// Recipe authors may write either:
//   - "plain string"  -> { id: null, text: "plain string" }
//   - { "id": "foo", "text": "plain string" }
//
// diff_engine matches by id first (if both sides have one), then by text.

function normalizeRecipeChecks(checks) {
  return (checks || []).map(c => (typeof c === 'string' ? { id: null, text: c } : { id: c.id || null, text: c.text }));
}

function checkText(c) {
  return typeof c === 'string' ? c : c.text;
}

function checkId(c) {
  return (c && typeof c === 'object') ? (c.id || null) : null;
}

module.exports = { normalizeRecipeChecks, checkText, checkId };
