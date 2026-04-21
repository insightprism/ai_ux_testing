// Resolves a recipe by id. Looks in flow_review/recipes/ first, then falls
// back to ux_testing/recipes/ so recipes can be authored in either place.
//
// Returns the parsed recipe object. Throws with a clear message on miss.

const fs = require('fs');
const path = require('path');
const { validateRecipe } = require('../../shared/recipe_loader');
const { PROJECT_ROOT } = require('./flow_run_discovery');

const UX_TESTING_RECIPES_DIR = path.resolve(PROJECT_ROOT, '..', 'ux_testing', 'recipes');

function resolveRecipeById(recipeIdOrPath) {
  const recipePath = locateRecipeFile(recipeIdOrPath);
  const parsed = JSON.parse(fs.readFileSync(recipePath, 'utf8'));
  const validation = validateRecipe(parsed);
  if (!validation.ok) {
    throw new Error(`invalid recipe at ${recipePath}:\n  - ${validation.errors.join('\n  - ')}`);
  }
  return { recipe: parsed, recipePath };
}

function locateRecipeFile(recipeIdOrPath) {
  if (fs.existsSync(recipeIdOrPath) && fs.statSync(recipeIdOrPath).isFile()) {
    return recipeIdOrPath;
  }
  const candidates = [
    path.join(PROJECT_ROOT, 'recipes', `${recipeIdOrPath}.json`),
    path.join(UX_TESTING_RECIPES_DIR, `${recipeIdOrPath}.json`),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    `recipe not found: ${recipeIdOrPath}\n  searched:\n    ` + candidates.join('\n    '),
  );
}

module.exports = {
  resolveRecipeById,
  UX_TESTING_RECIPES_DIR,
};
