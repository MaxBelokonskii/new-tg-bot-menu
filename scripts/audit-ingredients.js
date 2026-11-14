#!/usr/bin/env node
/**
 * Dry-run audit of the recipe catalog (database/recipes.json + dictionaries).
 * Touches no database: runs the same normalization pipeline as migrate.js
 * and prints what still needs a product decision or a data fix.
 *
 * Usage: npm run audit:ingredients
 * Exit code 1 when hard problems remain (compound / untyped names, units
 * without a factor, ingredients without nutrition, zero-calorie recipes).
 */
const path = require('path');
const {
  resolveIngredient,
  resolveRecipeIngredients,
  hasType,
  isDirtyName
} = require('../src/database/ingredient-normalizer');
const { computeRecipeNutrition, hasNutrition } = require('../src/database/nutrition-calculator');

const EXTREMES = 5;
const QUALIFIERS = /\s*(\d+([.,]\d+)?%|тертый|нежирный|замороженн\S*|слабосолен\S*|свеж\S*)\s*/gi;

/**
 * Groups names that share a first word after stripping qualifiers
 * ("Сыр 9%", "Сыр тертый" → "сыр"). Only multi-member groups are returned.
 * @param {string[]} names
 * @returns {Array<string[]>}
 */
function mergeCandidates(names) {
  const groups = new Map();
  for (const name of names) {
    const key = name.replace(QUALIFIERS, ' ').trim().split(/\s+/)[0].toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(name);
  }
  return [...groups.values()].filter(g => g.length > 1);
}

/**
 * Computed per-serving nutrition for every recipe whose ingredients all have
 * nutrition entries (the rest are reported separately).
 * @param {Array<object>} recipes
 * @param {Map<string, Array<object>>} rowsByRecipe
 * @returns {Array<{recipe: object, n: object}>}
 */
function computeAll(recipes, rowsByRecipe) {
  return recipes
    .filter(r => rowsByRecipe.get(r.name).every(row => hasNutrition(row.name)))
    .map(r => ({ recipe: r, n: computeRecipeNutrition(r, rowsByRecipe.get(r.name)) }));
}

const describe = ({ recipe, n }) =>
  `${recipe.id} «${recipe.name}»: ${n.calories} kcal, ${n.weight} g, servings ${n.servings}`;

/**
 * Builds the full audit report from the parsed recipes.
 * @param {Array<object>} recipes
 * @returns {{lines: string[], hardProblems: number}}
 */
function buildReport(recipes) {
  const sourceNames = new Set();
  const usage = new Map();
  const conflicts = [];
  const rowsByRecipe = new Map();
  for (const recipe of recipes) {
    recipe.ingredients.forEach(i => sourceNames.add(i.item));
    const { rows, conflicts: c } = resolveRecipeIngredients(recipe.ingredients);
    rowsByRecipe.set(recipe.name, rows);
    rows.forEach(r => usage.set(r.name, (usage.get(r.name) || 0) + 1));
    c.forEach(text => conflicts.push(`${recipe.name}: ${text}`));
  }
  const canonical = [...usage.keys()].sort((a, b) => a.localeCompare(b, 'ru'));
  const dirty = canonical.filter(isDirtyName);
  const untyped = canonical.filter(n => !hasType(n));
  const noNutrition = canonical.filter(n => !hasNutrition(n));
  const computed = computeAll(recipes, rowsByRecipe).sort((a, b) => a.n.calories - b.n.calories);
  const zeroKcal = computed.filter(c => c.n.calories <= 0).map(describe);
  const units = new Map();
  recipes.forEach(r => r.ingredients.flatMap(resolveIngredient)
    .forEach(row => units.set(row.unit, (units.get(row.unit) || 0) + 1)));

  const section = (title, items) => [
    '', `## ${title} (${items.length})`, ...(items.length ? items.map(i => `- ${i}`) : ['- —'])
  ];
  const lines = [
    '# Ingredient catalog audit',
    `Recipes: ${recipes.length}; source names: ${sourceNames.size}; canonical ingredients: ${canonical.length}`,
    ...section('Compound / alternative names left (must be 0)', dirty),
    ...section('Missing in ingredient-types.json (must be 0)', untyped),
    ...section('Units without a conversion factor (must be 0)', conflicts),
    ...section('Missing in ingredient-nutrition.json (must be 0)', noNutrition),
    ...section('Computed calories = 0 (must be 0)', zeroKcal),
    ...section('Lowest / highest computed kcal per serving — sanity check',
      [...computed.slice(0, EXTREMES), ...computed.slice(-EXTREMES)].map(describe)),
    ...section('Merge candidates — same first word, review manually',
      mergeCandidates(canonical).map(g => g.map(n => `${n} (${usage.get(n)})`).join(' | '))),
    ...section('Units after normalization',
      [...units].sort((a, b) => b[1] - a[1]).map(([u, c]) => `${u}: ${c}`))
  ];
  return { lines, hardProblems: dirty.length + untyped.length + conflicts.length + noNutrition.length + zeroKcal.length };
}

if (require.main === module) {
  const { recipes } = require(path.resolve(__dirname, '../database/recipes.json'));
  const { lines, hardProblems } = buildReport(recipes);
  console.log(lines.join('\n'));
  if (hardProblems) process.exitCode = 1;
}

module.exports = { buildReport, mergeCandidates };
