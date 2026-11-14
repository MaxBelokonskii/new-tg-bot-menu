const { dbAll } = require('../../database/db');
const { getOrCreateUser } = require('./logic');
const { NUTRIENTS, sumNutrition } = require('../../utils/nutrition-totals');

/**
 * Returns every planned dish of an ISO week (Mon..Sun) with its date and
 * per-serving nutrition — one row per daily_menu_items entry.
 * @param {number} telegramId
 * @param {{start: string, endExclusive: string}} week - from getWeekBounds
 * @returns {Promise<Array<{date: string, calories: number, protein: number, fat: number, carbs: number}>>}
 */
async function getWeekPlanNutrition(telegramId, { start, endExclusive }) {
  const userId = await getOrCreateUser(telegramId);
  return dbAll(
    `SELECT dm.date, r.calories, r.protein, r.fat, r.carbs
     FROM daily_menu_items dmi
     JOIN daily_menu dm ON dmi.daily_menu_id = dm.id
     JOIN recipes r ON dmi.recipe_id = r.id
     WHERE dm.user_id = ? AND dm.date >= ? AND dm.date < ?`,
    [userId, start, endExclusive]
  );
}

/**
 * Aggregates the week's planned dishes: nutrition totals, the number of
 * days with at least one dish and the average per such day.
 *
 * [RU] Среднее делится на дни с блюдами, а не на 7: план на 3 дня из 7 не
 * должен выглядеть как «недобор» нормы в каждом дне.
 * [EN] The average is over planned days, not 7: a plan covering 3 of 7 days
 * should not read as falling short of the norm every day.
 *
 * @param {Array<{date: string, calories: number, protein: number, fat: number, carbs: number}>} rows
 * @returns {{plannedDays: number,
 *   totals: {calories: number, protein: number, fat: number, carbs: number},
 *   average: {calories: number, protein: number, fat: number, carbs: number}}}
 */
function summarizePlanWeek(rows) {
  const plannedDays = new Set(rows.map(row => row.date)).size;
  const totals = sumNutrition(rows);
  const average = {};
  for (const key of NUTRIENTS) average[key] = plannedDays > 0 ? totals[key] / plannedDays : 0;
  return { plannedDays, totals, average };
}

module.exports = { getWeekPlanNutrition, summarizePlanWeek };
