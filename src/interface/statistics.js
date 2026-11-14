const { Markup } = require('telegraf');
const texts = require('../bot/texts');
const { addDays, weekdayOf, getWeekBounds } = require('../utils/date-helpers');
const { formatWeekRange } = require('./date-labels');
const { formatShortDate, buildProgressBar } = require('./food-log');
const { formatNutrientRow } = require('./plan-day');

const T = texts.statistics;
const DAY_BAR_WIDTH = 5;
// [RU] Русская типографика: разряды отбиваются пробелом с 5 знаков (12 600, но 1850).
// [EN] Russian typography: digit groups are spaced from 5 digits on (12 600 but 1850).
const GROUPING_FROM = 10000;

/**
 * Rounds kcal and groups thousands with a no-break space from 10 000 on.
 * @param {number} value
 * @returns {string}
 */
function formatKcal(value) {
  const rounded = Math.round(value);
  if (Math.abs(rounded) < GROUPING_FROM) return String(rounded);
  return String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * Title label of a week: "эта неделя, 9–15 нояб.", "прошлая неделя, …" or
 * just the date range.
 * @param {string} monday - YYYY-MM-DD
 * @param {string} today - YYYY-MM-DD
 * @returns {string}
 */
function formatStatsWeek(monday, today) {
  const current = getWeekBounds(today).start;
  let kind = 'other';
  if (monday === current) kind = 'current';
  else if (monday === addDays(current, -7)) kind = 'previous';
  return T.week[kind].replace('{range}', formatWeekRange(monday));
}

/**
 * One line per day Mon..Sun: kcal (with a short bar vs the kcal target),
 * "—" for a day without entries, "·" for a future day.
 * @param {Array<{date: string, future: boolean, entries: number, totals: {calories: number}}>} days
 * @param {{calories: number}|null} targets
 * @returns {string[]}
 */
function formatDays(days, targets) {
  return days.map((day) => {
    let value = T.dayEmpty;
    if (day.future) value = T.dayFuture;
    else if (day.entries > 0 && targets && targets.calories > 0) {
      value = T.dayBar
        .replace('{kcal}', formatKcal(day.totals.calories))
        .replace('{bar}', buildProgressBar(day.totals.calories, targets.calories, DAY_BAR_WIDTH));
    } else if (day.entries > 0) {
      value = T.dayKcal.replace('{kcal}', formatKcal(day.totals.calories));
    }
    return T.dayLine
      .replace('{day}', texts.weeklyPlan.daysShort[weekdayOf(day.date)])
      .replace('{date}', formatShortDate(day.date))
      .replace('{value}', value);
  });
}

const fillShares = (shares) => T.shares
  .replace('{protein}', shares.protein)
  .replace('{fat}', shares.fat)
  .replace('{carbs}', shares.carbs);

/**
 * P/F/C energy balance: the actual shares and, when known, the target ones.
 * @param {{protein: number, fat: number, carbs: number}|null} shares
 * @param {{protein: number, fat: number, carbs: number}|null} targetShares
 * @returns {string[]}
 */
function formatShares(shares, targetShares) {
  if (!shares) return [];
  const lines = ['', T.sharesHeader, T.sharesFact.replace('{values}', fillShares(shares))];
  if (targetShares) lines.push(T.sharesTarget.replace('{values}', fillShares(targetShares)));
  return lines;
}

/**
 * Plan vs fact block; empty when nothing was planned up to today.
 * @param {{plannedDays: number, planned: number, eaten: number, diff: number}|null} plan
 * @returns {string[]}
 */
function formatPlanVsFact(plan) {
  if (!plan) return [];
  const diff = Math.round(plan.diff);
  const diffLine = diff === 0
    ? T.planExact
    : T.planDiff.replace('{sign}', diff < 0 ? T.minus : T.plus).replace('{value}', formatKcal(Math.abs(diff)));
  return [
    '',
    T.planHeader.replace('{days}', plan.plannedDays),
    T.planLine.replace('{planned}', formatKcal(plan.planned)).replace('{eaten}', formatKcal(plan.eaten)),
    diffLine
  ];
}

/**
 * Variety block: distinct dishes in 30 days and the top dishes.
 * @param {{distinct: number, top: Array<{name: string, count: number}>}} variety
 * @returns {string[]}
 */
function formatVariety({ distinct, top }) {
  if (distinct === 0) return [];
  return [
    '',
    T.varietyHeader,
    T.varietyDistinct.replace('{count}', distinct),
    T.varietyTop,
    ...top.map((item, i) => T.varietyItem
      .replace('{n}', i + 1).replace('{name}', item.name).replace('{count}', item.count))
  ];
}

/**
 * Builds the weekly statistics screen: title with the week, per-day kcal,
 * summary with averages vs targets, P/F/C energy balance, plan vs fact,
 * 30-day variety, week navigation and "back to the diary". An empty week is
 * a short notice plus navigation.
 *
 * @param {ReturnType<typeof import('../features/statistics/summary').buildWeekStats>} stats
 * @param {{prev: string|null, next: string|null}} nav - Mondays of the neighbouring weeks
 * @returns {{text: string, extra: object}}
 */
function buildStatsScreen(stats, nav) {
  const { monday, today, targets } = stats;
  const lines = [T.title.replace('{week}', formatStatsWeek(monday, today)), ''];
  if (stats.daysWithEntries === 0) {
    lines.push(T.empty);
  } else {
    lines.push(
      T.daysHeader,
      ...formatDays(stats.days, targets),
      '',
      T.summaryHeader.replace('{days}', stats.daysWithEntries),
      T.average.replace('{values}', formatNutrientRow(stats.average, targets)),
      ...formatShares(stats.shares, stats.targetShares),
      ...formatPlanVsFact(stats.planVsFact),
      ...formatVariety(stats.variety)
    );
    if (!targets) lines.push('', texts.foodLog.noProfileHint);
  }

  const rows = [];
  const navRow = [];
  if (nav.prev) navRow.push(Markup.button.callback(T.buttons.prev, `st_week_${nav.prev}`));
  if (nav.next) navRow.push(Markup.button.callback(T.buttons.next, `st_week_${nav.next}`));
  if (navRow.length) rows.push(navRow);
  rows.push([Markup.button.callback(T.buttons.back, `fl_day_${today}`)]);

  return { text: lines.join('\n'), extra: { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) } };
}

module.exports = { formatKcal, formatStatsWeek, buildStatsScreen };
