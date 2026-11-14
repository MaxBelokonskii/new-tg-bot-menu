const { safeEdit } = require('./helpers');
const { formatLocalDate, addDays, getCurrentWeekBounds } = require('../../utils/date-helpers');
const { sumNutrition } = require('../../utils/nutrition-totals');
const { getUserProfile } = require('../../features/profile/logic');
const { pickTargets } = require('../../features/profile/targets');
const { getDayPlan } = require('../../features/weekly-planner/day-plan');
const { getWeekPlanNutrition, summarizePlanWeek } = require('../../features/weekly-planner/week-totals');
const { buildPlanDayScreen } = require('../../interface/plan-day');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Returns the date when it is a valid day of the current ISO week, otherwise
 * today (stale buttons from a previous week fall back to today).
 * @param {string} date - YYYY-MM-DD from callback_data
 * @param {Date} [now=new Date()]
 * @returns {string} YYYY-MM-DD
 */
function resolvePlanDate(date, now = new Date()) {
  const { start, endExclusive } = getCurrentWeekBounds(now);
  const valid = typeof date === 'string' && DATE_PATTERN.test(date) && addDays(date, 0) === date;
  return valid && date >= start && date < endExclusive ? date : formatLocalDate(now);
}

/**
 * Loads one day of the plan, the week's nutrition and the user's targets
 * and builds the day screen.
 * @param {number} telegramId
 * @param {string} date - YYYY-MM-DD
 * @returns {Promise<{text: string, extra: object}>}
 */
async function buildPlanDayView(telegramId, date) {
  const now = new Date();
  const day = resolvePlanDate(date, now);
  const items = await getDayPlan(telegramId, day);
  const weekRows = await getWeekPlanNutrition(telegramId, now);
  const profile = await getUserProfile(telegramId);
  return buildPlanDayScreen({
    date: day,
    today: formatLocalDate(now),
    weekStart: getCurrentWeekBounds(now).start,
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
 * @param {{edit?: boolean}} [options]
 * @returns {Promise<void>}
 */
async function showPlanDay(ctx, date, { edit = true } = {}) {
  const { text, extra } = await buildPlanDayView(ctx.from.id, date);
  if (edit) await safeEdit(ctx, text, extra);
  else await ctx.reply(text, extra);
}

module.exports = { resolvePlanDate, showPlanDay };
