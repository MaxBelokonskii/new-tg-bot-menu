const { dbGet, dbAll, dbRun, withTransaction } = require('../../database/db');
const logger = require('../../utils/logger');

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

async function _saveSelectedDishImpl(telegramId, recipeId, date) {
  const userId = await getOrCreateUser(telegramId);

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
    [userId, date]
  );
  const menuRow = await dbGet(
    'SELECT id FROM daily_menu WHERE user_id = ? AND date = ?',
    [userId, date]
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
 * Saves the selected dish into the user's plan for a date (the user's local
 * today — see features/time-zone/logic.js:getUserClock). Slot is derived
 * from the recipe's category (README contract: 1=breakfast, 2/3=main,
 * 4=salad, 5=dessert). Re-adding into an occupied slot replaces the
 * existing recipe for that slot. Runs in a transaction on the shared write
 * queue (see utils/db-helpers.js) to keep slot resolution consistent.
 *
 * @param {number} telegramId
 * @param {number} recipeId
 * @param {string} date - YYYY-MM-DD
 * @returns {Promise<{slot: number, status: 'added'|'replaced'|'unchanged'}>}
 */
async function saveSelectedDish(telegramId, recipeId, date) {
  return withTransaction(() => _saveSelectedDishImpl(telegramId, recipeId, date));
}

/**
 * Returns the user's planned dishes for an ISO week (Mon..Sun).
 * @param {number} telegramId
 * @param {{start: string, endExclusive: string}} week - from getWeekBounds
 * @returns {Promise<Array<{name: string, category: string, date: string, slot: number}>>}
 */
async function getWeeklyPlan(telegramId, { start, endExclusive }) {
  const userId = await getOrCreateUser(telegramId);
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
 * Replaces the recipe at (date, slot) with a new one. Runs in a transaction on
 * the shared write queue so it cannot race with a concurrent saveSelectedDish
 * that targets the same slot.
 *
 * @param {number} telegramId
 * @param {string} date - YYYY-MM-DD
 * @param {number} slot
 * @param {number} newRecipeId
 * @returns {Promise<boolean>}
 */
async function replaceInSlot(telegramId, date, slot, newRecipeId) {
  return withTransaction(() => _replaceInSlotImpl(telegramId, date, slot, newRecipeId));
}

module.exports = {
  getOrCreateUser,
  saveSelectedDish,
  getWeeklyPlan,
  clearDailyPlan,
  removeSlot,
  replaceInSlot,
  categoryForSlot,
  CATEGORY_TO_SLOTS,
  resolveSlot
};
