// Load environment variables from, in priority order:
//   1. process.env (already set — wins, never overwritten)
//   2. Local .env.local at the caller's project root
//   3. Optional fallback env file (defaults to DatsMe's api/.env)
//
// Callers pass their own project root so this module does not assume any
// particular consuming project's layout.

const fs = require('fs');
const path = require('path');

// From combined/shared/ : ../.. = claude_code/, then myspace2/api/.env.
// Override with AI_UX_FALLBACK_ENV_PATH if your layout differs.
const DEFAULT_FALLBACK_ENV_PATH = process.env.AI_UX_FALLBACK_ENV_PATH
  ? path.resolve(process.env.AI_UX_FALLBACK_ENV_PATH)
  : path.resolve(__dirname, '..', '..', 'myspace2', 'api', '.env');

function loadEnvironmentVariables({
  projectRoot,
  fallbackEnvPath = DEFAULT_FALLBACK_ENV_PATH,
} = {}) {
  if (!projectRoot) {
    throw new Error('loadEnvironmentVariables: projectRoot is required');
  }
  const localEnvPath = path.join(projectRoot, '.env.local');
  applyEnvFileWithoutOverwriting(localEnvPath);
  applyEnvFileWithoutOverwriting(fallbackEnvPath);
  return { localEnvPath, fallbackEnvPath };
}

function applyEnvFileWithoutOverwriting(filePath) {
  const parsed = parseDotenvFile(filePath);
  for (const [key, value] of Object.entries(parsed)) {
    if (!(key in process.env)) process.env[key] = value;
  }
}

function parseDotenvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  const parsed = {};
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const equalsIndex = line.indexOf('=');
    if (equalsIndex < 0) continue;
    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

module.exports = {
  loadEnvironmentVariables,
  parseDotenvFile,
  DEFAULT_FALLBACK_ENV_PATH,
};
