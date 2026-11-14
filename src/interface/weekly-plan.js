const { Markup } = require('telegraf');
const texts = require('../bot/texts');

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
 * Builds the "overwrite / fill empty / cancel" keyboard shown when the week
 * already has dishes and the user asks to generate a plan.
 * @returns {object} reply_markup payload
 */
function buildRegenerateChoiceKeyboard() {
  return {
    inline_keyboard: [
      [{ text: texts.weeklyPlan.overwriteBtn, callback_data: 'generate_weekly_plan_overwrite' }],
      [{ text: texts.weeklyPlan.fillEmptyBtn, callback_data: 'generate_weekly_plan_fill' }],
      [{ text: texts.confirm.no, callback_data: 'cancel_generate_weekly_plan' }]
    ]
  };
}

module.exports = {
  sendWeeklyPlanMenu,
  buildRegenerateChoiceKeyboard,
  buildClearDayConfirmKeyboard,
  buildRemoveSlotConfirmKeyboard
};
