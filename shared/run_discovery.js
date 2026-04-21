// Run-folder and baseline-file discovery, parameterised by directory paths so
// it can serve both ai_ux_testing and ai_flow_review without assuming either
// tool's layout.
//
// Selection rule: "latest" = lexicographically greatest folder matching
// `<recipe-id>__*`. Because run timestamps are zero-padded YYYYMMDD-HHMMSS,
// lex order equals chronological order.
//
// Call `createRunDiscovery({ runsDir, baselinesDir, resultFileName })` and use
// the returned object as you would the module-level helpers in ai_ux_testing's
// lib/runs.js today.

const fs = require('fs');
const path = require('path');

function createRunDiscovery({
  runsDir,
  baselinesDir,
  resultFileName = 'result.json',
}) {
  if (!runsDir) throw new Error('createRunDiscovery: runsDir is required');
  if (!baselinesDir) throw new Error('createRunDiscovery: baselinesDir is required');

  function listRunFoldersForRecipe(recipeId) {
    if (!fs.existsSync(runsDir)) return [];
    const folderNamePrefix = `${recipeId}__`;
    return fs.readdirSync(runsDir)
      .filter(folderName => folderName.startsWith(folderNamePrefix))
      .filter(folderName => fs.statSync(path.join(runsDir, folderName)).isDirectory())
      .map(folderName => ({
        dir: path.join(runsDir, folderName),
        dirName: folderName,
        runId: folderName.slice(folderNamePrefix.length),
      }))
      .sort((a, b) => b.runId.localeCompare(a.runId));
  }

  function runHasResultFile(runDir) {
    return fs.existsSync(path.join(runDir, resultFileName));
  }

  function findRuns(recipeId) {
    return listRunFoldersForRecipe(recipeId).map(run => ({
      ...run,
      hasResult: runHasResultFile(run.dir),
    }));
  }

  function latestRun(recipeId) {
    const runs = listRunFoldersForRecipe(recipeId);
    if (!runs.length) return null;
    return { ...runs[0], hasResult: runHasResultFile(runs[0].dir) };
  }

  function latestResult(recipeId) {
    for (const run of listRunFoldersForRecipe(recipeId)) {
      if (runHasResultFile(run.dir)) {
        return { ...run, hasResult: true };
      }
    }
    return null;
  }

  function findRun(recipeId, runId) {
    const match = listRunFoldersForRecipe(recipeId).find(run => run.runId === runId);
    if (!match) return null;
    return { ...match, hasResult: runHasResultFile(match.dir) };
  }

  function baselinePath(recipeId, baselineName = 'default') {
    if (baselineName === 'default') {
      const flatLayoutPath = path.join(baselinesDir, `${recipeId}.json`);
      const folderLayoutPath = path.join(baselinesDir, recipeId, 'default.json');
      if (fs.existsSync(folderLayoutPath)) return folderLayoutPath;
      if (fs.existsSync(flatLayoutPath)) return flatLayoutPath;
      return fs.existsSync(path.join(baselinesDir, recipeId)) ? folderLayoutPath : flatLayoutPath;
    }
    return path.join(baselinesDir, recipeId, `${baselineName}.json`);
  }

  function listBaselines(recipeId) {
    const names = new Set();
    const flatLayoutPath = path.join(baselinesDir, `${recipeId}.json`);
    if (fs.existsSync(flatLayoutPath)) names.add('default');
    const folder = path.join(baselinesDir, recipeId);
    if (fs.existsSync(folder) && fs.statSync(folder).isDirectory()) {
      for (const file of fs.readdirSync(folder)) {
        if (file.endsWith('.json')) names.add(file.replace(/\.json$/, ''));
      }
    }
    return [...names].sort();
  }

  function loadBaseline(recipeId, baselineName = 'default') {
    const file = baselinePath(recipeId, baselineName);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  function loadResult(runDir) {
    const file = path.join(runDir, resultFileName);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  function ensureBaselinesDir() {
    if (!fs.existsSync(baselinesDir)) fs.mkdirSync(baselinesDir, { recursive: true });
  }

  return {
    runsDir,
    baselinesDir,
    resultFileName,
    findRuns,
    latestRun,
    latestResult,
    findRun,
    baselinePath,
    listBaselines,
    loadBaseline,
    loadResult,
    ensureBaselinesDir,
  };
}

module.exports = { createRunDiscovery };
