const { Markup } = require('telegraf');
const texts = require('../bot/texts');

/**
 * Показывает меню управления недельным планом
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

module.exports = {
  sendWeeklyPlanMenu
};
