const fs = require('fs');
const path = require('path');
const { db, dbGet: get, dbRun: run, withTransaction } = require('./db');
const { initDb } = require('./schema');
const {
  resolveRecipeIngredients,
  classifyIngredient,
  hasType,
  isDirtyName
} = require('./ingredient-normalizer');
const { computeRecipeNutrition, hasNutrition } = require('./nutrition-calculator');

async function upsertCategories(recipes) {
  const categories = [...new Set(recipes.map(r => r.category))];
  for (const cat of categories) {
    await run('INSERT OR IGNORE INTO meal_categories (name) VALUES (?)', [cat]);
  }
  return categories.length;
}

/**
 * Resolves every recipe's ingredients once (split, aliases, base units,
 * collisions) and validates the result: every unit converts, no
 * compound/alternative names, every canonical name has a shopping-list type.
 *
 * @param {Array<object>} recipes - recipes.json entries
 * @returns {{resolved: Map<string, Array<object>>, names: Set<string>,
 *            nutritionByRecipe: Map<string, ReturnType<typeof computeRecipeNutrition>>}}
 */
function resolveCatalog(recipes) {
  const resolved = new Map();
  const nutritionByRecipe = new Map();
  const names = new Set();
  for (const recipe of recipes) {
    const { rows, conflicts } = resolveRecipeIngredients(recipe.ingredients);
    if (conflicts.length) {
      throw new Error(`"${recipe.name}": add factors to unit-conversions.json — ${conflicts.join('; ')}`);
    }
    rows.forEach(r => names.add(r.name));
    resolved.set(recipe.name, rows);
  }
  const noNutrition = [...names].filter(n => !hasNutrition(n));
  if (noNutrition.length) {
    throw new Error(`Ingredients missing in ingredient-nutrition.json: ${noNutrition.join('; ')}`);
  }
  for (const recipe of recipes) {
    const nutrition = computeRecipeNutrition(recipe, resolved.get(recipe.name));
    if (nutrition.calories <= 0) throw new Error(`"${recipe.name}": computed calories = 0`);
    nutritionByRecipe.set(recipe.name, nutrition);
  }
  const dirty = [...names].filter(isDirtyName);
  if (dirty.length) {
    throw new Error(`Compound ingredient names left after normalization: ${dirty.join('; ')}`);
  }
  const untyped = [...names].filter(n => !hasType(n));
  if (untyped.length) {
    throw new Error(`Ingredients missing in ingredient-types.json: ${untyped.join('; ')}`);
  }
  return { resolved, names, nutritionByRecipe };
}

async function upsertIngredients(names) {
  for (const name of names) {
    // [RU] ON CONFLICT обновляет type для уже существующих строк — полезно при добавлении
    // новых записей в ingredient-types.json без db:reset.
    // [EN] ON CONFLICT updates type for existing rows — handy when ingredient-types.json
    // grows without a full db:reset.
    await run(
      `INSERT INTO ingredients (name, type) VALUES (?, ?)
       ON CONFLICT(name) DO UPDATE SET type = excluded.type`,
      [name, classifyIngredient(name)]
    );
  }
  return names.size;
}

/**
 * Inserts a recipe or refreshes servings/nutrition of an existing one, so a
 * plain re-run applies dictionary changes without db:reset.
 * @param {object} recipe - recipes.json entry
 * @param {{servings: number, calories: number, protein: number, fat: number, carbs: number}} n
 * @returns {Promise<{id: number, inserted: boolean}>}
 */
async function upsertRecipe(recipe, n) {
  const existing = await get('SELECT id FROM recipes WHERE name = ?', [recipe.name]);
  if (existing) {
    await run(
      `UPDATE recipes SET servings = ?, calories = ?, protein = ?, fat = ?, carbs = ?
       WHERE id = ?`,
      [n.servings, n.calories, n.protein, n.fat, n.carbs, existing.id]
    );
    return { id: existing.id, inserted: false };
  }

  const catRow = await get('SELECT id FROM meal_categories WHERE name = ?', [recipe.category]);
  if (!catRow) throw new Error(`Category not found for recipe "${recipe.name}": ${recipe.category}`);

  const result = await run(
    `INSERT INTO recipes (name, category_id, description, calories, protein, fat, carbs, servings)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [recipe.name, catRow.id, recipe.description || null, n.calories, n.protein, n.fat, n.carbs, n.servings]
  );
  return { id: result.lastID, inserted: true };
}

async function linkIngredients(recipeId, rows) {
  for (const row of rows) {
    const ingRow = await get('SELECT id FROM ingredients WHERE name = ?', [row.name]);
    if (!ingRow) throw new Error(`Ingredient not found: ${row.name}`);
    // [RU] UPSERT, а не OR IGNORE: повторный прогон дозаполняет amount_base/base_unit
    // в старой БД после ALTER TABLE.
    // [EN] UPSERT rather than OR IGNORE: a re-run backfills amount_base/base_unit
    // in an old DB after ALTER TABLE.
    await run(
      `INSERT INTO recipe_ingredients (recipe_id, ingredient_id, amount, unit, amount_base, base_unit)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(recipe_id, ingredient_id) DO UPDATE SET
         amount = excluded.amount, unit = excluded.unit,
         amount_base = excluded.amount_base, base_unit = excluded.base_unit`,
      [recipeId, ingRow.id, row.amount, row.unit, row.amountBase, row.baseUnit]
    );
  }
}

async function migrate() {
  console.log('Starting migration...');

  await initDb();

  const jsonPath = path.resolve(__dirname, '../../database/recipes.json');
  const { recipes } = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  console.log(`Loaded ${recipes.length} recipes from JSON.`);
  const { resolved, names, nutritionByRecipe } = resolveCatalog(recipes);

  await withTransaction(async () => {
    const catCount = await upsertCategories(recipes);
    console.log(`Processed ${catCount} categories.`);

    const ingCount = await upsertIngredients(names);
    console.log(`Processed ${ingCount} unique ingredients.`);

    let inserted = 0;
    let skipped = 0;
    for (let i = 0; i < recipes.length; i++) {
      const recipe = recipes[i];
      const { id, inserted: wasInserted } = await upsertRecipe(recipe, nutritionByRecipe.get(recipe.name));
      await linkIngredients(id, resolved.get(recipe.name));
      wasInserted ? inserted++ : skipped++;
      if ((i + 1) % 50 === 0) console.log(`Processed ${i + 1} recipes...`);
    }

    // [RU] Проверяем количество до COMMIT, чтобы при расхождении ROLLBACK откатил вставки.
    // [EN] Verify count before COMMIT so that a mismatch triggers ROLLBACK.
    const { c: dbCount } = await get('SELECT COUNT(*) AS c FROM recipes');
    if (dbCount < recipes.length) {
      throw new Error(`Recipe count mismatch: JSON=${recipes.length}, DB=${dbCount}`);
    }

    console.log(`Recipes: ${inserted} inserted, ${skipped} already existed.`);
    console.log(`Migration completed successfully! DB recipes: ${dbCount}.`);
  });
}

if (require.main === module) {
  migrate()
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exitCode = 1;
    })
    .finally(() => db.close());
}

module.exports = { migrate, resolveCatalog };
