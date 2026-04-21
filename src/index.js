const { Telegraf, Scenes, session } = require('telegraf');
require('dotenv').config();
const { initDb } = require('./database/db');
const logger = require('./utils/logger');
const texts = require('./bot/texts');
const { sendMainMenu } = require('./interface/main-menu');
const { sendProfileMenu } = require('./interface/profile');
const { profileScene, SCENE_ID: PROFILE_SCENE_ID } = require('./features/profile/scene');
const { reverseSearchScene, SCENE_ID: REVERSE_SCENE_ID } = require('./features/reverse-search/scene');
const {
  findRecipesByInventory,
  getUserTargets,
  getRecipeById
} = require('./features/reverse-search/logic');
const { getRecipeIngredients } = require('./features/meal-suggestions/logic');
const {
  buildResultsMessage,
  buildRecipeCard: buildReverseRecipeCard
} = require('./interface/reverse-search');
const { getUserProfile } = require('./features/profile/logic');
const {
  sendCategorySelection,
  showDishSuggestion,
  showReplacementSuggestion
} = require('./interface/dish-selection');
const {
  sendWeeklyPlanMenu,
  buildWeeklyPlanMessage,
  buildClearDayConfirmKeyboard,
  buildRemoveSlotConfirmKeyboard
} = require('./interface/weekly-plan');
const {
  getOrCreateUser,
  saveSelectedDish,
  getWeeklyPlan,
  clearDailyPlan,
  removeSlot,
  replaceInSlot,
  generateWeeklyPlan,
  EmptyCategoryError
} = require('./features/weekly-planner/logic');

// [RU] Английские ключи категорий из БД → локализованные подписи для UI.
// [EN] DB category keys (en) → localized labels for UI.
const CATEGORY_LABEL = {
  breakfast: texts.categories.breakfast,
  main: texts.categories.main,
  salads: texts.categories.salad,
  desserts: texts.categories.dessert
};
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

// [RU] Session + Stage нужны для многошагового ввода анкеты профиля.
// Стор по умолчанию — in-memory: состояние анкеты живёт минуту и не
// нуждается в персистентности. Подключаем до stage.middleware(), иначе
// у ctx не будет ctx.session, куда Stage кладёт свои данные.
// [EN] Session + Stage back the multi-step profile survey. Default
// in-memory store is enough — survey state is short-lived. Must be
// registered before stage.middleware() so Stage can read ctx.session.
const stage = new Scenes.Stage([profileScene, reverseSearchScene]);
bot.use(session());
bot.use(stage.middleware());

// [RU] Общий рендер «просмотра плана» с editMessageText — используется из cancel-
// хэндлеров и после успешных replace/remove, чтобы вернуть пользователя
// к свежему списку в том же сообщении.
// [EN] Shared "render current plan via editMessageText" — used by cancel
// handlers and after successful replace/remove to refresh the same message.
async function rerenderWeeklyPlan(ctx) {
  const plan = await getWeeklyPlan(ctx.from.id);
  const payload = buildWeeklyPlanMessage(plan);
  if (!payload) {
    // [RU] Явно обнуляем reply_markup: без этого Telegram оставит прежнюю
    // клавиатуру с edit/remove-кнопками от последнего просмотра плана.
    // [EN] Explicit empty reply_markup — otherwise Telegram keeps the prior
    // edit/remove keyboard from the last plan render.
    return ctx.editMessageText(texts.weeklyPlan.empty, {
      reply_markup: { inline_keyboard: [] }
    }).catch(err => {
      if (err.description && err.description.includes('message is not modified')) return;
      throw err;
    });
  }
  return ctx.editMessageText(payload.text, {
    parse_mode: 'HTML',
    reply_markup: payload.reply_markup
  }).catch(err => {
    if (err.description && err.description.includes('message is not modified')) return;
    throw err;
  });
}

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
  await ctx.answerCbQuery(texts.weeklyPlan.generating);
  try {
    await generateWeeklyPlan(ctx.from.id);
    const plan = await getWeeklyPlan(ctx.from.id);
    const payload = buildWeeklyPlanMessage(plan);
    if (!payload) {
      return ctx.reply(texts.weeklyPlan.generated);
    }
    await ctx.reply(texts.weeklyPlan.generated);
    await ctx.reply(payload.text, {
      parse_mode: 'HTML',
      reply_markup: payload.reply_markup
    });
  } catch (error) {
    logger.error('Error generating weekly plan:', error);
    // [RU] Специализированная подсказка при «пустой категории после исключений».
    // [EN] Specialized hint for the "no recipes after exclusions" case.
    if (error instanceof EmptyCategoryError) {
      const label = CATEGORY_LABEL[error.category] || error.category;
      return ctx.reply(
        texts.weeklyPlan.noRecipesForCategory.replace('{category}', label)
      );
    }
    await ctx.reply(texts.weeklyPlan.errorGenerate);
  }
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
  const clearedMsg = texts.weeklyPlan.cleared.replace('{date}', date);
  try {
    await clearDailyPlan(ctx.from.id, date);
    // [RU] editMessageText до answerCbQuery: иначе второй answer в catch
    // попадёт на уже закрытый query и вызовет unhandled rejection.
    // [EN] Edit before answerCbQuery — otherwise a fallback answer inside
    // catch would hit an already-answered query and throw.
    await ctx.editMessageText(clearedMsg).catch(err => {
      if (err.description && err.description.includes('message is not modified')) return;
      throw err;
    });
    await ctx.answerCbQuery(clearedMsg);
  } catch (error) {
    logger.error('Error clearing daily plan:', error);
    await ctx.answerCbQuery(texts.weeklyPlan.errorClear).catch(() => {});
  }
});

bot.action(/^cancel_clear_day_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery(texts.confirm.canceled);
  try {
    await rerenderWeeklyPlan(ctx);
  } catch (error) {
    logger.error('Error restoring plan after cancel:', error);
  }
});

bot.action(/^edit_slot_(\d{4}-\d{2}-\d{2})_(\d+)$/, async (ctx) => {
  const date = ctx.match[1];
  const slot = Number(ctx.match[2]);
  await ctx.answerCbQuery();
  await showReplacementSuggestion(ctx, date, slot);
});

bot.action(/^replace_now_(\d{4}-\d{2}-\d{2})_(\d+)_(\d+)$/, async (ctx) => {
  const date = ctx.match[1];
  const slot = Number(ctx.match[2]);
  const recipeId = Number(ctx.match[3]);
  try {
    await replaceInSlot(ctx.from.id, date, slot, recipeId);
    await ctx.answerCbQuery(texts.dishSelection.replaced);
    await rerenderWeeklyPlan(ctx);
  } catch (error) {
    logger.error('Error replacing slot:', error);
    await ctx.answerCbQuery(texts.editSlot.errorReplace).catch(() => {});
  }
});

bot.action(/^cancel_edit_(\d{4}-\d{2}-\d{2})_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery(texts.confirm.canceled);
  try {
    await rerenderWeeklyPlan(ctx);
  } catch (error) {
    logger.error('Error restoring plan after cancel-edit:', error);
  }
});

bot.action(/^confirm_remove_slot_(\d{4}-\d{2}-\d{2})_(\d+)$/, async (ctx) => {
  const date = ctx.match[1];
  const slot = Number(ctx.match[2]);
  await ctx.answerCbQuery();
  try {
    const plan = await getWeeklyPlan(ctx.from.id);
    const item = plan.find(p => p.date === date && p.slot === slot);
    const dishName = item?.name || '';
    const prompt = texts.editSlot.confirmRemove
      .replace('{name}', dishName)
      .replace('{date}', date);
    await ctx.editMessageText(prompt, {
      reply_markup: buildRemoveSlotConfirmKeyboard(date, slot)
    });
  } catch (error) {
    logger.error('Error showing remove-slot confirmation:', error);
  }
});

bot.action(/^do_remove_slot_(\d{4}-\d{2}-\d{2})_(\d+)$/, async (ctx) => {
  const date = ctx.match[1];
  const slot = Number(ctx.match[2]);
  try {
    await removeSlot(ctx.from.id, date, slot);
    await ctx.answerCbQuery(texts.editSlot.removed);
    await rerenderWeeklyPlan(ctx);
  } catch (error) {
    logger.error('Error removing slot:', error);
    await ctx.answerCbQuery(texts.editSlot.errorRemove).catch(() => {});
  }
});

bot.action(/^cancel_remove_slot_(\d{4}-\d{2}-\d{2})_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery(texts.confirm.canceled);
  try {
    await rerenderWeeklyPlan(ctx);
  } catch (error) {
    logger.error('Error restoring plan after cancel-remove:', error);
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
    // [RU] Editим раньше answerCbQuery, чтобы catch мог безопасно ответить
    // об ошибке, если edit упал уже после закрытого query.
    // [EN] Edit before answerCbQuery so the error-path answer can't hit
    // an already-answered query.
    await ctx.editMessageText(texts.shoppingList.empty, getShoppingListKeyboard())
      .catch(err => {
        if (err.description && err.description.includes('message is not modified')) return;
        throw err;
      });
    await ctx.answerCbQuery(texts.shoppingList.cleared);
  } catch (error) {
    logger.error('Error clearing shopping list:', error);
    await ctx.answerCbQuery(texts.shoppingList.errorClear).catch(() => {});
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

bot.hears(texts.mainMenu.buttons.reverseSearch, async (ctx) => {
  try {
    await ctx.scene.enter(REVERSE_SCENE_ID);
  } catch (error) {
    logger.error('Error entering reverse-search scene:', error);
    await ctx.reply(texts.errors.general);
  }
});

bot.action('reverse_retry', async (ctx) => {
  await ctx.answerCbQuery();
  try {
    await ctx.scene.enter(REVERSE_SCENE_ID);
  } catch (error) {
    logger.error('Error re-entering reverse-search scene:', error);
    await ctx.reply(texts.errors.general);
  }
});

bot.action(/^reverse_show_(\d+)$/, async (ctx) => {
  const recipeId = parseInt(ctx.match[1], 10);
  await ctx.answerCbQuery();
  try {
    const inventory = ctx.session?.reverseInventory;
    if (!Array.isArray(inventory) || inventory.length === 0) {
      return ctx.reply(texts.reverseSearch.sessionExpired);
    }
    const recipe = await getRecipeById(recipeId);
    if (!recipe) {
      return ctx.reply(texts.errors.general);
    }
    const ingredients = await getRecipeIngredients(recipeId);
    const inventorySet = new Set(inventory);
    const missing = ingredients
      .map(i => i.name)
      .filter(name => !inventorySet.has(name));
    const card = buildReverseRecipeCard(recipe, ingredients, missing);
    await ctx.editMessageText(card.text, { parse_mode: 'HTML', ...card.keyboard })
      .catch(err => {
        if (err.description && err.description.includes('message is not modified')) return;
        throw err;
      });
  } catch (error) {
    logger.error('Error showing reverse-search recipe card:', error);
    await ctx.reply(texts.errors.general);
  }
});

bot.action('reverse_back_to_list', async (ctx) => {
  await ctx.answerCbQuery();
  try {
    const inventory = ctx.session?.reverseInventory;
    if (!Array.isArray(inventory) || inventory.length === 0) {
      return ctx.reply(texts.reverseSearch.sessionExpired);
    }
    const targets = await getUserTargets(ctx.from.id);
    const recipes = await findRecipesByInventory(inventory, targets);
    const payload = buildResultsMessage(recipes, []);
    if (!payload) {
      return ctx.editMessageText(texts.reverseSearch.noResults)
        .catch(err => {
          if (err.description && err.description.includes('message is not modified')) return;
          throw err;
        });
    }
    await ctx.editMessageText(payload.text, { parse_mode: 'HTML', ...payload.keyboard })
      .catch(err => {
        if (err.description && err.description.includes('message is not modified')) return;
        throw err;
      });
  } catch (error) {
    logger.error('Error restoring reverse-search list:', error);
    await ctx.reply(texts.errors.general);
  }
});

bot.hears(texts.mainMenu.buttons.settings, async (ctx) => {
  try {
    const profile = await getUserProfile(ctx.from.id);
    await sendProfileMenu(ctx, profile);
  } catch (error) {
    logger.error('Error loading profile:', error);
    await ctx.reply(texts.errors.general);
  }
});

bot.action('profile_start', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.scene.enter(PROFILE_SCENE_ID);
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
