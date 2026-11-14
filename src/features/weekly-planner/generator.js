const { dbGet, dbAll, dbRun, withTransaction } = require('../../database/db');
const { getCurrentWeekBounds, formatLocalDate } = require('../../utils/date-helpers');
const { getOrCreateUser } = require('./logic');
const { getUserIngredientPrefs } = require('../ingredient-prefs/logic');
const {
  EMPTY_PREFS, parseIdList, filterByPrefs, favoriteWeight, pickWeighted
} = require('../ingredient-prefs/scoring');

// [RU] Порядок обхода слотов в дне. main1 раньше main2 — тогда main2 исключает
// рецепт, уже взятый в main1, и два основных блюда дня всегда разные.
// [EN] Order in which a day is filled. main1 precedes main2 so main2 can
// exclude the recipe taken by main1 — two distinct mains per day.
const SLOT_PLAN = Object.freeze([
  { slot: 1, category: 'breakfast', targetKey: 'target_breakfast' },
  { slot: 2, category: 'main',      targetKey: 'target_main1' },
  { slot: 3, category: 'main',      targetKey: 'target_main2' },
  { slot: 4, category: 'salads',    targetKey: 'target_salad' },
  { slot: 5, category: 'desserts',  targetKey: 'target_dessert' }
]);

const CATEGORIES = ['breakfast', 'main', 'salads', 'desserts'];

// [RU] Сколько ближайших по ккал кандидатов участвуют в случайном выборе.
// 1 = строгий greedy (детерминированная, скучная неделя); больше — разнообразнее,
// но дальше от цели по калориям.
// [EN] How many kcal-closest candidates enter the random draw. 1 = strict
// greedy (deterministic, boring week); larger = more variety, less kcal accuracy.
const TOP_K = 4;

/** Generation modes: rewrite every slot, or only fill the empty ones. */
const GENERATION_MODES = Object.freeze({ OVERWRITE: 'overwrite', FILL_EMPTY: 'fill' });

/**
 * Error thrown when no recipe candidates remain after applying the user's
 * excluded products. Carries the internal category key so the UI layer
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
 * Loads all recipes for a category with their ingredient ids for the
 * preference filter (~30 rows per category — cheap to rank in JS).
 * @param {string} category - mc.name key (`breakfast|main|salads|desserts`)
 * @returns {Promise<Array<{id: number, calories: number, ingredientIds: number[]}>>}
 */
async function loadCandidatesByCategory(category) {
  const rows = await dbAll(
    `SELECT r.id, r.calories, GROUP_CONCAT(ri.ingredient_id) AS ingredient_ids
     FROM recipes r
     JOIN meal_categories mc ON r.category_id = mc.id
     LEFT JOIN recipe_ingredients ri ON ri.recipe_id = r.id
     WHERE LOWER(mc.name) = LOWER(?)
     GROUP BY r.id`,
    [category]
  );
  return rows.map(r => ({ id: r.id, calories: r.calories, ingredientIds: parseIdList(r.ingredient_ids) }));
}

/**
 * Picks a recipe for one slot.
 *
 * [RU] Кандидаты, уже использованные на этой неделе (`weekUsed`) или в этот
 * день (`dayTaken`), пропускаются. Когда пул категории исчерпан, недельный
 * счётчик сбрасывается — повторы начинаются только после того, как
 * перебраны все рецепты. С целью по ккал случайный выбор идёт из TOP_K
 * ближайших, без цели — из всего пула.
 * [EN] Recipes already used this week (`weekUsed`) or today (`dayTaken`) are
 * skipped. Once the category pool is exhausted the weekly set is reset, so
 * repeats only start after every recipe was used. With a kcal target the
 * random draw is among the TOP_K closest; without one — the whole pool.
 *
 * [RU] Любимые продукты (2.11) — мягкий бонус: вес рецепта делит расстояние
 * до цели при отборе TOP_K и повышает шанс в розыгрыше.
 * [EN] Favorite products (2.11) are a soft bonus: the recipe weight divides
 * its kcal distance when ranking TOP_K and raises its odds in the draw.
 *
 * @param {Array<{id: number, calories: number}>} candidates
 * @param {number|null} targetKcal
 * @param {Set<number>} weekUsed - mutated: cleared when the pool is exhausted
 * @param {Set<number>} dayTaken
 * @param {() => number} [random=Math.random]
 * @param {{excluded: Set<number>, favorite: Set<number>}} [prefs]
 * @returns {{id: number, calories: number}|null}
 */
function pickRecipe(candidates, targetKcal, weekUsed, dayTaken, random = Math.random, prefs = EMPTY_PREFS) {
  let pool = candidates.filter(c => !weekUsed.has(c.id) && !dayTaken.has(c.id));
  if (pool.length === 0) {
    weekUsed.clear();
    pool = candidates.filter(c => !dayTaken.has(c.id));
  }
  if (pool.length === 0) return null;
  const weightOf = (c) => favoriteWeight(c, prefs);
  const score = (c) => Math.abs(c.calories - targetKcal) / weightOf(c);
  const ranked = targetKcal
    ? [...pool].sort((a, b) => score(a) - score(b)).slice(0, TOP_K)
    : pool;
  return pickWeighted(ranked, weightOf, random);
}

/**
 * Loads candidates per category with excluded products filtered out.
 * @param {{excluded: Set<number>}} prefs
 * @returns {Promise<Record<string, Array>>}
 * @throws {EmptyCategoryError}
 */
async function loadFilteredCandidates(prefs) {
  const byCategory = {};
  for (const category of CATEGORIES) {
    byCategory[category] = filterByPrefs(await loadCandidatesByCategory(category), prefs);
    if (byCategory[category].length === 0) throw new EmptyCategoryError(category);
  }
  return byCategory;
}

/**
 * Returns planned items of the user's current ISO week.
 * @param {number} userId
 * @param {{start: string, endExclusive: string}} bounds
 * @returns {Promise<Array<{date: string, slot: number, recipe_id: number}>>}
 */
async function loadWeekItems(userId, { start, endExclusive }) {
  return dbAll(
    `SELECT dm.date, dmi.slot, dmi.recipe_id
     FROM daily_menu_items dmi
     JOIN daily_menu dm ON dmi.daily_menu_id = dm.id
     WHERE dm.user_id = ? AND dm.date >= ? AND dm.date < ?`,
    [userId, start, endExclusive]
  );
}

/**
 * Counts dishes already planned for the current ISO week — the UI asks
 * "overwrite or fill empty" when it is non-zero.
 * @param {number} telegramId
 * @returns {Promise<number>}
 */
async function countWeekItems(telegramId) {
  const userId = await getOrCreateUser(telegramId);
  return (await loadWeekItems(userId, getCurrentWeekBounds())).length;
}

/**
 * Ensures weekly_menu, 7 daily_menu rows and their week→day links exist.
 * @param {number} userId
 * @param {string} weekStart - YYYY-MM-DD (Monday)
 * @returns {Promise<Array<{date: string, dailyMenuId: number}>>}
 */
async function ensureWeekDays(userId, weekStart) {
  await dbRun('INSERT OR IGNORE INTO weekly_menu (user_id, week_start) VALUES (?, ?)', [userId, weekStart]);
  const week = await dbGet(
    'SELECT id FROM weekly_menu WHERE user_id = ? AND week_start = ?',
    [userId, weekStart]
  );
  if (!week) throw new Error('Failed to create/find weekly_menu');

  const [y, m, d] = weekStart.split('-').map(Number);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const date = formatLocalDate(new Date(y, m - 1, d + i));
    await dbRun('INSERT OR IGNORE INTO daily_menu (user_id, date) VALUES (?, ?)', [userId, date]);
    const menu = await dbGet('SELECT id FROM daily_menu WHERE user_id = ? AND date = ?', [userId, date]);
    if (!menu) throw new Error(`Failed to create/find daily_menu for ${date}`);
    // [RU] UNIQUE на (weekly_menu_id, date) в схеме нет — проверяем в коде.
    // [EN] No UNIQUE on (weekly_menu_id, date) in the schema — check in code.
    const link = await dbGet(
      'SELECT id FROM weekly_menu_days WHERE weekly_menu_id = ? AND date = ?',
      [week.id, date]
    );
    if (!link) {
      await dbRun(
        'INSERT INTO weekly_menu_days (weekly_menu_id, date, daily_menu_id) VALUES (?, ?, ?)',
        [week.id, date, menu.id]
      );
    }
    days.push({ date, dailyMenuId: menu.id });
  }
  return days;
}

/**
 * Builds generation state from the existing week: occupied slots and, in
 * fill mode, recipes that count as already used (so new picks don't repeat
 * the user's manual choices).
 * @param {Array<{date: string, slot: number, recipe_id: number}>} items
 * @param {string} mode
 * @returns {{occupied: Map<string, number>, weekUsed: Record<string, Set<number>>}}
 */
function buildInitialState(items, mode) {
  const weekUsed = Object.fromEntries(CATEGORIES.map(c => [c, new Set()]));
  const occupied = new Map();
  if (mode !== GENERATION_MODES.FILL_EMPTY) return { occupied, weekUsed };
  const slotCategory = Object.fromEntries(SLOT_PLAN.map(p => [p.slot, p.category]));
  for (const item of items) {
    occupied.set(`${item.date}_${item.slot}`, item.recipe_id);
    const category = slotCategory[item.slot];
    if (category) weekUsed[category].add(item.recipe_id);
  }
  return { occupied, weekUsed };
}

/**
 * Generates the plan for the current ISO week (Mon..Sun): for every slot
 * picks a random recipe among the TOP_K closest to the user's per-slot kcal
 * target, without repeating a recipe within the week until its category is
 * exhausted. Skips recipes with excluded products and favors recipes with
 * favorite ones (user_ingredient_prefs).
 *
 * Read-only preparation runs outside the write queue; all writes happen in
 * one transaction, so a failure leaves no partially generated week.
 *
 * @param {number} telegramId
 * @param {{mode?: 'overwrite'|'fill', random?: () => number}} [options]
 *   mode `overwrite` (default) rewrites all 35 slots, `fill` keeps existing
 *   dishes and fills only empty slots; `random` is injectable for tests.
 * @returns {Promise<{weekStart: string, daysFilled: string[], slotsWritten: number}>}
 */
async function generateWeeklyPlan(telegramId, options = {}) {
  const { mode = GENERATION_MODES.OVERWRITE, random = Math.random } = options;
  const userId = await getOrCreateUser(telegramId);
  const bounds = getCurrentWeekBounds();

  const targets = await dbGet(
    `SELECT target_breakfast, target_main1, target_main2, target_salad, target_dessert
     FROM user_preferences WHERE user_id = ?`,
    [userId]
  ) || {};
  const prefs = await getUserIngredientPrefs(userId);
  const candidates = await loadFilteredCandidates(prefs);

  return withTransaction(async () => {
    const days = await ensureWeekDays(userId, bounds.start);
    const { occupied, weekUsed } = buildInitialState(await loadWeekItems(userId, bounds), mode);
    let slotsWritten = 0;

    for (const { date, dailyMenuId } of days) {
      const dayTaken = new Set(
        SLOT_PLAN.map(p => occupied.get(`${date}_${p.slot}`)).filter(Boolean)
      );
      for (const { slot, category, targetKey } of SLOT_PLAN) {
        if (occupied.has(`${date}_${slot}`)) continue;
        const pick = pickRecipe(
          candidates[category], targets[targetKey] || null, weekUsed[category], dayTaken, random, prefs
        );
        if (!pick) continue;
        weekUsed[category].add(pick.id);
        dayTaken.add(pick.id);
        await dbRun(
          `INSERT INTO daily_menu_items (daily_menu_id, recipe_id, slot)
           VALUES (?, ?, ?)
           ON CONFLICT(daily_menu_id, slot) DO UPDATE SET recipe_id = excluded.recipe_id`,
          [dailyMenuId, pick.id, slot]
        );
        slotsWritten++;
      }
    }

    return { weekStart: bounds.start, daysFilled: days.map(d => d.date), slotsWritten };
  });
}

module.exports = {
  generateWeeklyPlan,
  countWeekItems,
  pickRecipe,
  EmptyCategoryError,
  GENERATION_MODES,
  TOP_K
};
