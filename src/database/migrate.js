const fs = require('fs');
const path = require('path');
const { db, initDb } = require('./db');

// [RU] Словари нормализации. Ключ — канонический вариант, значение — список алиасов.
// [EN] Normalization dictionaries. Keys are canonical forms; values are their aliases.
function loadAliasMap(filePath) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to load alias map from ${filePath}: ${err.message}`);
  }
  const map = new Map();
  for (const [canonical, aliases] of Object.entries(raw)) {
    if (canonical.startsWith('_') || !Array.isArray(aliases)) continue;
    for (const alias of aliases) map.set(alias, canonical);
  }
  return map;
}

const ALIAS_DIR = path.resolve(__dirname, '../../database');
const ingredientAliases = loadAliasMap(path.join(ALIAS_DIR, 'ingredient-aliases.json'));
const unitAliases = loadAliasMap(path.join(ALIAS_DIR, 'unit-aliases.json'));

function normalizeIngredient(name) {
  return ingredientAliases.get(name) || name;
}

function normalizeUnit(unit) {
  if (!unit) return unit;
  // [RU] Убираем уточнение веса в скобках: "шт (150 г)" → "шт".
  // [EN] Strip parenthetical weight hint: "шт (150 г)" → "шт".
  const clean = unit.replace(/\s*\(.*\)\s*$/, '').trim();
  return unitAliases.get(clean) || clean;
}

/**
 * Parses an ingredient amount string into a numeric amount + unit.
 *
 * Supports:
 *   "100 г"           → { amount: 100, unit: "г" }
 *   "3 шт"            → { amount: 3,   unit: "шт" }
 *   "1/2 ст."         → { amount: 0.5, unit: "ст." }
 *   "2-3 шт"          → { amount: 2,   unit: "шт" }   (lower bound)
 *   "250-300 г"       → { amount: 250, unit: "г" }
 *   "2-3 шт (200 г)"  → { amount: 2,   unit: "шт (200 г)" }
 *   "по вкусу"        → { amount: 0,   unit: "по вкусу" }
 *   ""                → { amount: 0,   unit: "не указано" }
 *
 * @param {string} amountStr
 * @returns {{amount: number, unit: string}}
 */
function parseAmount(amountStr) {
  if (!amountStr) return { amount: 0, unit: 'не указано' };

  // [RU] Диапазон: ведущее число, опционально "-/–/— второе число", затем единица.
  // [EN] Range: leading number, optional "- / – / — second number", then unit.
  const match = amountStr.match(
    /^([\d.,]+(?:\/[\d.,]+)?)(?:\s*[-–—]\s*[\d.,]+(?:\/[\d.,]+)?)?\s*(.*)$/
  );
  if (!match) return { amount: 0, unit: amountStr };

  const lead = match[1];
  let amount;
  if (lead.includes('/')) {
    const [num, den] = lead.split('/').map(s => parseFloat(s.replace(',', '.')));
    amount = den ? num / den : num;
  } else {
    amount = parseFloat(lead.replace(',', '.'));
  }

  const unit = match[2].trim() || 'шт';
  return { amount: isNaN(amount) ? 0 : amount, unit };
}

const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) {
    if (err) reject(err);
    else resolve(this);
  });
});
const get = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
});
// [RU] initDb() ставит CREATE TABLE в serialize-очередь sqlite3; очередь FIFO,
// поэтому `SELECT 1` с колбэком надёжно сигналит, что CREATE TABLE уже выполнены.
// Если initDb когда-нибудь станет действительно асинхронным — переделать здесь.
// [EN] initDb() queues CREATE TABLE into sqlite3's serialize FIFO; SELECT 1 with a
// callback reliably signals completion. Revisit if initDb ever becomes async proper.
const initDbAsync = () => new Promise((resolve) => {
  initDb();
  db.run('SELECT 1', () => resolve());
});

async function upsertCategories(recipes) {
  const categories = [...new Set(recipes.map(r => r.category))];
  for (const cat of categories) {
    await run('INSERT OR IGNORE INTO meal_categories (name) VALUES (?)', [cat]);
  }
  return categories.length;
}

async function upsertIngredients(recipes) {
  const names = new Set();
  recipes.forEach(r => r.ingredients.forEach(i => names.add(normalizeIngredient(i.item))));
  for (const name of names) {
    await run('INSERT OR IGNORE INTO ingredients (name, type) VALUES (?, ?)', [name, 'general']);
  }
  return names.size;
}

async function upsertRecipe(recipe) {
  const existing = await get('SELECT id FROM recipes WHERE name = ?', [recipe.name]);
  if (existing) return { id: existing.id, inserted: false };

  const catRow = await get('SELECT id FROM meal_categories WHERE name = ?', [recipe.category]);
  if (!catRow) throw new Error(`Category not found for recipe "${recipe.name}": ${recipe.category}`);

  const nutrition = recipe.nutrition_per_serving || recipe.nutrition || {};
  const result = await run(
    `INSERT INTO recipes (name, category_id, description, calories, protein, fat, carbs)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      recipe.name,
      catRow.id,
      recipe.description || null,
      nutrition.calories || 0,
      nutrition.proteins || nutrition.protein || 0,
      nutrition.fats || nutrition.fat || 0,
      nutrition.carbs || 0
    ]
  );
  return { id: result.lastID, inserted: true };
}

async function linkIngredients(recipeId, ingredients) {
  for (const ing of ingredients) {
    const canonicalName = normalizeIngredient(ing.item);
    const ingRow = await get('SELECT id FROM ingredients WHERE name = ?', [canonicalName]);
    if (!ingRow) throw new Error(`Ingredient not found: ${canonicalName}`);
    const { amount, unit } = parseAmount(ing.amount);
    await run(
      `INSERT OR IGNORE INTO recipe_ingredients (recipe_id, ingredient_id, amount, unit)
       VALUES (?, ?, ?, ?)`,
      [recipeId, ingRow.id, amount, normalizeUnit(unit)]
    );
  }
}

async function migrate() {
  console.log('Starting migration...');

  await initDbAsync();
  await run('PRAGMA foreign_keys = ON');

  const jsonPath = path.resolve(__dirname, '../../database/recipes.json');
  const { recipes } = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  console.log(`Loaded ${recipes.length} recipes from JSON.`);

  await run('BEGIN TRANSACTION');
  try {
    const catCount = await upsertCategories(recipes);
    console.log(`Processed ${catCount} categories.`);

    const ingCount = await upsertIngredients(recipes);
    console.log(`Processed ${ingCount} unique ingredients.`);

    let inserted = 0;
    let skipped = 0;
    for (let i = 0; i < recipes.length; i++) {
      const recipe = recipes[i];
      const { id, inserted: wasInserted } = await upsertRecipe(recipe);
      await linkIngredients(id, recipe.ingredients);
      wasInserted ? inserted++ : skipped++;
      if ((i + 1) % 50 === 0) console.log(`Processed ${i + 1} recipes...`);
    }

    // [RU] Проверяем количество до COMMIT, чтобы при расхождении ROLLBACK откатил вставки.
    // [EN] Verify count before COMMIT so that a mismatch triggers ROLLBACK via catch.
    const { c: dbCount } = await get('SELECT COUNT(*) AS c FROM recipes');
    if (dbCount < recipes.length) {
      throw new Error(`Recipe count mismatch: JSON=${recipes.length}, DB=${dbCount}`);
    }

    await run('COMMIT');
    console.log(`Recipes: ${inserted} inserted, ${skipped} already existed.`);
    console.log(`Migration completed successfully! DB recipes: ${dbCount}.`);
  } catch (err) {
    await run('ROLLBACK').catch(() => {});
    throw err;
  }
}

migrate()
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.close());
