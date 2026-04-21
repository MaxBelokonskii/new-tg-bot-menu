const { Markup } = require('telegraf');
const texts = require('../bot/texts');

/**
 * Возвращает клавиатуру главного меню
 * @returns {object} Keyboard markup
 */
function getMainMenuKeyboard() {
  return Markup.keyboard([
    [texts.mainMenu.buttons.suggestions, texts.mainMenu.buttons.weeklyPlan],
    [texts.mainMenu.buttons.shoppingList, texts.mainMenu.buttons.reverseSearch],
    [texts.mainMenu.buttons.settings]
  ]).resize();
}

/**
 * Отправляет или редактирует сообщение на главное меню
 * @param {object} ctx - Telegraf context
 */
async function sendMainMenu(ctx) {
  const text = texts.mainMenu.title;
  if (ctx.updateType === 'callback_query') {
    await ctx.answerCbQuery();
    await ctx.reply(text, getMainMenuKeyboard());
  } else {
    await ctx.reply(text, getMainMenuKeyboard());
  }
}

module.exports = {
  getMainMenuKeyboard,
  sendMainMenu
};
