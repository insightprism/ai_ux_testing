#!/usr/bin/env node
// Tier-0/1 bridge: map an ai_ux_testing result.json -> JUnit XML on stdout, so Testbench's
// existing junit_xml parser can ingest a UX-review run as a `script`-method result.
// Usage: node ci/result_to_junit.js <path/to/result.json>   (or read stdin)
// Verdict mapping: overall_status pass->pass, fail->failure, warn->pass (lenient; flip if desired).
const fs = require('fs');
function esc(s){return String(s==null?'':s).replace(/[<&>"]/g,c=>({'<':'&lt;','&':'&amp;','>':'&gt;','"':'&quot;'}[c]));}
const src = process.argv[2] ? fs.readFileSync(process.argv[2],'utf8') : fs.readFileSync(0,'utf8');
const r = JSON.parse(src);
const checks = Array.isArray(r.checks) ? r.checks : [];
const cls = `ux.${esc(r.recipe_id||'recipe')}`;
const cases = checks.map((c,i)=>{
  const name = esc(c.id || `check_${i+1}`);
  const inst = esc(c.instruction||'');
  const ev = esc(c.evidence||'');
  if (c.verdict === 'fail') return `  <testcase classname="${cls}" name="${name}"><failure message="${inst}">${ev}</failure></testcase>`;
  return `  <testcase classname="${cls}" name="${name}">${inst ? `<system-out>${inst} :: ${ev}</system-out>`:''}</testcase>`;
});
// If overall failed but no individual check failed, emit a synthesizing failure so the verdict is honest.
if (r.overall_status === 'fail' && !checks.some(c=>c.verdict==='fail')) {
  cases.push(`  <testcase classname="${cls}" name="overall"><failure message="overall_status=fail">${esc(r.summary||'')}</failure></testcase>`);
}
const fails = checks.filter(c=>c.verdict==='fail').length + (r.overall_status==='fail' && !checks.some(c=>c.verdict==='fail') ? 1:0);
process.stdout.write(
`<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="ux:${esc(r.recipe_id||'recipe')}" tests="${cases.length}" failures="${fails}">
${cases.join('\n')}
</testsuite>
`);
