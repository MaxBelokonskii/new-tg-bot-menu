// [RU] Горизонт плана: текущая и следующая ISO-неделя пользователя. Чистые
// функции от его локального «сегодня» (getUserClock) — без БД и часов сервера.
// [EN] Plan horizon: the user's current and next ISO week. Pure functions of
// their local "today" (getUserClock) — no DB, no server clock.
const { addDays, isValidDate, getWeekBounds } = require('../../utils/date-helpers');

/** Week kinds the plan works with. */
const PLAN_WEEK_KINDS = Object.freeze(['current', 'next']);

/**
 * Bounds of the user's current and next ISO week.
 * @param {string} today - YYYY-MM-DD, the user's local today
 * @returns {{current: {start: string, endExclusive: string}, next: {start: string, endExclusive: string}}}
 */
function planWeeks(today) {
  const current = getWeekBounds(today);
  return { current, next: getWeekBounds(current.endExclusive) };
}

/**
 * Which plan week starts on `monday`: the current one, the next one, or
 * neither (a stale or forged button).
 * @param {string} monday - YYYY-MM-DD from callback_data
 * @param {string} today - YYYY-MM-DD, the user's local today
 * @returns {'current'|'next'|null}
 */
function weekKindOfMonday(monday, today) {
  const weeks = planWeeks(today);
  return PLAN_WEEK_KINDS.find(kind => weeks[kind].start === monday) || null;
}

/**
 * Which plan week contains `date`, or null when it is outside the horizon
 * (or not a valid date).
 * @param {string} date - YYYY-MM-DD
 * @param {string} today - YYYY-MM-DD, the user's local today
 * @returns {'current'|'next'|null}
 */
function weekKindOfDate(date, today) {
  if (!isValidDate(date)) return null;
  return weekKindOfMonday(getWeekBounds(date).start, today);
}

/**
 * First and last day of the plan horizon (current Monday … next Sunday).
 * @param {string} today - YYYY-MM-DD, the user's local today
 * @returns {{first: string, last: string}}
 */
function planHorizon(today) {
  const { current, next } = planWeeks(today);
  return { first: current.start, last: addDays(next.endExclusive, -1) };
}

module.exports = { PLAN_WEEK_KINDS, planWeeks, weekKindOfMonday, weekKindOfDate, planHorizon };
