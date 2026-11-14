const texts = require('../texts');
const logger = require('../../utils/logger');
const { safeEdit } = require('./helpers');
const {
  getIngredientsFromPlan,
  saveShoppingList,
  getLastShoppingList,
  clearShoppingLists
} = require('../../features/shopping-list/logic');
const {
  formatShoppingList,
  getShoppingListKeyboard,
  buildClearShoppingConfirmKeyboard
} = require('../../interface/shopping-list');
const { getCurrentWeekBounds, getCurrentDayBounds } = require('../../utils/date-helpers');

async function renderLastList(ctx) {
  const list = await getLastShoppingList(ctx.from.id);
  return safeEdit(ctx, formatShoppingList(list), { parse_mode: 'HTML', ...getShoppingListKeyboard() });
}

/**
 * Rebuilds the shopping list for today or the current week and re-renders it.
 * @param {import('telegraf').Context} ctx
 * @param {'day'|'week'} mode
 */
async function regenerateShoppingList(ctx, mode) {
  const bounds = mode === 'day' ? getCurrentDayBounds() : getCurrentWeekBounds();
  try {
    const ingredients = await getIngredientsFromPlan(ctx.from.id, bounds);
    if (ingredients.length === 0) {
      return ctx.answerCbQuery(texts.shoppingList.emptyForPeriod[mode], { show_alert: true });
    }
    await saveShoppingList(ctx.from.id, ingredients, bounds);
    await ctx.answerCbQuery(
      mode === 'day' ? texts.shoppingList.generatedDay : texts.shoppingList.generatedWeek
    );
    await renderLastList(ctx);
  } catch (error) {
    logger.error(`Error generating shopping list (${mode}):`, error);
    await ctx.answerCbQuery(texts.shoppingList.errorGenerate).catch(() => {});
  }
}

/**
 * Registers shopping-list handlers: show, rebuild (day/week), clear.
 * @param {import('telegraf').Telegraf} bot
 */
function register(bot) {
  bot.hears(texts.mainMenu.buttons.shoppingList, async (ctx) => {
    try {
      const list = await getLastShoppingList(ctx.from.id);
      await ctx.reply(formatShoppingList(list), { parse_mode: 'HTML', ...getShoppingListKeyboard() });
    } catch (error) {
      logger.error('Error showing shopping list:', error);
      await ctx.reply(texts.errors.general);
    }
  });

  bot.action('generate_shopping_list_day', (ctx) => regenerateShoppingList(ctx, 'day'));
  bot.action('generate_shopping_list_week', (ctx) => regenerateShoppingList(ctx, 'week'));

  bot.action('confirm_clear_shopping', async (ctx) => {
    await ctx.answerCbQuery();
    try {
      await ctx.editMessageText(texts.shoppingList.confirmClear, {
        reply_markup: buildClearShoppingConfirmKeyboard()
      });
    } catch (error) {
      logger.error('Error showing clear-shopping confirmation:', error);
    }
  });

  bot.action('do_clear_shopping', async (ctx) => {
    try {
      await clearShoppingLists(ctx.from.id);
      // [RU] Editим раньше answerCbQuery, чтобы catch мог безопасно ответить
      // об ошибке, если edit упал уже после закрытого query.
      // [EN] Edit before answerCbQuery so the error-path answer can't hit
      // an already-answered query.
      await safeEdit(ctx, texts.shoppingList.empty, getShoppingListKeyboard());
      await ctx.answerCbQuery(texts.shoppingList.cleared);
    } catch (error) {
      logger.error('Error clearing shopping list:', error);
      await ctx.answerCbQuery(texts.shoppingList.errorClear).catch(() => {});
    }
  });

  bot.action('cancel_clear_shopping', async (ctx) => {
    await ctx.answerCbQuery(texts.confirm.canceled);
    try {
      await renderLastList(ctx);
    } catch (error) {
      logger.error('Error restoring shopping list after cancel:', error);
    }
  });
}

module.exports = { register };
