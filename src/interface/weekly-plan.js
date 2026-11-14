const { Markup } = require('telegraf');
const texts = require('../bot/texts');
const { PLAN_WEEK_KINDS, planWeeks } = require('../features/weekly-planner/plan-weeks');
const { formatWeekRange } = require('./date-labels');

const T = texts.weeklyPlan;

/**
 * Fills {week}/{weekIn}/{range} of a plan-week template.
 * @param {string} template
 * @param {'current'|'next'} kind
 * @param {string} monday - YYYY-MM-DD
 * @returns {string}
 */
function fillWeek(template, kind, monday) {
  return template
    .replace('{week}', T.weekName[kind])
    .replace('{weekIn}', T.weekNameIn[kind])
    .replace('{range}', formatWeekRange(monday));
}

/**
 * "Which week?" screen before generation: this week / next week with their
 * dates (gen_week_<monday>) and cancel.
 * @param {string} today - YYYY-MM-DD, the user's local today
 * @returns {{text: string, extra: object}}
 */
function buildWeekChoice(today) {
  const weeks = planWeeks(today);
  const rows = PLAN_WEEK_KINDS.map(kind => [Markup.button.callback(
    T.weekBtn[kind].replace('{range}', formatWeekRange(weeks[kind].start)),
    `gen_week_${weeks[kind].start}`
  )]);
  rows.push([Markup.button.callback(texts.confirm.no, 'cancel_generate_weekly_plan')]);
  return { text: T.chooseWeek, extra: Markup.inlineKeyboard(rows) };
}

/**
 * Shows the weekly plan menu (view / generate).
 * @param {object} ctx
 */
async function sendWeeklyPlanMenu(ctx) {
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(texts.weeklyPlan.view, 'view_weekly_plan')],
    [Markup.button.callback(texts.weeklyPlan.generate, 'generate_weekly_plan')]
  ]);

  const text = texts.weeklyPlan.title;
  if (ctx.updateType === 'callback_query') {
    await ctx.editMessageText(text, keyboard);
  } else {
    await ctx.reply(text, keyboard);
  }
}

/**
 * Builds the Yes/No keyboard for the "clear day" confirmation dialog.
 * @param {string} date - YYYY-MM-DD
 * @returns {object} reply_markup payload
 */
function buildClearDayConfirmKeyboard(date) {
  return {
    inline_keyboard: [[
      { text: texts.confirm.yes, callback_data: `do_clear_day_${date}` },
      { text: texts.confirm.no, callback_data: `cancel_clear_day_${date}` }
    ]]
  };
}

/**
 * Builds the Yes/No keyboard for the "remove one slot" confirmation dialog.
 * @param {string} date - YYYY-MM-DD
 * @param {number} slot
 * @returns {object} reply_markup payload
 */
function buildRemoveSlotConfirmKeyboard(date, slot) {
  return {
    inline_keyboard: [[
      { text: texts.confirm.yes, callback_data: `do_remove_slot_${date}_${slot}` },
      { text: texts.confirm.no, callback_data: `cancel_remove_slot_${date}_${slot}` }
    ]]
  };
}

/**
 * "Overwrite / fill empty / cancel" question shown when the chosen week
 * already has dishes; the week's Monday travels in the callbacks.
 * @param {'current'|'next'} kind
 * @param {string} monday - YYYY-MM-DD
 * @param {number} count - dishes already planned in that week
 * @returns {{text: string, extra: object}}
 */
function buildRegenerateChoice(kind, monday, count) {
  return {
    text: fillWeek(T.confirmRegenerate, kind, monday).replace('{count}', count),
    extra: {
      reply_markup: {
        inline_keyboard: [
          [{ text: T.overwriteBtn, callback_data: `generate_weekly_plan_overwrite_${monday}` }],
          [{ text: T.fillEmptyBtn, callback_data: `generate_weekly_plan_fill_${monday}` }],
          [{ text: texts.confirm.no, callback_data: 'cancel_generate_weekly_plan' }]
        ]
      }
    }
  };
}

/**
 * Result line after generation: "Готово! План на следующую неделю (24–30 нояб.) собран."
 * or "nothing to fill" when no slot was written.
 * @param {'current'|'next'} kind
 * @param {string} monday - YYYY-MM-DD
 * @param {number} slotsWritten
 * @returns {string}
 */
function formatGenerationResult(kind, monday, slotsWritten) {
  return fillWeek(slotsWritten === 0 ? T.nothingToFill : T.generated, kind, monday);
}

module.exports = {
  sendWeeklyPlanMenu,
  fillWeek,
  buildWeekChoice,
  buildRegenerateChoice,
  formatGenerationResult,
  buildClearDayConfirmKeyboard,
  buildRemoveSlotConfirmKeyboard
};
