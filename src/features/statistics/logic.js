const { dbAll } = require('../../database/db');
const { getOrCreateUser } = require('../weekly-planner/logic');
const { getWeekPlanNutrition } = require('../weekly-planner/week-totals');
const { getUserProfile } = require('../profile/logic');
const { pickTargets } = require('../profile/targets');
const { addDays, isValidDate, weekdayOf, getWeekBounds } = require('../../utils/date-helpers');
const { scaleNutrition } = require('../../utils/nutrition-totals');
const { VARIETY_DAYS, buildWeekStats } = require('./summary');

// [RU] Глубина истории статистики: текущая неделя и до 12 недель назад.
// [EN] Stats history depth: the current week and up to 12 weeks back.
const STATS_WEEKS_BACK = 12;

/**
 * Mondays of the stats range: the user's current ISO week and the oldest
 * week that can still be opened.
 * @param {string} today - YYYY-MM-DD, the user's local today
 * @returns {{current: string, oldest: string}}
 */
function statsWeekRange(today) {
  const current = getWeekBounds(today).start;
  return { current, oldest: addDays(current, -7 * STATS_WEEKS_BACK) };
}

/**
 * True when `monday` is a Monday within the stats range (from callback_data).
 * @param {string} monday
 * @param {string} today - YYYY-MM-DD, the user's local today
 * @returns {boolean}
 */
function isStatsMonday(monday, today) {
  if (!isValidDate(monday) || weekdayOf(monday) !== 0) return false;
  const { current, oldest } = statsWeekRange(today);
  return monday >= oldest && monday <= current;
}

/**
 * Neighbouring weeks for ◀️/▶️, or null at the range edges.
 * @param {string} monday - a valid stats Monday
 * @param {string} today - YYYY-MM-DD
 * @returns {{prev: string|null, next: string|null}}
 */
function statsNav(monday, today) {
  const { current, oldest } = statsWeekRange(today);
  return {
    prev: monday > oldest ? addDays(monday, -7) : null,
    next: monday < current ? addDays(monday, 7) : null
  };
}

/**
 * Loads the user's diary rows in [from, toExclusive) with nutrition scaled
 * by portion.
 * @param {number} userId - internal users.id
 * @param {string} from - YYYY-MM-DD
 * @param {string} toExclusive - YYYY-MM-DD
 * @returns {Promise<Array<{date: string, recipeId: number, name: string, portion: number,
 *   calories: number, protein: number, fat: number, carbs: number}>>}
 */
async function getLogRows(userId, from, toExclusive) {
  const rows = await dbAll(
    `SELECT fl.date, fl.recipe_id, fl.portion, r.name, r.calories, r.protein, r.fat, r.carbs
     FROM food_log fl
     JOIN recipes r ON r.id = fl.recipe_id
     WHERE fl.user_id = ? AND fl.date >= ? AND fl.date < ?
     ORDER BY fl.date, fl.id`,
    [userId, from, toExclusive]
  );
  return rows.map(row => ({
    date: row.date,
    recipeId: row.recipe_id,
    name: row.name,
    portion: row.portion,
    ...scaleNutrition(row, row.portion)
  }));
}

/**
 * Loads everything the stats screen needs for one ISO week and aggregates
 * it: the week's diary, the week's plan, the last VARIETY_DAYS days of the
 * diary (ending today) and the user's daily targets.
 * @param {number} telegramId
 * @param {string} monday - YYYY-MM-DD, a Monday checked by isStatsMonday
 * @param {string} today - YYYY-MM-DD, the user's local today
 * @returns {Promise<ReturnType<typeof buildWeekStats>>}
 */
async function getWeekStats(telegramId, monday, today) {
  const userId = await getOrCreateUser(telegramId);
  const week = getWeekBounds(monday);
  const eaten = await getLogRows(userId, week.start, week.endExclusive);
  const recent = await getLogRows(userId, addDays(today, 1 - VARIETY_DAYS), addDays(today, 1));
  const planned = await getWeekPlanNutrition(telegramId, week);
  const profile = await getUserProfile(telegramId);
  return buildWeekStats({
    monday, today, eaten, planned, recent, targets: profile ? pickTargets(profile) : null
  });
}

module.exports = { STATS_WEEKS_BACK, statsWeekRange, isStatsMonday, statsNav, getWeekStats };
