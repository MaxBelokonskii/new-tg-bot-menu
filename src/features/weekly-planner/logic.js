const { db } = require('../../database/db');
const logger = require('../../utils/logger');
const { getCurrentWeekBounds, formatLocalDate } = require('../../utils/date-helpers');

// [RU] README-контракт: слот определяется категорией блюда, а не порядком добавления.
// [EN] README contract: slot is determined by the dish category, not insertion order.
const CATEGORY_TO_SLOTS = {
  breakfast: [1],
  main: [2, 3],
  salads: [4],
  desserts: [5]
};

const SLOT_TO_CATEGORY = (() => {
  const map = {};
  for (const [category, slots] of Object.entries(CATEGORY_TO_SLOTS)) {
    slots.forEach(s => { map[s] = category; });
  }
  return map;
})();

/**
 * Returns the category name (breakfast/main/salads/desserts) for a given slot.
 * @param {number} slot
 * @returns {string}
 */
function categoryForSlot(slot) {
  const category = SLOT_TO_CATEGORY[slot];
  if (!category) throw new Error(`Unknown slot: ${slot}`);
  return category;
}

const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
});
const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
});
const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) {
    if (err) reject(err);
    else resolve(this);
  });
});

/**
 * Returns the internal user id for a Telegram user, creating the row if missing.
 * @param {number} telegramId
 * @param {string} [username]
 * @returns {Promise<number>}
 */
async function getOrCreateUser(telegramId, username) {
  const row = await dbGet('SELECT id FROM users WHERE telegram_id = ?', [telegramId]);
  if (row) return row.id;
  const result = await dbRun(
    'INSERT INTO users (telegram_id, username) VALUES (?, ?)',
    [telegramId, username]
  );
  return result.lastID;
}

// [RU] Порядок слотов, в котором greedy-подбор обходит день. Важно, чтобы
// main1 шёл раньше main2 — тогда main2 может исключить рецепт, уже взятый
// в main1, и мы гарантируем два разных основных блюда на день.
// [EN] Order in which greedy fills a day. main1 must precede main2 so that
// main2 can exclude the recipe already taken by main1, guaranteeing two
// distinct mains per day.
const SLOT_PLAN = Object.freeze([
  { slot: 1, category: 'breakfast', targetKey: 'target_breakfast' },
  { slot: 2, category: 'main',      targetKey: 'target_main1' },
  { slot: 3, category: 'main',      targetKey: 'target_main2' },
  { slot: 4, category: 'salads',    targetKey: 'target_salad' },
  { slot: 5, category: 'desserts',  targetKey: 'target_dessert' }
]);

/**
 * Loads all recipes for a category, joined with a pipe-separated list of
 * ingredient names for the exclusion filter. The set of candidate recipes
 * fits easily in memory (~30 per category) so greedy picking in JS is
 * cheaper than a complex SQL with correlated subqueries.
 *
 * Note: SQLite's built-in `LOWER()` is ASCII-only — it doesn't lowercase
 * Cyrillic. Callers must lowercase in JS (`.toLowerCase()`) where case
 * folding matters. We keep the raw names here and do the comparison in
 * `isExcluded`, which also tokenizes the exclude input.
 *
 * @param {string} category - mc.name key (`breakfast|main|salads|desserts`)
 * @returns {Promise<Array<{id: number, calories: number, ingredients: string}>>}
 */
async function loadCandidatesByCategory(category) {
  return dbAll(
    `SELECT r.id, r.calories,
            COALESCE(GROUP_CONCAT(i.name, '|'), '') AS ingredients
     FROM recipes r
     JOIN meal_categories mc ON r.category_id = mc.id
     LEFT JOIN recipe_ingredients ri ON ri.recipe_id = r.id
     LEFT JOIN ingredients i ON ri.ingredient_id = i.id
     WHERE LOWER(mc.name) = LOWER(?)
     GROUP BY r.id`,
    [category]
  );
}

/**
 * Parses the free-form exclude_ingredients string into a lower-cased token set.
 * @param {string|null} raw
 * @returns {Set<string>}
 */
function parseExcludeIngredients(raw) {
  if (!raw) return new Set();
  return new Set(
    raw.split(/[,;\n]/)
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

/**
 * True if any of the recipe's ingredient names contains any token from the
 * exclusion set. Substring match is applied per-ingredient (after splitting
 * the GROUP_CONCAT result by '|'), so "рис" matches "рис бурый" but not the
 * unrelated "карбонарис" inside a neighbouring ingredient string.
 *
 * @param {{ingredients: string}} candidate
 * @param {Set<string>} excludeSet
 */
function isExcluded(candidate, excludeSet) {
  if (excludeSet.size === 0) return false;
  if (!candidate.ingredients) return false;
  // [RU] toLowerCase в JS — единственный корректный способ свернуть кириллицу.
  // SQLite's LOWER() не умеет не-ASCII, поэтому SQL отдаёт исходный регистр.
  // [EN] JS toLowerCase is the only correct way to fold Cyrillic. SQLite's
  // LOWER() is ASCII-only, so we receive names in their original casing.
  const names = candidate.ingredients.toLowerCase().split('|');
  for (const token of excludeSet) {
    for (const name of names) {
      if (name.includes(token)) return true;
    }
  }
  return false;
}

// [RU] ⚠️ TODO (после MVP): greedy по близости ккал — «тупой» baseline.
// Когда накопим жалобы на скучные планы — заменить на knapsack/ILP или
// ranking с учётом разнообразия, сезонности и ранее выбранных блюд.
// [EN] ⚠️ TODO (post-MVP): greedy-by-kcal is a naive baseline. Replace with
// knapsack/ILP or ranking that accounts for variety, seasonality and user
// history once we have complaints about boring plans.
function pickRecipe(candidates, targetKcal, usedIds) {
  const pool = candidates.filter(c => !usedIds.has(c.id));
  if (pool.length === 0) return null;
  if (!targetKcal) {
    // [RU] Без цели — просто случайный, чтобы план не был детерминированным.
    // [EN] No target — pick at random so plans aren't deterministic.
    return pool[Math.floor(Math.random() * pool.length)];
  }
  let best = pool[0];
  let bestDelta = Math.abs(best.calories - targetKcal);
  for (let i = 1; i < pool.length; i++) {
    const delta = Math.abs(pool[i].calories - targetKcal);
    if (delta < bestDelta) {
      best = pool[i];
      bestDelta = delta;
    }
  }
  return best;
}

/**
 * Error thrown when no recipe candidates remain after applying
 * `exclude_ingredients`. Carries the internal category key so the UI layer
 * can map it to a localized label without parsing the message string.
 */
class EmptyCategoryError extends Error {
  constructor(category) {
    super(`No recipes available for category "${category}" after exclusions`);
    this.name = 'EmptyCategoryError';
    this.category = category;
  }
}

/**
 * Generates a weekly plan for the current ISO week (Mon..Sun) using a greedy
 * kcal-proximity picker. Respects user_preferences.exclude_ingredients and
 * per-slot target calories. Safe to call repeatedly — UPSERTs by (daily_menu_id, slot).
 *
 * Read-heavy preparation (user_preferences fetch, candidate loading, exclusion
 * filter) runs outside the write mutex — it doesn't mutate anything and must
 * not block other users' saveSelectedDish. Only the 7-day write loop is
 * serialized, which is the part that actually races with saveSelectedDish /
 * replaceInSlot on the same tables.
 *
 * @param {number} telegramId
 * @returns {Promise<{weekStart: string, daysFilled: string[]}>}
 */
async function generateWeeklyPlan(telegramId) {
  const userId = await getOrCreateUser(telegramId);
  const { start: weekStart } = getCurrentWeekBounds();

  const prefs = await dbGet(
    `SELECT exclude_ingredients, target_breakfast, target_main1,
            target_main2, target_salad, target_dessert
     FROM user_preferences WHERE user_id = ?`,
    [userId]
  ) || {};
  const excludeSet = parseExcludeIngredients(prefs.exclude_ingredients);

  // [RU] Кандидаты грузим по одному разу на категорию и переиспользуем на
  // все 7 дней. Для main фильтр исключений одинаков — отдельный список не нужен.
  // [EN] Load candidates once per category and reuse across 7 days. Mains
  // share the exclusion filter — no per-slot split needed.
  const categories = ['breakfast', 'main', 'salads', 'desserts'];
  const candidatesByCategory = {};
  for (const cat of categories) {
    const rows = await loadCandidatesByCategory(cat);
    candidatesByCategory[cat] = rows.filter(c => !isExcluded(c, excludeSet));
    if (candidatesByCategory[cat].length === 0) {
      throw new EmptyCategoryError(cat);
    }
  }

  return serializeWrite(async () => {
    await dbRun(
      'INSERT OR IGNORE INTO weekly_menu (user_id, week_start) VALUES (?, ?)',
      [userId, weekStart]
    );
    const weeklyMenuRow = await dbGet(
      'SELECT id FROM weekly_menu WHERE user_id = ? AND week_start = ?',
      [userId, weekStart]
    );
    if (!weeklyMenuRow) throw new Error('Failed to create/find weekly_menu');
    const weeklyMenuId = weeklyMenuRow.id;

    const [y, m, d] = weekStart.split('-').map(Number);
    const monday = new Date(y, m - 1, d);
    const daysFilled = [];

    for (let i = 0; i < 7; i++) {
      const dayDate = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
      const date = formatLocalDate(dayDate);

      await dbRun('INSERT OR IGNORE INTO daily_menu (user_id, date) VALUES (?, ?)', [userId, date]);
      const menuRow = await dbGet(
        'SELECT id FROM daily_menu WHERE user_id = ? AND date = ?',
        [userId, date]
      );
      if (!menuRow) throw new Error(`Failed to create/find daily_menu for ${date}`);
      const dailyMenuId = menuRow.id;

      // [RU] weekly_menu_days — справочная связь «неделя → день». Идемпотентно
      // проверяем пару (weekly_menu_id, date), чтобы повторная генерация той же
      // недели не плодила дубликаты (UNIQUE-констрейнта на схеме нет).
      // [EN] weekly_menu_days is the week-to-day link. Check uniqueness in code
      // because the schema has no UNIQUE on (weekly_menu_id, date).
      const existingLink = await dbGet(
        'SELECT id FROM weekly_menu_days WHERE weekly_menu_id = ? AND date = ?',
        [weeklyMenuId, date]
      );
      if (!existingLink) {
        await dbRun(
          'INSERT INTO weekly_menu_days (weekly_menu_id, date, daily_menu_id) VALUES (?, ?, ?)',
          [weeklyMenuId, date, dailyMenuId]
        );
      }

      const usedMainIds = new Set();
      for (const { slot, category, targetKey } of SLOT_PLAN) {
        const target = prefs[targetKey] || null;
        const used = category === 'main' ? usedMainIds : new Set();
        const candidate = pickRecipe(candidatesByCategory[category], target, used);
        if (!candidate) continue;
        if (category === 'main') usedMainIds.add(candidate.id);

        await dbRun(
          `INSERT INTO daily_menu_items (daily_menu_id, recipe_id, slot)
           VALUES (?, ?, ?)
           ON CONFLICT(daily_menu_id, slot) DO UPDATE SET recipe_id = excluded.recipe_id`,
          [dailyMenuId, candidate.id, slot]
        );
      }
      daysFilled.push(date);
    }

    return { weekStart, daysFilled };
  });
}

/**
 * Picks the slot for a recipe being added to the given daily_menu.
 * Single-slot categories always return their fixed slot (existing recipe, if
 * any, will be replaced by the caller's UPSERT). `main` has two slots — if
 * both are free, returns the first free one; if both are taken, returns the
 * first slot (last-write-wins replacement).
 *
 * @param {number} dailyMenuId
 * @param {string} category - lowercased mc.name (breakfast|main|salads|desserts)
 * @returns {Promise<number>}
 */
async function resolveSlot(dailyMenuId, category) {
  const slots = CATEGORY_TO_SLOTS[category];
  if (!slots) throw new Error(`Unknown recipe category: ${category}`);
  if (slots.length === 1) return slots[0];

  const placeholders = slots.map(() => '?').join(',');
  const rows = await dbAll(
    `SELECT slot FROM daily_menu_items
     WHERE daily_menu_id = ? AND slot IN (${placeholders})`,
    [dailyMenuId, ...slots]
  );
  const taken = new Set(rows.map(r => r.slot));
  return slots.find(s => !taken.has(s)) ?? slots[0];
}

// [RU] JS-мьютекс: node-sqlite3 использует одно соединение и не поддерживает
// вложенные BEGIN. Конкурентные записи в daily_menu_items (двойной тап,
// одновременные confirm_dish и replace) без мьютекса могут увидеть слот
// «свободным» между read и write. Промис-цепочка сериализует любые
// write-операции к daily_menu_items на уровне процесса.
// [EN] JS mutex: node-sqlite3 shares a single connection and does not support
// nested BEGIN. Concurrent writes to daily_menu_items (double tap, parallel
// confirm_dish and replace) could otherwise observe a stale "free" slot
// between read and write. A promise chain serializes every write-op against
// daily_menu_items at the process level.
let saveQueue = Promise.resolve();

function serializeWrite(fn) {
  const prev = saveQueue;
  let release;
  saveQueue = new Promise(resolve => { release = resolve; });
  return (async () => {
    try {
      await prev;
      return await fn();
    } finally {
      release();
    }
  })();
}

async function _saveSelectedDishImpl(telegramId, recipeId) {
  const userId = await getOrCreateUser(telegramId);
  // [RU] Локальная дата, а не UTC: иначе рядом с полуночью «сегодня» уезжает
  // в следующие сутки и не попадает в окно текущей недели из getWeeklyPlan.
  // [EN] Local date, not UTC: near midnight a UTC date can land in tomorrow
  // and slip out of the current-week window produced by getCurrentWeekBounds.
  const today = formatLocalDate(new Date());

  const recipe = await dbGet(
    `SELECT LOWER(mc.name) AS category
     FROM recipes r
     JOIN meal_categories mc ON r.category_id = mc.id
     WHERE r.id = ?`,
    [recipeId]
  );
  if (!recipe) throw new Error(`Recipe not found: ${recipeId}`);

  await dbRun(
    'INSERT OR IGNORE INTO daily_menu (user_id, date) VALUES (?, ?)',
    [userId, today]
  );
  const menuRow = await dbGet(
    'SELECT id FROM daily_menu WHERE user_id = ? AND date = ?',
    [userId, today]
  );
  if (!menuRow) throw new Error('Failed to create/find daily menu');
  const dailyMenuId = menuRow.id;

  const slot = await resolveSlot(dailyMenuId, recipe.category);
  const existing = await dbGet(
    'SELECT recipe_id FROM daily_menu_items WHERE daily_menu_id = ? AND slot = ?',
    [dailyMenuId, slot]
  );

  // [RU] UPSERT по UNIQUE(daily_menu_id, slot) — перезапись при повторе в тот же слот.
  // [EN] UPSERT on UNIQUE(daily_menu_id, slot) — overwrite when the same slot is reused.
  await dbRun(
    `INSERT INTO daily_menu_items (daily_menu_id, recipe_id, slot)
     VALUES (?, ?, ?)
     ON CONFLICT(daily_menu_id, slot) DO UPDATE SET recipe_id = excluded.recipe_id`,
    [dailyMenuId, recipeId, slot]
  );

  let status;
  if (!existing) status = 'added';
  else if (existing.recipe_id === recipeId) status = 'unchanged';
  else status = 'replaced';
  return { slot, status };
}

/**
 * Saves the selected dish into the user's plan for today. Slot is derived
 * from the recipe's category (README contract: 1=breakfast, 2/3=main,
 * 4=salad, 5=dessert). Re-adding into an occupied slot replaces the
 * existing recipe for that slot. Concurrent calls are serialized through
 * a module-level mutex to keep slot resolution consistent.
 *
 * @param {number} telegramId
 * @param {number} recipeId
 * @returns {Promise<{slot: number, status: 'added'|'replaced'|'unchanged'}>}
 */
async function saveSelectedDish(telegramId, recipeId) {
  return serializeWrite(() => _saveSelectedDishImpl(telegramId, recipeId));
}

/**
 * Returns the user's planned dishes for the current ISO week (Mon..Sun).
 * @param {number} telegramId
 * @returns {Promise<Array<{name: string, category: string, date: string, slot: number}>>}
 */
async function getWeeklyPlan(telegramId) {
  const userId = await getOrCreateUser(telegramId);
  const { start, endExclusive } = getCurrentWeekBounds();
  try {
    return await dbAll(
      `SELECT r.name, mc.name AS category, dm.date, dmi.slot
       FROM daily_menu_items dmi
       JOIN daily_menu dm ON dmi.daily_menu_id = dm.id
       JOIN recipes r ON dmi.recipe_id = r.id
       JOIN meal_categories mc ON r.category_id = mc.id
       WHERE dm.user_id = ?
         AND dm.date >= ?
         AND dm.date < ?
       ORDER BY dm.date ASC, dmi.slot ASC`,
      [userId, start, endExclusive]
    );
  } catch (err) {
    logger.error('Error fetching weekly plan:', err);
    throw err;
  }
}

/**
 * Clears a specific day in the user's plan.
 * @param {number} telegramId
 * @param {string} date - YYYY-MM-DD
 * @returns {Promise<true>}
 */
async function clearDailyPlan(telegramId, date) {
  const userId = await getOrCreateUser(telegramId);
  await dbRun(
    `DELETE FROM daily_menu_items
     WHERE daily_menu_id IN (SELECT id FROM daily_menu WHERE user_id = ? AND date = ?)`,
    [userId, date]
  );
  return true;
}

/**
 * Removes a single dish from a specific (date, slot) pair.
 * @param {number} telegramId
 * @param {string} date - YYYY-MM-DD
 * @param {number} slot
 * @returns {Promise<boolean>} true if a row was removed
 */
async function removeSlot(telegramId, date, slot) {
  const userId = await getOrCreateUser(telegramId);
  const result = await dbRun(
    `DELETE FROM daily_menu_items
     WHERE slot = ?
       AND daily_menu_id IN (SELECT id FROM daily_menu WHERE user_id = ? AND date = ?)`,
    [slot, userId, date]
  );
  return result.changes > 0;
}

async function _replaceInSlotImpl(telegramId, date, slot, newRecipeId) {
  const userId = await getOrCreateUser(telegramId);

  const recipe = await dbGet(
    `SELECT LOWER(mc.name) AS category
     FROM recipes r
     JOIN meal_categories mc ON r.category_id = mc.id
     WHERE r.id = ?`,
    [newRecipeId]
  );
  if (!recipe) throw new Error(`Recipe not found: ${newRecipeId}`);

  // [RU] Защита от рассинхрона слота и категории: нельзя положить салат
  // в слот завтрака, даже если callback_data был подделан.
  // [EN] Guard against slot/category mismatch: a salad cannot be placed
  // into a breakfast slot even if callback_data was tampered with.
  const allowedSlots = CATEGORY_TO_SLOTS[recipe.category];
  if (!allowedSlots || !allowedSlots.includes(slot)) {
    throw new Error(`Recipe category "${recipe.category}" is not allowed in slot ${slot}`);
  }

  await dbRun(
    'INSERT OR IGNORE INTO daily_menu (user_id, date) VALUES (?, ?)',
    [userId, date]
  );
  const menuRow = await dbGet(
    'SELECT id FROM daily_menu WHERE user_id = ? AND date = ?',
    [userId, date]
  );
  if (!menuRow) throw new Error('Failed to create/find daily menu');

  await dbRun(
    `INSERT INTO daily_menu_items (daily_menu_id, recipe_id, slot)
     VALUES (?, ?, ?)
     ON CONFLICT(daily_menu_id, slot) DO UPDATE SET recipe_id = excluded.recipe_id`,
    [menuRow.id, newRecipeId, slot]
  );
  return true;
}

/**
 * Replaces the recipe at (date, slot) with a new one. Serialized through the
 * shared write mutex so it cannot race with a concurrent saveSelectedDish
 * that targets the same slot.
 *
 * @param {number} telegramId
 * @param {string} date - YYYY-MM-DD
 * @param {number} slot
 * @param {number} newRecipeId
 * @returns {Promise<boolean>}
 */
async function replaceInSlot(telegramId, date, slot, newRecipeId) {
  return serializeWrite(() => _replaceInSlotImpl(telegramId, date, slot, newRecipeId));
}

module.exports = {
  getOrCreateUser,
  generateWeeklyPlan,
  EmptyCategoryError,
  saveSelectedDish,
  getWeeklyPlan,
  clearDailyPlan,
  removeSlot,
  replaceInSlot,
  categoryForSlot,
  // [EN] Exported for Stage 2.1 (generateWeeklyPlan) to reuse slot logic.
  CATEGORY_TO_SLOTS,
  resolveSlot
};
