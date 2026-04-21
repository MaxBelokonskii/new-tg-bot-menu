const { Telegraf } = require('telegraf');
require('dotenv').config();
const { initDb } = require('./database/db');
const logger = require('./utils/logger');
const texts = require('./bot/texts');
const { sendMainMenu } = require('./interface/main-menu');
const { sendCategorySelection, showDishSuggestion } = require('./interface/dish-selection');
const {
  sendWeeklyPlanMenu,
  buildWeeklyPlanMessage,
  buildClearDayConfirmKeyboard
} = require('./interface/weekly-plan');
const { getOrCreateUser, saveSelectedDish, getWeeklyPlan, clearDailyPlan } = require('./features/weekly-planner/logic');
const {
  getIngredientsFromPlan,
  saveShoppingList,
  getLastShoppingList,
  clearShoppingLists
} = require('./features/shopping-list/logic');
const {
  formatShoppingList,
  getShoppingListKeyboard,
  buildClearShoppingConfirmKeyboard
} = require('./interface/shopping-list');

const bot = new Telegraf(process.env.BOT_TOKEN || 'DUMMY_TOKEN');

// Initialize database
initDb();

// Basic middleware for logging
bot.use(async (ctx, next) => {
  const start = Date.now();
  if (ctx.from) {
    // Автоматическое создание/обновление пользователя
    await getOrCreateUser(ctx.from.id, ctx.from.username);
  }
  await next();
  const ms = Date.now() - start;
  logger.info(`Response time: ${ms}ms`);
});

// Basic commands
bot.start(async (ctx) => {
  await ctx.reply(texts.welcome);
  await sendMainMenu(ctx);
  logger.info(`User ${ctx.from.id} started the bot`);
});

bot.hears(texts.mainMenu.buttons.suggestions, async (ctx) => {
  await sendCategorySelection(ctx);
});

// Callback queries
bot.action(/^select_cat_(.+)$/, async (ctx) => {
  const category = ctx.match[1];
  await showDishSuggestion(ctx, category);
});

bot.action('back_to_categories', async (ctx) => {
  await sendCategorySelection(ctx);
});

bot.action(/^confirm_dish_(.+)$/, async (ctx) => {
  const recipeId = parseInt(ctx.match[1]);
  try {
    const { status } = await saveSelectedDish(ctx.from.id, recipeId);
    await ctx.answerCbQuery(texts.dishSelection[status] || texts.dishSelection.added);
  } catch (error) {
    logger.error('Error saving dish:', error);
    await ctx.answerCbQuery('Ошибка при сохранении блюда.');
  }
  await sendMainMenu(ctx);
});

bot.hears(texts.mainMenu.buttons.weeklyPlan, async (ctx) => {
  await sendWeeklyPlanMenu(ctx);
});

bot.action('generate_weekly_plan', async (ctx) => {
  await ctx.answerCbQuery('Генерация плана...');
  await ctx.reply('Генерация плана в разработке (логика подбора блюд)');
});

bot.action('view_weekly_plan', async (ctx) => {
  await ctx.answerCbQuery();
  try {
    const plan = await getWeeklyPlan(ctx.from.id);
    const payload = buildWeeklyPlanMessage(plan);
    if (!payload) {
      return ctx.reply(texts.weeklyPlan.empty);
    }
    await ctx.reply(payload.text, {
      parse_mode: 'HTML',
      reply_markup: payload.reply_markup
    });
  } catch (error) {
    logger.error('Error viewing plan:', error);
    await ctx.reply(texts.errors.general);
  }
});

bot.action(/^confirm_clear_day_(.+)$/, async (ctx) => {
  const date = ctx.match[1];
  await ctx.answerCbQuery();
  try {
    await ctx.editMessageText(
      texts.weeklyPlan.confirmClear.replace('{date}', date),
      { reply_markup: buildClearDayConfirmKeyboard(date) }
    );
  } catch (error) {
    logger.error('Error showing clear-day confirmation:', error);
  }
});

bot.action(/^do_clear_day_(.+)$/, async (ctx) => {
  const date = ctx.match[1];
  try {
    await clearDailyPlan(ctx.from.id, date);
    await ctx.answerCbQuery(texts.weeklyPlan.cleared.replace('{date}', date));
    await ctx.editMessageText(texts.weeklyPlan.cleared.replace('{date}', date));
  } catch (error) {
    logger.error('Error clearing daily plan:', error);
    await ctx.answerCbQuery('Ошибка при очистке плана.');
  }
});

bot.action(/^cancel_clear_day_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery(texts.confirm.canceled);
  try {
    const plan = await getWeeklyPlan(ctx.from.id);
    const payload = buildWeeklyPlanMessage(plan);
    if (!payload) {
      return ctx.editMessageText(texts.weeklyPlan.empty);
    }
    await ctx.editMessageText(payload.text, {
      parse_mode: 'HTML',
      reply_markup: payload.reply_markup
    });
  } catch (error) {
    logger.error('Error restoring plan after cancel:', error);
  }
});

bot.hears(texts.mainMenu.buttons.shoppingList, async (ctx) => {
  try {
    const list = await getLastShoppingList(ctx.from.id);
    const message = formatShoppingList(list);
    await ctx.reply(message, { 
      parse_mode: 'HTML',
      ...getShoppingListKeyboard()
    });
  } catch (error) {
    logger.error('Error showing shopping list:', error);
    await ctx.reply(texts.errors.general);
  }
});

bot.action('generate_shopping_list', async (ctx) => {
  try {
    const ingredients = await getIngredientsFromPlan(ctx.from.id);
    if (ingredients.length === 0) {
      return ctx.answerCbQuery(texts.shoppingList.empty, { show_alert: true });
    }
    
    await saveShoppingList(ctx.from.id, ingredients);
    await ctx.answerCbQuery('Список успешно обновлен! ✨');
    
    const list = await getLastShoppingList(ctx.from.id);
    const message = formatShoppingList(list);
    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      ...getShoppingListKeyboard()
    }).catch(err => {
      if (err.description && err.description.includes('message is not modified')) {
        return; // Игнорируем ошибку, если содержимое не изменилось
      }
      throw err;
    });
  } catch (error) {
    logger.error('Error generating shopping list:', error);
    await ctx.answerCbQuery('Ошибка при генерации списка.');
  }
});

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
    await ctx.answerCbQuery('Список очищен! 🗑️');
    await ctx.editMessageText(texts.shoppingList.empty, getShoppingListKeyboard())
      .catch(err => {
        if (err.description && err.description.includes('message is not modified')) {
          return;
        }
        throw err;
      });
  } catch (error) {
    logger.error('Error clearing shopping list:', error);
    await ctx.answerCbQuery('Ошибка при очистке списка.');
  }
});

bot.action('cancel_clear_shopping', async (ctx) => {
  await ctx.answerCbQuery(texts.confirm.canceled);
  try {
    const list = await getLastShoppingList(ctx.from.id);
    const message = formatShoppingList(list);
    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      ...getShoppingListKeyboard()
    }).catch(err => {
      if (err.description && err.description.includes('message is not modified')) {
        return;
      }
      throw err;
    });
  } catch (error) {
    logger.error('Error restoring shopping list after cancel:', error);
  }
});

bot.hears(texts.mainMenu.buttons.settings, async (ctx) => {
  await ctx.reply('Настройки в разработке...');
});

bot.help((ctx) => ctx.reply('Send /start to begin.'));

// Error handling
bot.catch((err, ctx) => {
  logger.error(`Ooops, encountered an error for ${ctx.updateType}`, err);
});

// Start bot
if (process.env.BOT_TOKEN && process.env.BOT_TOKEN !== 'your_telegram_bot_token') {
  bot.launch()
    .then(() => logger.info('Bot is running...'))
    .catch((err) => logger.error('Failed to launch bot:', err));
} else {
  logger.warn('BOT_TOKEN is not set. Bot will not start.');
}

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
