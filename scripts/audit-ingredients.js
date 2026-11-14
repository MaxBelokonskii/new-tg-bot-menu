#!/usr/bin/env node
/**
 * Dry-run audit of the recipe catalog (database/recipes.json + dictionaries).
 * Touches no database: runs the same normalization pipeline as migrate.js
 * and prints what still needs a product decision or a data fix.
 *
 * Usage: npm run audit:ingredients
 * Exit code 1 when hard problems remain (compound names, untyped names,
 * unmergeable collisions, broken nutrition).
 */
const path = require('path');
const {
  resolveIngredient,
  resolveRecipeIngredients,
  hasType,
  isDirtyName
} = require('../src/database/ingredient-normalizer');

const NUTRITION_TOLERANCE = 0.15;
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
 * @param {object} recipe - recipes.json entry
 * @returns {string|null} problem description, or null when nutrition looks sane
 */
function nutritionProblem(recipe) {
  const n = recipe.nutrition_per_serving || {};
  const kcal = n.calories || 0;
  const fromMacros = (n.proteins || 0) * 4 + (n.fats || 0) * 9 + (n.carbs || 0) * 4;
  if (!kcal) return `calories = 0 (macros give ${Math.round(fromMacros)})`;
  if (!fromMacros) return `macros are all 0 (calories ${kcal})`;
  const diff = Math.abs(fromMacros - kcal) / kcal;
  if (diff > NUTRITION_TOLERANCE) {
    return `calories ${kcal} vs P*4+F*9+C*4 = ${Math.round(fromMacros)} (${Math.round(diff * 100)}%)`;
  }
  return null;
}

/**
 * Builds the full audit report from the parsed recipes.
 * @param {Array<object>} recipes
 * @returns {{lines: string[], hardProblems: number}}
 */
function buildReport(recipes) {
  const sourceNames = new Set();
  const usage = new Map();
  const conflicts = [];
  for (const recipe of recipes) {
    recipe.ingredients.forEach(i => sourceNames.add(i.item));
    const { rows, conflicts: c } = resolveRecipeIngredients(recipe.ingredients);
    rows.forEach(r => usage.set(r.name, (usage.get(r.name) || 0) + 1));
    c.forEach(text => conflicts.push(`${recipe.name}: ${text}`));
  }
  const canonical = [...usage.keys()].sort((a, b) => a.localeCompare(b, 'ru'));
  const dirty = canonical.filter(isDirtyName);
  const untyped = canonical.filter(n => !hasType(n));
  const nutrition = recipes
    .map(r => [r, nutritionProblem(r)])
    .filter(([, p]) => p)
    .map(([r, p]) => `${r.id} «${r.name}»: ${p}`);
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
    ...section('Broken nutrition per serving (must be 0)', nutrition),
    ...section('Merge candidates — same first word, review manually',
      mergeCandidates(canonical).map(g => g.map(n => `${n} (${usage.get(n)})`).join(' | '))),
    ...section('Units after normalization',
      [...units].sort((a, b) => b[1] - a[1]).map(([u, c]) => `${u}: ${c}`))
  ];
  return { lines, hardProblems: dirty.length + untyped.length + conflicts.length + nutrition.length };
}

if (require.main === module) {
  const { recipes } = require(path.resolve(__dirname, '../database/recipes.json'));
  const { lines, hardProblems } = buildReport(recipes);
  console.log(lines.join('\n'));
  if (hardProblems) process.exitCode = 1;
}

module.exports = { buildReport, mergeCandidates, nutritionProblem };
