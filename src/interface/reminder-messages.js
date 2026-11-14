const { Markup } = require('telegraf');
const texts = require('../bot/texts');
const { NUTRIENTS, calculateRemaining } = require('../utils/nutrition-totals');
const { formatPlanDate, formatPlanItem, formatNutrientRow } = require('./plan-day');
const { fillWeek } = require('./weekly-plan');

const M = texts.reminders.messages;
const B = texts.reminders.buttons;

/**
 * Morning reminder: today's planned dishes with the kcal total (against the
 * daily target when known), or an empty-plan notice with buttons to pick
 * dishes / generate the week.
 *
 * @param {{date: string, items: Array<{slot: number, name: string, calories: number}>,
 *   targets: {calories: number}|null}} data - date is the user's local today
 * @returns {{text: string, extra: object}}
 */
function buildMorningMessage({ date, items, targets }) {
  const day = formatPlanDate(date);
  if (items.length === 0) {
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(B.pickDishes, 'back_to_categories')],
      [Markup.button.callback(B.generateWeek, 'generate_weekly_plan')]
    ]);
    return { text: M.morningEmpty.replace('{date}', day), extra: { parse_mode: 'HTML', ...keyboard } };
  }
  const kcal = Math.round(items.reduce((sum, item) => sum + (Number(item.calories) || 0), 0));
  const total = targets && targets.calories
    ? M.morningTotalTarget.replace('{kcal}', kcal).replace('{target}', targets.calories)
    : M.morningTotal.replace('{kcal}', kcal);
  const lines = [M.morningTitle.replace('{date}', day), '', ...items.map(formatPlanItem), '', total];
  const keyboard = Markup.inlineKeyboard([[Markup.button.callback(B.openPlan, `wp_day_${date}`)]]);
  return { text: lines.join('\n'), extra: { parse_mode: 'HTML', ...keyboard } };
}

/**
 * "Eaten / target / left" lines for the evening reminder. A calorie
 * overshoot replaces the "left" line with a warning; negative macro
 * remainders are shown as 0.
 * @param {{calories: number, protein: number, fat: number, carbs: number}} totals
 * @param {{calories: number, protein: number, fat: number, carbs: number}} targets
 * @returns {string[]}
 */
function buildTargetLines(totals, targets) {
  const remaining = calculateRemaining(totals, targets);
  const lines = [M.target.replace('{values}', formatNutrientRow(targets))];
  if (remaining.calories < 0) {
    lines.push(M.over.replace('{kcal}', Math.round(-remaining.calories)));
    return lines;
  }
  const left = {};
  for (const key of NUTRIENTS) left[key] = Math.max(0, remaining[key] || 0);
  lines.push(M.remaining.replace('{values}', formatNutrientRow(left)));
  return lines;
}

/**
 * Evening reminder: nudge to fill the diary, eaten today vs the norm and
 * what is left, buttons to the diary day and (with targets) "what else to eat".
 *
 * @param {{date: string, entriesCount: number,
 *   totals: {calories: number, protein: number, fat: number, carbs: number},
 *   targets: {calories: number, protein: number, fat: number, carbs: number}|null}} data
 * @returns {{text: string, extra: object}}
 */
function buildEveningMessage({ date, entriesCount, totals, targets }) {
  const lines = [M.eveningTitle, ''];
  lines.push(entriesCount === 0 ? M.eveningEmpty : M.eaten.replace('{values}', formatNutrientRow(totals)));
  if (targets) lines.push(...buildTargetLines(totals, targets));
  else lines.push('', M.noTargets);

  const rows = [[Markup.button.callback(B.diary, `fl_day_${date}`)]];
  if (targets) rows.push([Markup.button.callback(B.whatToEat, 'wte_show_0')]);
  return { text: lines.join('\n'), extra: { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) } };
}

/**
 * Weekly reminder: plan the target week and build its shopping list. The
 * buttons go straight to that week: gen_week_<monday> (no week choice) and
 * sl_week_<monday> (its shopping list); both are checked at click time.
 * @param {{kind: 'current'|'next', monday: string}} target - weeklyReminderWeek result
 * @returns {{text: string, extra: object}}
 */
function buildWeeklyMessage({ kind, monday }) {
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(fillWeek(B.planWeek, kind, monday), `gen_week_${monday}`)],
    [Markup.button.callback(fillWeek(B.shoppingWeek, kind, monday), `sl_week_${monday}`)]
  ]);
  return {
    text: [M.weeklyTitle, '', fillWeek(M.weeklyBody, kind, monday)].join('\n'),
    extra: { parse_mode: 'HTML', ...keyboard }
  };
}

module.exports = {
  buildMorningMessage,
  buildEveningMessage,
  buildWeeklyMessage
};
