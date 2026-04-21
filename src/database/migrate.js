const fs = require('fs');
const path = require('path');
const { db, initDb } = require('./db');

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
const initDbAsync = () => new Promise((resolve) => {
  initDb();
  // initDb() ставит CREATE TABLE в serialize-очередь; следующий run сработает после.
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
  recipes.forEach(r => r.ingredients.forEach(i => names.add(i.item)));
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
    const ingRow = await get('SELECT id FROM ingredients WHERE name = ?', [ing.item]);
    if (!ingRow) throw new Error(`Ingredient not found: ${ing.item}`);
    const { amount, unit } = parseAmount(ing.amount);
    await run(
      `INSERT OR IGNORE INTO recipe_ingredients (recipe_id, ingredient_id, amount, unit)
       VALUES (?, ?, ?, ?)`,
      [recipeId, ingRow.id, amount, unit]
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

    await run('COMMIT');
    console.log(`Recipes: ${inserted} inserted, ${skipped} already existed.`);
  } catch (err) {
    await run('ROLLBACK').catch(() => {});
    throw err;
  }

  // [RU] Финальный assert: в БД должно быть минимум столько же рецептов, сколько в JSON.
  // [EN] Final assert: the DB must contain at least as many recipes as the JSON.
  const { c: dbCount } = await get('SELECT COUNT(*) AS c FROM recipes');
  if (dbCount < recipes.length) {
    throw new Error(`Recipe count mismatch: JSON=${recipes.length}, DB=${dbCount}`);
  }
  console.log(`Migration completed successfully! DB recipes: ${dbCount}.`);
}

migrate()
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.close());
