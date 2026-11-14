// [RU] Экспорт плана недели и списка покупок в обычный текст для .txt-файла.
// Чистые функции: данные и «сегодня» пользователя приходят от хэндлера, в БД
// не ходим, HTML-теги не используем (файл читают в любом просмотрщике).
// [EN] Plain-text export of the week plan and the shopping list for a .txt
// file. Pure functions: data and the user's today come from the handler, no
// DB access, no HTML tags (the file is read in any viewer).
const texts = require('../bot/texts');
const { addDays, weekdayOf } = require('../utils/date-helpers');
const { sumNutrition } = require('../utils/nutrition-totals');
const { formatShoppingQuantity } = require('../utils/formatters');
const { formatPeriodLabel, groupItemsByType } = require('./shopping-list');
const { formatPlanItem, formatNutrientRow } = require('./plan-day');
const { fillWeek } = require('./weekly-plan');
const { formatDayMonthName } = require('./date-labels');

const E = texts.export;
const DAYS_IN_WEEK = 7;

/**
 * One shopping list line: "☐ Молоко — 1 л" / "☑ Соль — по вкусу".
 * @param {{name: string, is_bought: boolean, total_amount: number, unit: string, to_taste: boolean}} item
 * @returns {string}
 */
function formatShoppingLine(item) {
  return E.shoppingList.item
    .replace('{mark}', item.is_bought ? E.shoppingList.checked : E.shoppingList.unchecked)
    .replace('{name}', item.name)
    .replace('{qty}', formatShoppingQuantity(item));
}

/**
 * Plain-text shopping list: period title, a stale note for a past period,
 * groups by type in the screen order and the "bought N of M" footer.
 * @param {{ items: Array, periodStart: string|null, periodEnd: string|null, householdSize?: number }} list
 *   getLastShoppingList result with at least one item; the title gets
 *   " · на N чел." like the screen
 * @param {string} today - YYYY-MM-DD, the user's local today
 * @returns {string}
 */
function formatShoppingListExport({ items, periodStart, periodEnd, householdSize }, today) {
  const label = formatPeriodLabel(periodStart, periodEnd, today, householdSize);
  const lines = [label ? E.shoppingList.title.replace('{label}', label) : E.shoppingList.titleNoPeriod];
  if (periodEnd && today >= periodEnd) lines.push(E.shoppingList.stale);
  for (const group of groupItemsByType(items)) {
    lines.push('', group.header, ...group.items.map(formatShoppingLine));
  }
  const bought = items.filter(item => item.is_bought).length;
  lines.push('', E.shoppingList.bought.replace('{bought}', bought).replace('{total}', items.length));
  return `${lines.join('\n')}\n`;
}

/**
 * One day block: "Понедельник, 16 нояб.", the dishes by slot with kcal and
 * the day total, or "— пусто".
 * @param {string} date - YYYY-MM-DD
 * @param {Array<{slot: number, name: string, calories: number}>} dishes - the day's rows
 * @returns {string[]}
 */
function formatPlanDay(date, dishes) {
  const header = E.plan.dayHeader
    .replace('{day}', texts.weeklyPlan.days[weekdayOf(date)])
    .replace('{date}', formatDayMonthName(date));
  if (dishes.length === 0) return [header, E.plan.empty];
  return [
    header,
    ...dishes.map(dish => `• ${formatPlanItem(dish)}`),
    E.plan.dayTotal.replace('{values}', formatNutrientRow(sumNutrition(dishes)))
  ];
}

/**
 * Plain-text week plan: title with the week and its dates, seven day blocks
 * and the week totals (sums and the average per planned day, with the share
 * of the daily targets when known).
 * @param {{kind: 'current'|'next', monday: string,
 *   rows: Array<{date: string, slot: number, name: string,
 *     calories: number, protein: number, fat: number, carbs: number}>,
 *   summary: {plannedDays: number, totals: object, average: object},
 *   targets: {calories: number, protein: number, fat: number, carbs: number}|null}} plan
 *   rows — getWeekPlanNutrition of that week (ordered by date and slot);
 *   summary — summarizePlanWeek(rows)
 * @returns {string}
 */
function formatPlanExport({ kind, monday, rows, summary, targets }) {
  const lines = [fillWeek(E.plan.title, kind, monday)];
  for (let offset = 0; offset < DAYS_IN_WEEK; offset += 1) {
    const date = addDays(monday, offset);
    lines.push('', ...formatPlanDay(date, rows.filter(row => row.date === date)));
  }
  lines.push(
    '',
    E.plan.weekHeader.replace('{days}', summary.plannedDays),
    E.plan.weekTotal.replace('{values}', formatNutrientRow(summary.totals)),
    E.plan.weekAverage.replace('{values}', formatNutrientRow(summary.average, targets))
  );
  return `${lines.join('\n')}\n`;
}

/**
 * @param {string|null} periodStart - YYYY-MM-DD
 * @returns {string} "shopping-list-2026-11-09.txt" ("shopping-list.txt" without a period)
 */
function shoppingListFilename(periodStart) {
  return periodStart ? `shopping-list-${periodStart}.txt` : 'shopping-list.txt';
}

/**
 * @param {string} monday - YYYY-MM-DD
 * @returns {string} "meal-plan-2026-11-16.txt"
 */
function planFilename(monday) {
  return `meal-plan-${monday}.txt`;
}

module.exports = {
  formatShoppingListExport,
  formatPlanExport,
  shoppingListFilename,
  planFilename
};
