const { safeEdit } = require('./helpers');
const { isValidDate, getWeekBounds } = require('../../utils/date-helpers');
const { sumNutrition } = require('../../utils/nutrition-totals');
const { getUserClock } = require('../../features/time-zone/logic');
const { getUserProfile } = require('../../features/profile/logic');
const { pickTargets } = require('../../features/profile/targets');
const { getDayPlan } = require('../../features/weekly-planner/day-plan');
const { getWeekPlanNutrition, summarizePlanWeek } = require('../../features/weekly-planner/week-totals');
const { buildPlanDayScreen } = require('../../interface/plan-day');

/**
 * Returns the date when it is a valid day of the user's current ISO week,
 * otherwise today (stale buttons from a previous week fall back to today).
 * @param {string} date - YYYY-MM-DD from callback_data
 * @param {string} today - YYYY-MM-DD, the user's local today
 * @returns {string} YYYY-MM-DD
 */
function resolvePlanDate(date, today) {
  const { start, endExclusive } = getWeekBounds(today);
  return isValidDate(date) && date >= start && date < endExclusive ? date : today;
}

/**
 * Loads one day of the plan, the week's nutrition and the user's targets
 * and builds the day screen.
 * @param {number} telegramId
 * @param {string} date - YYYY-MM-DD
 * @param {{today: string, week: {start: string, endExclusive: string}}} clock - getUserClock result
 * @returns {Promise<{text: string, extra: object}>}
 */
async function buildPlanDayView(telegramId, date, { today, week }) {
  const day = resolvePlanDate(date, today);
  const items = await getDayPlan(telegramId, day);
  const weekRows = await getWeekPlanNutrition(telegramId, week);
  const profile = await getUserProfile(telegramId);
  return buildPlanDayScreen({
    date: day,
    today,
    weekStart: week.start,
    items,
    totals: sumNutrition(items),
    targets: profile ? pickTargets(profile) : null,
    week: summarizePlanWeek(weekRows)
  });
}

/**
 * Shows a plan day: edits the callback message (default) or sends a new one.
 * @param {import('telegraf').Context} ctx
 * @param {string} date - YYYY-MM-DD
 * @param {{edit?: boolean, clock?: object}} [options] - clock: getUserClock
 *   result when the caller already has it (loaded otherwise)
 * @returns {Promise<void>}
 */
async function showPlanDay(ctx, date, { edit = true, clock = null } = {}) {
  const userClock = clock || await getUserClock(ctx.from.id);
  const { text, extra } = await buildPlanDayView(ctx.from.id, date, userClock);
  if (edit) await safeEdit(ctx, text, extra);
  else await ctx.reply(text, extra);
}

module.exports = { resolvePlanDate, showPlanDay };
