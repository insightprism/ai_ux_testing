// Recipe-builder front-end. Plain JS, no framework.
// Builds a recipe JSON matching lib/schema.js and POSTs it to the server.

const ACTION_FIELDS = {
  goto:            [{ name: 'path',     label: 'Path',     placeholder: '/sara.1/' }],
  click_text:      [{ name: 'text',     label: 'Visible text', placeholder: 'Personality' }],
  click_selector:  [{ name: 'selector', label: 'CSS selector', placeholder: 'button[data-test="open"]' }],
  fill:            [
    { name: 'label',    label: 'Input label (optional)', placeholder: 'Email' },
    { name: 'selector', label: 'CSS selector (optional)', placeholder: 'input[name="email"]' },
    { name: 'value',    label: 'Value',                    placeholder: 'markly.1' },
  ],
  wait:            [{ name: 'ms', label: 'Milliseconds', placeholder: '1000', type: 'number' }],
  scroll:          [
    { name: 'direction', label: 'Direction', placeholder: 'down', options: ['down', 'up', 'top', 'bottom'] },
    { name: 'amount',    label: 'Pixels (optional)', placeholder: '800', type: 'number' },
  ],
  scroll_inside:   [
    { name: 'text',      label: 'Text inside the scrollable region (optional if selector given)', placeholder: 'Your Big Five Personality Test' },
    { name: 'selector',  label: 'CSS selector of scrollable region (optional if text given)', placeholder: '[role="dialog"] .overflow-y-auto' },
    { name: 'direction', label: 'Direction', placeholder: 'down', options: ['down', 'up', 'top', 'bottom'] },
    { name: 'amount',    label: 'Pixels (optional)', placeholder: '600', type: 'number' },
  ],
  screenshot:      [{ name: 'name', label: 'Screenshot name', placeholder: 'personality_report' }],
};

const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return n;
};

// ----- state -----
let credNames = [];

// ----- recipe list -----
async function loadRecipes() {
  const list = document.getElementById('recipe-list');
  list.innerHTML = '';
  const res = await fetch('/api/recipes').then(r => r.json());
  if (!res.length) {
    list.appendChild(el('li', { class: 'muted' }, 'No recipes yet.'));
    return;
  }
  for (const r of res) {
    list.appendChild(el('li', {},
      el('div', {},
        el('div', {}, r.name || r.id || r.file),
        el('div', { class: 'meta' }, r.description || r.file),
      ),
      el('button', { class: 'secondary', onclick: () => loadIntoForm(r.id) }, 'Edit')
    ));
  }
}

async function loadCredentials() {
  credNames = await fetch('/api/credentials').then(r => r.json());
  const sel = document.getElementById('f-login-password-env');
  sel.innerHTML = '';
  sel.appendChild(el('option', { value: '' }, '— none —'));
  credNames.forEach(n => sel.appendChild(el('option', { value: n }, n)));
}

async function loadIntoForm(id) {
  const data = await fetch(`/api/recipes/${id}`).then(r => r.json());
  openForm();
  document.getElementById('form-title').textContent = `Edit: ${data.name || id}`;
  document.getElementById('f-id').value = data.id || '';
  document.getElementById('f-name').value = data.name || '';
  document.getElementById('f-description').value = data.description || '';
  document.getElementById('f-base-url').value = data.target?.base_url || '';
  document.getElementById('f-login-url').value = data.login?.url || '';
  document.getElementById('f-login-username').value = data.login?.username || '';
  document.getElementById('f-login-password-env').value = data.login?.password_env || '';

  document.getElementById('steps-list').innerHTML = '';
  (data.steps || []).forEach(s => addStepRow(s));

  document.getElementById('checks-list').innerHTML = '';
  (data.checks || []).forEach(c => addCheckRow(c));

  document.getElementById('f-vp-mobile').checked = (data.viewports || []).includes('mobile');
  document.getElementById('f-vp-desktop').checked = (data.viewports || []).includes('desktop');
  setStepMode('manual');
}

// ----- form open/close -----
function openForm() {
  const card = document.getElementById('form-card');
  card.hidden = false;
  document.getElementById('save-result').hidden = true;
  document.getElementById('save-errors').hidden = true;
}
function resetForm() {
  document.getElementById('form-title').textContent = 'New recipe';
  ['f-id','f-name','f-description','f-base-url','f-login-url','f-login-username'].forEach(i => document.getElementById(i).value = '');
  document.getElementById('f-login-password-env').value = '';
  document.getElementById('steps-list').innerHTML = '';
  document.getElementById('checks-list').innerHTML = '';
  document.getElementById('f-vp-mobile').checked = true;
  document.getElementById('f-vp-desktop').checked = true;
  addStepRow({ action: 'goto', path: '/' });
  addCheckRow('');
}

// ----- step rows -----
function renumberRows(listId, badgeClass) {
  const rows = document.querySelectorAll(`#${listId} .${badgeClass}`);
  rows.forEach((b, i) => { b.textContent = String(i + 1); });
}

function addStepRow(preset = { action: 'goto' }) {
  const wrap = document.getElementById('steps-list');
  const row = el('div', { class: 'step-row' });
  const numBadge = el('div', { class: 'num-badge step-num' }, '');
  const inner = el('div', { class: 'inner' });
  const select = el('select', {},
    ...Object.keys(ACTION_FIELDS).map(a => el('option', { value: a, selected: a === preset.action ? '' : null }, a))
  );
  const fieldsWrap = el('div', { class: 'inner' });

  const renderFields = () => {
    fieldsWrap.innerHTML = '';
    const action = select.value;
    for (const f of ACTION_FIELDS[action]) {
      const input = f.options
        ? el('select', { 'data-field': f.name },
            ...f.options.map(o => el('option', { value: o, selected: preset[f.name] === o ? '' : null }, o)))
        : el('input', {
            'data-field': f.name,
            type: f.type || 'text',
            placeholder: f.placeholder || '',
            value: preset[f.name] !== undefined ? String(preset[f.name]) : '',
          });
      fieldsWrap.appendChild(el('label', {}, el('span', {}, f.label), input));
    }
  };
  select.addEventListener('change', renderFields);
  renderFields();

  inner.appendChild(el('label', {}, el('span', {}, 'Action'), select));
  inner.appendChild(fieldsWrap);
  row.appendChild(numBadge);
  row.appendChild(inner);
  row.appendChild(el('button', {
    class: 'btn-remove',
    type: 'button',
    onclick: () => { row.remove(); renumberRows('steps-list', 'step-num'); },
  }, 'Remove'));
  wrap.appendChild(row);
  renumberRows('steps-list', 'step-num');
}

// ----- check rows -----
function addCheckRow(value = '') {
  const wrap = document.getElementById('checks-list');
  const row = el('div', { class: 'check-row' });
  const numBadge = el('div', { class: 'num-badge check-num' }, '');
  const input = el('input', { 'data-field': 'check', placeholder: 'The report should show a Big Five chart', value });
  row.appendChild(numBadge);
  row.appendChild(input);
  row.appendChild(el('button', {
    class: 'btn-remove',
    type: 'button',
    onclick: () => { row.remove(); renumberRows('checks-list', 'check-num'); },
  }, 'Remove'));
  wrap.appendChild(row);
  renumberRows('checks-list', 'check-num');
}

// ----- build + save recipe -----
function collectSteps() {
  const rows = document.querySelectorAll('#steps-list .step-row');
  const steps = [];
  rows.forEach(r => {
    const action = r.querySelector('select').value;
    const step = { action };
    r.querySelectorAll('[data-field]').forEach(f => {
      const key = f.getAttribute('data-field');
      const raw = f.value;
      if (raw === '') return;
      step[key] = (f.type === 'number') ? Number(raw) : raw;
    });
    steps.push(step);
  });
  return steps;
}
function collectChecks() {
  return [...document.querySelectorAll('#checks-list [data-field="check"]')]
    .map(i => i.value.trim()).filter(Boolean);
}
function collectViewports() {
  const vp = [];
  if (document.getElementById('f-vp-mobile').checked) vp.push('mobile');
  if (document.getElementById('f-vp-desktop').checked) vp.push('desktop');
  return vp;
}

function buildRecipe() {
  const loginUsername = document.getElementById('f-login-username').value.trim();
  const loginUrl = document.getElementById('f-login-url').value.trim();
  const loginEnv = document.getElementById('f-login-password-env').value;
  const hasLogin = loginUsername || loginUrl || loginEnv;

  const recipe = {
    id: document.getElementById('f-id').value.trim(),
    name: document.getElementById('f-name').value.trim(),
    description: document.getElementById('f-description').value.trim(),
    target: { base_url: document.getElementById('f-base-url').value.trim() },
    steps: collectSteps(),
    checks: collectChecks(),
    viewports: collectViewports(),
  };
  if (hasLogin) {
    recipe.login = {
      url: loginUrl || '/login',
      username: loginUsername,
      password_env: loginEnv,
    };
  }
  return recipe;
}

async function saveRecipe() {
  const recipe = buildRecipe();
  const res = await fetch('/api/recipes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(recipe),
  });
  const data = await res.json();
  const okBox = document.getElementById('save-result');
  const errBox = document.getElementById('save-errors');
  if (res.ok) {
    okBox.hidden = false; errBox.hidden = true;
    okBox.textContent = `Saved: ${data.file}\n\nNext: run it with\n\n  cd ${window.__ROOT__ || 'ai_ux_testing'}\n  node runner/run.js ${recipe.id}\n`;
    okBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    loadRecipes();
  } else {
    errBox.hidden = false; okBox.hidden = true;
    const raw = data.errors || [data.error || 'unknown'];
    const friendly = raw.map(msg => {
      if (msg.includes('checks must be a non-empty array')) {
        return 'AI instructions: add at least one instruction AND type it into the box (the grey example text is only a placeholder — it does not save).';
      }
      if (msg.includes('steps must be a non-empty array')) {
        return 'steps: add at least one step and fill in its fields.';
      }
      if (msg.includes('id is required')) {
        return 'id: required; use letters, numbers, underscores, or dashes only — no spaces.';
      }
      if (msg.includes('target.base_url')) {
        return 'Base URL: must start with http:// or https://';
      }
      return msg;
    });
    errBox.textContent = 'Errors:\n' + friendly.join('\n');
    errBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

async function saveCredential() {
  const name = document.getElementById('cred-name').value.trim();
  const value = document.getElementById('cred-value').value;
  if (!name || !value) { alert('both name and value required'); return; }
  const res = await fetch('/api/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, value }),
  });
  const data = await res.json();
  if (res.ok) {
    document.getElementById('cred-value').value = '';
    await loadCredentials();
    document.getElementById('f-login-password-env').value = name;
    alert(`saved ${name} to ${data.file}`);
  } else {
    alert('error: ' + (data.error || 'unknown'));
  }
}

// ----- mode toggle (Record / Manual) -----
function setStepMode(mode) {
  document.querySelectorAll('.mode-btn').forEach(b => {
    const active = b.dataset.mode === mode;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.getElementById('mode-record').hidden = (mode !== 'record');
  document.getElementById('mode-manual').hidden = (mode !== 'manual');
}

document.querySelectorAll('.mode-btn').forEach(b => {
  b.addEventListener('click', () => setStepMode(b.dataset.mode));
});

// ----- recording (placeholder for v2; UI is live now) -----
let recordingAbortCtrl = null;

async function startRecording() {
  const baseUrl = document.getElementById('f-base-url').value.trim();
  if (!baseUrl) { alert('Enter a Base URL first, then start recording.'); return; }

  document.body.classList.add('is-recording');
  document.getElementById('record-idle').hidden = true;
  document.getElementById('record-active').hidden = false;
  document.getElementById('record-result').hidden = true;

  recordingAbortCtrl = new AbortController();
  try {
    const res = await fetch('/api/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base_url: baseUrl }),
      signal: recordingAbortCtrl.signal,
    });
    const data = await res.json();
    if (res.ok && Array.isArray(data.steps)) {
      data.steps.forEach(s => addStepRow(s));
      const pwdCount = data.steps.filter(s => s.needs_password_env).length;
      const warnCount = (data.warnings || []).length;
      let msg = `Recorded ${data.steps.length} step${data.steps.length === 1 ? '' : 's'}.`;
      if (pwdCount) msg += ` ${pwdCount} password field${pwdCount === 1 ? '' : 's'} detected — wire to a credential (value was NOT recorded).`;
      if (warnCount) msg += ` ${warnCount} line${warnCount === 1 ? '' : 's'} could not be parsed and were skipped.`;
      showRecordResult(msg);
      // Always switch to Manual after a successful record so the user sees the steps.
      setStepMode('manual');
      // Scroll the steps into view.
      setTimeout(() => {
        const target = document.getElementById('steps-list');
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    } else if (res.status === 409) {
      const retry = confirm('A previous recording is still in progress on the server — likely leftover from a canceled session.\n\nReset it now and try again?');
      if (retry) {
        await fetch('/api/record/reset', { method: 'POST' });
        showRecordResult('Reset done. Click Start recording again.');
      } else {
        showRecordResult('Error: ' + (data.error || 'unknown'), true);
      }
    } else {
      showRecordResult('Error: ' + (data.error || 'unknown'), true);
    }
  } catch (e) {
    if (e.name !== 'AbortError') showRecordResult('Error: ' + e.message, true);
    else showRecordResult('Recording cancelled.');
  } finally {
    stopRecordingUI();
  }
}

function stopRecordingUI() {
  document.body.classList.remove('is-recording');
  document.getElementById('record-idle').hidden = false;
  document.getElementById('record-active').hidden = true;
}

function showRecordResult(text, isError = false) {
  const box = document.getElementById('record-result');
  box.hidden = false;
  box.textContent = text;
  box.style.color = isError ? 'var(--danger)' : 'var(--muted)';
}

document.getElementById('btn-record-start').addEventListener('click', startRecording);
document.getElementById('btn-record-stop').addEventListener('click', () => {
  const ok = confirm('Discard this recording?\n\nTo SAVE your steps, close the browser window instead (click its X).\n\nClick OK to throw away what you recorded.');
  if (!ok) return;
  if (recordingAbortCtrl) recordingAbortCtrl.abort();
});

// ----- wire up -----
document.getElementById('btn-new').addEventListener('click', () => { openForm(); resetForm(); setStepMode('record'); });
document.getElementById('btn-cancel').addEventListener('click', () => { document.getElementById('form-card').hidden = true; });
document.getElementById('btn-add-step').addEventListener('click', () => addStepRow());
document.getElementById('btn-add-check').addEventListener('click', () => addCheckRow());
document.getElementById('btn-save').addEventListener('click', saveRecipe);
document.getElementById('btn-save-credential').addEventListener('click', saveCredential);

loadRecipes();
loadCredentials();
