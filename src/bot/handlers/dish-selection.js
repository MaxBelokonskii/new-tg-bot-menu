const texts = require('../texts');
const logger = require('../../utils/logger');
const { sendMainMenu } = require('../../interface/main-menu');
const { sendCategorySelection, showDishSuggestion } = require('../../interface/dish-selection');
const { saveSelectedDish } = require('../../features/weekly-planner/logic');

/**
 * Registers "random dish by category → add to today's plan" handlers.
 * @param {import('telegraf').Telegraf} bot
 */
function register(bot) {
  bot.hears(texts.mainMenu.buttons.suggestions, (ctx) => sendCategorySelection(ctx));

  bot.action(/^select_cat_(.+)$/, (ctx) => showDishSuggestion(ctx, ctx.match[1]));

  bot.action('back_to_categories', (ctx) => sendCategorySelection(ctx));

  bot.action(/^confirm_dish_(.+)$/, async (ctx) => {
    const recipeId = parseInt(ctx.match[1], 10);
    try {
      const { status } = await saveSelectedDish(ctx.from.id, recipeId);
      await ctx.answerCbQuery(texts.dishSelection[status] || texts.dishSelection.added);
    } catch (error) {
      logger.error('Error saving dish:', error);
      await ctx.answerCbQuery('Ошибка при сохранении блюда.');
    }
    await sendMainMenu(ctx);
  });
}

module.exports = { register };
