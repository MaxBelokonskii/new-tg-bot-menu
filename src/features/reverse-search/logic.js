const fs = require('fs');
const path = require('path');
const { db } = require('../../database/db');

const MAX_MISSING = 3;
const RESULT_LIMIT = 10;

// [RU] Единый словарь «что ввёл пользователь → канонический ингредиент».
// Ключи в нижнем регистре; в карту попадают и канонические имена из
// ingredient-types.json (170 записей), и все алиасы из ingredient-aliases.json.
// Собираем один раз на module-load: данные в JSON не меняются в рантайме.
// [EN] One shared "user-typed → canonical" dictionary. Keys lowercased; the
// map includes both canonical names from ingredient-types.json (170 entries)
// and every alias from ingredient-aliases.json. Built once at module load
// since the JSON files don't change at runtime.
const INVENTORY_LOOKUP = (() => {
  const map = new Map();
  const dataDir = path.resolve(__dirname, '../../../database');

  const typesRaw = JSON.parse(fs.readFileSync(path.join(dataDir, 'ingredient-types.json'), 'utf8'));
  for (const name of Object.keys(typesRaw)) {
    if (name.startsWith('_')) continue;
    map.set(name.toLowerCase(), name);
  }

  const aliasesRaw = JSON.parse(fs.readFileSync(path.join(dataDir, 'ingredient-aliases.json'), 'utf8'));
  for (const [canonical, aliases] of Object.entries(aliasesRaw)) {
    if (canonical.startsWith('_') || !Array.isArray(aliases)) continue;
    for (const alias of aliases) {
      map.set(alias.toLowerCase(), canonical);
    }
  }
  return map;
})();

// [RU] Соответствие категории рецепта → поле user_preferences для оценки
// близости к целевой калорийности. Для main используем среднее main1/main2
// при сортировке (оба таргета обычно близки).
// [EN] Recipe category → user_preferences target field used to rank by
// calorie proximity. For "main" we average main1 and main2 when ranking
// (both targets are usually close).
const CATEGORY_TARGET_KEYS = {
  breakfast: ['target_breakfast'],
  main: ['target_main1', 'target_main2'],
  salads: ['target_salad'],
  desserts: ['target_dessert']
};

const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
});
const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
});

/**
 * Parses a comma-separated list of ingredient names typed by the user
 * and normalizes every token to its canonical DB name via aliases+types
 * lookup. Tokens that can't be resolved are returned separately so the UI
 * can warn the user.
 *
 * @param {string} text - raw user input, e.g. "огурец, помидор, лук"
 * @returns {{canonical: string[], unknown: string[]}} ordered, deduped
 */
function parseInventory(text) {
  if (!text) return { canonical: [], unknown: [] };
  const tokens = String(text)
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);

  const canonicalSet = new Set();
  const canonical = [];
  const unknown = [];

  for (const token of tokens) {
    const hit = INVENTORY_LOOKUP.get(token.toLowerCase());
    if (hit) {
      if (!canonicalSet.has(hit)) {
        canonicalSet.add(hit);
        canonical.push(hit);
      }
    } else {
      unknown.push(token);
    }
  }
  return { canonical, unknown };
}

/**
 * Returns the user_preferences row for a Telegram user, or null if the
 * profile survey was never completed (used only for ranking — the feature
 * still works without a profile, just with less relevant ordering).
 *
 * @param {number} telegramId
 * @returns {Promise<object|null>}
 */
async function getUserTargets(telegramId) {
  const row = await dbGet(
    `SELECT up.target_breakfast, up.target_main1, up.target_main2,
            up.target_salad, up.target_dessert
     FROM user_preferences up
     JOIN users u ON u.id = up.user_id
     WHERE u.telegram_id = ?`,
    [telegramId]
  );
  if (!row) return null;
  // [RU] Если пользователь не прошёл анкету — target_* = NULL, сортировка
  // пойдёт по missing_count + alpha.
  // [EN] If the survey wasn't filled, target_* are NULL → sort falls back
  // to missing_count + alpha.
  const hasAnyTarget = Object.values(row).some(v => v !== null && v !== undefined);
  return hasAnyTarget ? row : null;
}

function _targetForCategory(targets, categoryName) {
  if (!targets) return null;
  const keys = CATEGORY_TARGET_KEYS[categoryName];
  if (!keys) return null;
  const values = keys.map(k => targets[k]).filter(v => typeof v === 'number');
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Ranks recipes by (1) number of missing ingredients ascending, (2) distance
 * from the user's per-slot calorie target ascending when available, (3)
 * alphabetical. Returns up to {@link RESULT_LIMIT} entries.
 *
 * A recipe is included only if it lacks at most {@link MAX_MISSING}
 * ingredients from the user's inventory.
 *
 * @param {string[]} canonicalInventory - canonical DB ingredient names
 * @param {object|null} userTargets - row from user_preferences or null
 * @returns {Promise<Array<{id: number, name: string, calories: number,
 *   category: string, missing: string[], missingCount: number}>>}
 */
async function findRecipesByInventory(canonicalInventory, userTargets) {
  const inventorySet = new Set(canonicalInventory);
  const rows = await dbAll(
    `SELECT r.id, r.name, r.calories, mc.name AS category,
            COALESCE(GROUP_CONCAT(i.name, '|'), '') AS ingredients
     FROM recipes r
     JOIN meal_categories mc ON r.category_id = mc.id
     LEFT JOIN recipe_ingredients ri ON ri.recipe_id = r.id
     LEFT JOIN ingredients i ON ri.ingredient_id = i.id
     GROUP BY r.id`,
    []
  );

  const matches = [];
  for (const row of rows) {
    // [RU] COALESCE(GROUP_CONCAT,'') для рецепта без связей выдаёт '', и
    // ''.split('|') вернул бы [''] — ложный «недостающий» ингредиент. Отсекаем.
    // [EN] COALESCE(GROUP_CONCAT,'') for a recipe with no links yields '',
    // and ''.split('|') would return [''] — a phantom "missing" entry. Drop it.
    const ingNames = row.ingredients ? row.ingredients.split('|').filter(Boolean) : [];
    if (ingNames.length === 0) continue;
    const missing = ingNames.filter(name => !inventorySet.has(name));
    if (missing.length > MAX_MISSING) continue;
    matches.push({
      id: row.id,
      name: row.name,
      calories: row.calories,
      category: row.category,
      missing,
      missingCount: missing.length
    });
  }

  matches.sort((a, b) => {
    if (a.missingCount !== b.missingCount) return a.missingCount - b.missingCount;
    const ta = _targetForCategory(userTargets, a.category);
    const tb = _targetForCategory(userTargets, b.category);
    if (ta != null && tb != null) {
      const da = Math.abs((a.calories || 0) - ta);
      const dbDist = Math.abs((b.calories || 0) - tb);
      if (da !== dbDist) return da - dbDist;
    }
    return a.name.localeCompare(b.name, 'ru');
  });

  return matches.slice(0, RESULT_LIMIT);
}

/**
 * Loads a recipe row by its primary key. Used by the detail-card handler
 * after the user picks a number from the results list.
 *
 * @param {number} recipeId
 * @returns {Promise<object|undefined>}
 */
async function getRecipeById(recipeId) {
  return dbGet(
    `SELECT r.id, r.name, r.description, r.calories, r.protein, r.fat, r.carbs,
            mc.name AS category
     FROM recipes r
     JOIN meal_categories mc ON r.category_id = mc.id
     WHERE r.id = ?`,
    [recipeId]
  );
}

module.exports = {
  parseInventory,
  findRecipesByInventory,
  getUserTargets,
  getRecipeById,
  MAX_MISSING,
  RESULT_LIMIT
};
