// Minimal Express server that serves the recipe-authoring form and saves
// recipes to disk. Credentials are written to .env.local (gitignored) by
// env-var name, never inlined into recipe JSON.

const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { validateRecipe } = require('../../lib/schema');
const { parseCodegenScript } = require('../../lib/codegen_to_steps');

const ROOT = path.resolve(__dirname, '..', '..');
const PROJECT_ROOT = path.resolve(ROOT, '..');
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const RECIPES_DIR = path.join(ROOT, 'recipes');
const ENV_FILE = path.join(PROJECT_ROOT, '.env.local');

const PORT = process.env.PORT || 4100;

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(PUBLIC_DIR));

app.get('/api/recipes', (_req, res) => {
  if (!fs.existsSync(RECIPES_DIR)) return res.json([]);
  const files = fs.readdirSync(RECIPES_DIR).filter(f => f.endsWith('.json'));
  const recipes = files.map(f => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(RECIPES_DIR, f), 'utf8'));
      return { file: f, id: data.id, name: data.name, description: data.description || '' };
    } catch {
      return { file: f, id: null, name: '(invalid)', description: '' };
    }
  });
  res.json(recipes);
});

app.get('/api/recipes/:id', (req, res) => {
  const file = path.join(RECIPES_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'not found' });
  res.json(JSON.parse(fs.readFileSync(file, 'utf8')));
});

app.post('/api/recipes', (req, res) => {
  const recipe = req.body;
  const result = validateRecipe(recipe);
  if (!result.ok) return res.status(400).json({ errors: result.errors });

  if (!fs.existsSync(RECIPES_DIR)) fs.mkdirSync(RECIPES_DIR, { recursive: true });
  const file = path.join(RECIPES_DIR, `${recipe.id}.json`);
  fs.writeFileSync(file, JSON.stringify(recipe, null, 2));
  res.json({ ok: true, file: path.relative(ROOT, file) });
});

// Credential storage: appends/updates a single KEY=VALUE line in .env.local.
// The form never sends credentials inside recipe JSON; it posts separately
// and the recipe only records the env-var NAME.
app.post('/api/credentials', (req, res) => {
  const { name, value } = req.body || {};
  if (!name || typeof name !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(name)) {
    return res.status(400).json({ error: 'name must be UPPER_SNAKE_CASE' });
  }
  if (typeof value !== 'string' || value === '') {
    return res.status(400).json({ error: 'value is required' });
  }

  let existing = '';
  if (fs.existsSync(ENV_FILE)) existing = fs.readFileSync(ENV_FILE, 'utf8');

  const lines = existing.split('\n').filter(Boolean);
  const idx = lines.findIndex(l => l.startsWith(`${name}=`));
  const newLine = `${name}=${value}`;
  if (idx >= 0) lines[idx] = newLine;
  else lines.push(newLine);

  fs.writeFileSync(ENV_FILE, lines.join('\n') + '\n', { mode: 0o600 });
  res.json({ ok: true, file: path.relative(ROOT, ENV_FILE) });
});

// Lists defined credential names (values never leave the server).
app.get('/api/credentials', (_req, res) => {
  if (!fs.existsSync(ENV_FILE)) return res.json([]);
  const names = fs.readFileSync(ENV_FILE, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => l.split('=')[0]);
  res.json(names);
});

// Recording endpoint — spawns `playwright codegen` headed at the given
// base_url. The user interacts in the opened browser; when they close it,
// codegen writes JS to a temp file which we parse into recipe steps.
//
// Only one recording may be in flight at a time.
let activeCodegen = null;

app.post('/api/record', (req, res) => {
  const { base_url } = req.body || {};
  if (!base_url || !/^https?:\/\//.test(base_url)) {
    return res.status(400).json({ error: 'base_url is required (http/https)' });
  }

  if (activeCodegen) {
    return res.status(409).json({ error: 'a recording is already in progress' });
  }

  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    return res.status(412).json({
      error: 'no display available (DISPLAY / WAYLAND_DISPLAY not set). Recording needs a desktop session.',
    });
  }

  const outFile = path.join(os.tmpdir(), `codegen_${Date.now()}.js`);

  // Invoke the playwright binary directly (not via npx) so we own the PID
  // and can kill its process group reliably. `detached: true` puts the child
  // in its own process group so `kill(-pid)` reaches the browser too.
  const playwrightBin = path.join(ROOT, 'node_modules', '.bin', 'playwright');
  const args = ['codegen', '--target=javascript', '--output', outFile, base_url];

  const child = spawn(playwrightBin, args, {
    cwd: ROOT,
    env: process.env,
    detached: true,
  });
  activeCodegen = { child, outFile };

  const killWholeTree = () => {
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }, 1500);
  };

  let stderr = '';
  child.stderr.on('data', d => { stderr += d.toString(); });

  // Allow client to cancel via the aborted request.
  req.on('aborted', () => {
    if (activeCodegen && activeCodegen.child === child) killWholeTree();
  });

  // Safety: always clear the lock even if close fires weirdly.
  child.on('error', err => {
    activeCodegen = null;
    if (!res.headersSent) res.status(500).json({ error: 'failed to launch codegen: ' + err.message });
  });

  child.on('close', code => {
    activeCodegen = null;
    let source = '';
    try { source = fs.readFileSync(outFile, 'utf8'); } catch { /* may not exist if cancelled */ }
    try { fs.unlinkSync(outFile); } catch {}

    if (!source.trim()) {
      if (res.headersSent) return;
      return res.status(200).json({
        steps: [],
        warnings: [],
        message: 'no actions recorded (browser closed without interactions)',
        exit_code: code,
        stderr_tail: stderr.slice(-500),
      });
    }

    const { steps, warnings } = parseCodegenScript(source, { baseUrl: base_url });
    if (res.headersSent) return;
    res.json({ steps, warnings, exit_code: code });
  });
});

// Emergency reset — kill any active codegen and clear the lock.
app.post('/api/record/reset', (_req, res) => {
  if (!activeCodegen) return res.json({ ok: true, killed: false });
  try { process.kill(-activeCodegen.child.pid, 'SIGKILL'); } catch {}
  activeCodegen = null;
  res.json({ ok: true, killed: true });
});

app.listen(PORT, () => {
  console.log(`ai_ux_testing form server running: http://localhost:${PORT}`);
  console.log(`  recipes dir: ${RECIPES_DIR}`);
  console.log(`  env file:    ${ENV_FILE}`);
});
