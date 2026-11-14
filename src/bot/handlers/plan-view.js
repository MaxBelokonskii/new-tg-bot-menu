const { safeEdit } = require('./helpers');
const { sumNutrition } = require('../../utils/nutrition-totals');
const { getUserClock } = require('../../features/time-zone/logic');
const { getUserProfile } = require('../../features/profile/logic');
const { pickTargets } = require('../../features/profile/targets');
const { getDayPlan } = require('../../features/weekly-planner/day-plan');
const { getWeekPlanNutrition, summarizePlanWeek } = require('../../features/weekly-planner/week-totals');
const { planWeeks, weekKindOfDate, planHorizon } = require('../../features/weekly-planner/plan-weeks');
const { buildPlanDayScreen } = require('../../interface/plan-day');

/**
 * Returns the date when it is a valid day of the user's current or next
 * ISO week (the plan horizon), otherwise today: stale buttons from a past
 * week and forged dates fall back to today.
 * @param {string} date - YYYY-MM-DD from callback_data
 * @param {string} today - YYYY-MM-DD, the user's local today
 * @returns {string} YYYY-MM-DD
 */
function resolvePlanDate(date, today) {
  return weekKindOfDate(date, today) ? date : today;
}

/**
 * Loads one day of the plan, the nutrition of the week containing it and
 * the user's targets and builds the day screen.
 * @param {number} telegramId
 * @param {string} date - YYYY-MM-DD
 * @param {{today: string}} clock - getUserClock result
 * @returns {Promise<{text: string, extra: object}>}
 */
async function buildPlanDayView(telegramId, date, { today }) {
  const day = resolvePlanDate(date, today);
  const kind = weekKindOfDate(day, today);
  const week = planWeeks(today)[kind];
  const items = await getDayPlan(telegramId, day);
  const weekRows = await getWeekPlanNutrition(telegramId, week);
  const profile = await getUserProfile(telegramId);
  return buildPlanDayScreen({
    date: day,
    today,
    horizon: planHorizon(today),
    items,
    totals: sumNutrition(items),
    targets: profile ? pickTargets(profile) : null,
    week: { kind, start: week.start, ...summarizePlanWeek(weekRows) }
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
