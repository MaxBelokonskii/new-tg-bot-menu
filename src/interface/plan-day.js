const { Markup } = require('telegraf');
const texts = require('../bot/texts');
const { NUTRIENTS } = require('../utils/nutrition-totals');
const { addDays, weekdayOf } = require('../utils/date-helpers');
const { slotLabel } = require('../utils/formatters');
const { fillWeek } = require('./weekly-plan');

const T = texts.weeklyPlan;
const D = T.day;
const BUTTON_NAME_MAX = 28;

const truncate = (name) => (name.length > BUTTON_NAME_MAX ? `${name.slice(0, BUTTON_NAME_MAX - 1)}…` : name);

/**
 * Formats YYYY-MM-DD as DD.MM.
 * @param {string} date
 * @returns {string}
 */
function formatDayMonth(date) {
  const [, m, d] = date.split('-');
  return `${d}.${m}`;
}

/**
 * Short day label for prompts and toasts: "Ср 12.11".
 * @param {string} date - YYYY-MM-DD
 * @returns {string}
 */
function formatPlanDate(date) {
  return T.shortDate
    .replace('{day}', T.daysShort[weekdayOf(date)])
    .replace('{date}', formatDayMonth(date));
}

/**
 * One planned dish: "Завтрак: Омлет — 250 ккал".
 * @param {{slot: number, name: string, calories: number}} item
 * @returns {string}
 */
function formatPlanItem(item) {
  return D.item
    .replace('{slot}', slotLabel(item.slot))
    .replace('{name}', item.name)
    .replace('{kcal}', Math.round(Number(item.calories) || 0));
}

/**
 * Share of a target in whole percent; 0 when the target is missing.
 * @param {number} value
 * @param {number} target
 * @returns {number}
 */
function percentOf(value, target) {
  return target > 0 ? Math.round((value / target) * 100) : 0;
}

/**
 * Joins nutrients into "1960 ккал · Б 90 г · Ж 64 г · У 220 г", optionally
 * with the share of each daily target: "1960 ккал (82%) · …".
 * @param {{calories: number, protein: number, fat: number, carbs: number}} values
 * @param {{calories: number, protein: number, fat: number, carbs: number}|null} [targets]
 * @returns {string}
 */
function formatNutrientRow(values, targets = null) {
  return NUTRIENTS.map((key) => {
    const piece = D.nutrientShort[key].replace('{value}', Math.round(values[key]));
    if (!targets) return piece;
    return piece + D.percentOfTarget.replace('{percent}', percentOf(values[key], Number(targets[key]) || 0));
  }).join(' · ');
}

/**
 * Compact week block for the bottom of the day screen: which week (this /
 * next, with dates), days with dishes, week sums and the average per
 * planned day (vs daily targets when known). Empty when nothing is planned
 * in that week.
 * @param {{kind: 'current'|'next', start: string, plannedDays: number,
 *   totals: {calories: number, protein: number, fat: number, carbs: number},
 *   average: {calories: number, protein: number, fat: number, carbs: number}}|null} week
 *   summarizePlanWeek result plus the week's kind and Monday
 * @param {{calories: number, protein: number, fat: number, carbs: number}|null} targets
 * @returns {string[]}
 */
function formatWeekSummary(week, targets) {
  if (!week || week.plannedDays === 0) return [];
  return [
    fillWeek(D.weekHeader, week.kind, week.start).replace('{days}', week.plannedDays),
    D.weekTotal.replace('{values}', formatNutrientRow(week.totals)),
    D.weekAverage.replace('{values}', formatNutrientRow(week.average, targets))
  ];
}

/**
 * Day totals: planned vs targets per nutrient with a percentage, or the
 * bare sums plus a fill-the-profile hint when there are no targets.
 * @param {{calories: number, protein: number, fat: number, carbs: number}} totals
 * @param {{calories: number, protein: number, fat: number, carbs: number}|null} targets
 * @returns {string[]}
 */
function formatDayTotals(totals, targets) {
  const lines = [D.totalsHeader];
  if (!targets) {
    lines.push(
      D.plannedOnly
        .replace('{kcal}', Math.round(totals.calories))
        .replace('{protein}', Math.round(totals.protein))
        .replace('{fat}', Math.round(totals.fat))
        .replace('{carbs}', Math.round(totals.carbs)),
      D.noProfileHint
    );
    return lines;
  }
  for (const key of NUTRIENTS) {
    const target = Number(targets[key]) || 0;
    const percent = percentOf(totals[key], target);
    lines.push(D.nutrientLine
      .replace('{label}', texts.macroTargets.labels[key])
      .replace('{value}', Math.round(totals[key]))
      .replace('{target}', Math.round(target))
      .replace('{unit}', D.units[key])
      .replace('{percent}', percent));
  }
  return lines;
}

/**
 * ◀️/▶️ to the neighbouring days within the plan horizon (current Monday …
 * next Sunday); the buttons cross the week boundary.
 * @param {string} date - YYYY-MM-DD
 * @param {{first: string, last: string}} horizon
 * @returns {Array<object>}
 */
function buildNavRow(date, { first, last }) {
  const row = [];
  if (date > first) {
    const prev = addDays(date, -1);
    row.push(Markup.button.callback(D.prevBtn.replace('{day}', T.daysShort[weekdayOf(prev)]), `wp_day_${prev}`));
  }
  if (date < last) {
    const next = addDays(date, 1);
    row.push(Markup.button.callback(D.nextBtn.replace('{day}', T.daysShort[weekdayOf(next)]), `wp_day_${next}`));
  }
  return row;
}

/**
 * Builds one day of the weekly plan: weekday header, dishes with kcal,
 * totals vs targets, a compact summary of the week containing the day,
 * per-dish replace/remove buttons, "clear day", ◀️/▶️ navigation within the
 * plan horizon (this and next week), "week as .txt" (when the week has
 * dishes) and "back to the plan menu".
 *
 * [RU] Один день на экран вместо всей недели: на полной неделе было
 * ~77 кнопок в одном сообщении. callback_data кнопок замены/удаления/очистки
 * прежние — их хэндлеры возвращают пользователя на этот же день.
 * [EN] One day per screen instead of the whole week (a full week had ~77
 * buttons in one message). Replace/remove/clear callbacks are unchanged;
 * their handlers bring the user back to this day.
 *
 * @param {{date: string, today: string, horizon: {first: string, last: string},
 *   items: Array<{slot: number, name: string, calories: number}>,
 *   totals: {calories: number, protein: number, fat: number, carbs: number},
 *   targets: {calories: number, protein: number, fat: number, carbs: number}|null,
 *   week?: {kind: 'current'|'next', start: string, plannedDays: number,
 *     totals: object, average: object}|null}} view
 *   horizon from planHorizon; week — summarizePlanWeek of the day's week plus its kind and Monday
 * @returns {{text: string, extra: object}}
 */
function buildPlanDayScreen({ date, today, horizon, items, totals, targets, week = null }) {
  let mark = '';
  if (date === today) mark = D.todayMark;
  else if (week && week.kind === 'next') mark = D.nextWeekMark;
  const header = D.header
    .replace('{day}', T.days[weekdayOf(date)])
    .replace('{date}', formatDayMonth(date))
    .replace('{today}', mark);
  const lines = [`<b>${T.title}</b>`, '', header, ''];
  if (items.length === 0) {
    lines.push(D.empty);
  } else {
    lines.push(...items.map(item => `• ${formatPlanItem(item)}`), '', ...formatDayTotals(totals, targets));
  }
  const weekLines = formatWeekSummary(week, targets);
  if (weekLines.length) lines.push('', ...weekLines);

  const rows = items.map(item => [
    Markup.button.callback(`${texts.editSlot.replaceBtn} ${truncate(item.name)}`, `edit_slot_${date}_${item.slot}`),
    Markup.button.callback(texts.editSlot.removeBtn, `confirm_remove_slot_${date}_${item.slot}`)
  ]);
  if (items.length > 0) rows.push([Markup.button.callback(T.clearDay, `confirm_clear_day_${date}`)]);
  const nav = buildNavRow(date, horizon);
  if (nav.length) rows.push(nav);
  if (week && week.plannedDays > 0) {
    rows.push([Markup.button.callback(texts.export.planWeekBtn, `wp_export_${week.start}`)]);
  }
  rows.push([Markup.button.callback(D.menuBtn, 'wp_menu')]);

  return { text: lines.join('\n'), extra: { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) } };
}

module.exports = {
  formatPlanDate,
  formatPlanItem,
  formatNutrientRow,
  formatDayTotals,
  formatWeekSummary,
  buildPlanDayScreen
};
