const path = require('path');
const {
  loadEnvironmentVariables,
  parseDotenvFile,
  DEFAULT_FALLBACK_ENV_PATH,
} = require('../../shared/env_loader');

// Single root .env.local for the whole monorepo (shared by ux_testing + flow_review).
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function loadEnv() {
  return loadEnvironmentVariables({ projectRoot: PROJECT_ROOT });
}

module.exports = {
  loadEnv,
  loadEnvironmentVariables,
  parseDotenvFile,
  LOCAL_ENV: path.join(PROJECT_ROOT, '.env.local'),
  DATSME_ENV: DEFAULT_FALLBACK_ENV_PATH,
};
