const texts = require('../texts');
const logger = require('../../utils/logger');
const { safeEdit } = require('./helpers');
const { showReplacementSuggestion } = require('../../interface/dish-selection');
const {
  sendWeeklyPlanMenu,
  buildWeeklyPlanMessage,
  buildClearDayConfirmKeyboard,
  buildRemoveSlotConfirmKeyboard
} = require('../../interface/weekly-plan');
const {
  getWeeklyPlan,
  clearDailyPlan,
  removeSlot,
  replaceInSlot,
  generateWeeklyPlan,
  EmptyCategoryError
} = require('../../features/weekly-planner/logic');

// [RU] Английские ключи категорий из БД → локализованные подписи для UI.
// [EN] DB category keys (en) → localized labels for UI.
const CATEGORY_LABEL = {
  breakfast: texts.categories.breakfast,
  main: texts.categories.main,
  salads: texts.categories.salad,
  desserts: texts.categories.dessert
};

const DATE_SLOT = '(\\d{4}-\\d{2}-\\d{2})_(\\d+)';

/**
 * Re-renders the current plan into the callback message — used by cancel
 * handlers and after successful replace/remove.
 * @param {import('telegraf').Context} ctx
 * @returns {Promise<void>}
 */
async function rerenderWeeklyPlan(ctx) {
  const plan = await getWeeklyPlan(ctx.from.id);
  const payload = buildWeeklyPlanMessage(plan);
  if (!payload) {
    // [RU] Явно обнуляем reply_markup: иначе Telegram оставит прежнюю
    // клавиатуру с edit/remove-кнопками от последнего просмотра плана.
    // [EN] Explicit empty reply_markup — otherwise Telegram keeps the prior
    // edit/remove keyboard from the last plan render.
    return safeEdit(ctx, texts.weeklyPlan.empty, { reply_markup: { inline_keyboard: [] } });
  }
  return safeEdit(ctx, payload.text, { parse_mode: 'HTML', reply_markup: payload.reply_markup });
}

/**
 * Builds a "cancel → back to the plan" handler.
 * @param {string} logLabel
 */
function cancelToPlan(logLabel) {
  return async (ctx) => {
    await ctx.answerCbQuery(texts.confirm.canceled);
    try {
      await rerenderWeeklyPlan(ctx);
    } catch (error) {
      logger.error(`Error restoring plan after ${logLabel}:`, error);
    }
  };
}

async function sendPlan(ctx, plan) {
  const payload = buildWeeklyPlanMessage(plan);
  if (!payload) return ctx.reply(texts.weeklyPlan.empty);
  return ctx.reply(payload.text, { parse_mode: 'HTML', reply_markup: payload.reply_markup });
}

async function handleGenerate(ctx) {
  await ctx.answerCbQuery(texts.weeklyPlan.generating);
  try {
    await generateWeeklyPlan(ctx.from.id);
    const plan = await getWeeklyPlan(ctx.from.id);
    await ctx.reply(texts.weeklyPlan.generated);
    if (buildWeeklyPlanMessage(plan)) await sendPlan(ctx, plan);
  } catch (error) {
    logger.error('Error generating weekly plan:', error);
    // [RU] Специализированная подсказка при «пустой категории после исключений».
    // [EN] Specialized hint for the "no recipes after exclusions" case.
    if (error instanceof EmptyCategoryError) {
      const label = CATEGORY_LABEL[error.category] || error.category;
      return ctx.reply(texts.weeklyPlan.noRecipesForCategory.replace('{category}', label));
    }
    await ctx.reply(texts.weeklyPlan.errorGenerate);
  }
}

function registerClearDay(bot) {
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
      await safeEdit(ctx, clearedMsg);
      await ctx.answerCbQuery(clearedMsg);
    } catch (error) {
      logger.error('Error clearing daily plan:', error);
      await ctx.answerCbQuery(texts.weeklyPlan.errorClear).catch(() => {});
    }
  });

  bot.action(/^cancel_clear_day_(.+)$/, cancelToPlan('cancel'));
}

function registerEditSlot(bot) {
  bot.action(new RegExp(`^edit_slot_${DATE_SLOT}$`), async (ctx) => {
    await ctx.answerCbQuery();
    await showReplacementSuggestion(ctx, ctx.match[1], Number(ctx.match[2]));
  });

  bot.action(new RegExp(`^replace_now_${DATE_SLOT}_(\\d+)$`), async (ctx) => {
    const [, date, slot, recipeId] = ctx.match;
    try {
      await replaceInSlot(ctx.from.id, date, Number(slot), Number(recipeId));
      await ctx.answerCbQuery(texts.dishSelection.replaced);
      await rerenderWeeklyPlan(ctx);
    } catch (error) {
      logger.error('Error replacing slot:', error);
      await ctx.answerCbQuery(texts.editSlot.errorReplace).catch(() => {});
    }
  });

  bot.action(new RegExp(`^cancel_edit_${DATE_SLOT}$`), cancelToPlan('cancel-edit'));
}

function registerRemoveSlot(bot) {
  bot.action(new RegExp(`^confirm_remove_slot_${DATE_SLOT}$`), async (ctx) => {
    const date = ctx.match[1];
    const slot = Number(ctx.match[2]);
    await ctx.answerCbQuery();
    try {
      const plan = await getWeeklyPlan(ctx.from.id);
      const item = plan.find(p => p.date === date && p.slot === slot);
      const prompt = texts.editSlot.confirmRemove
        .replace('{name}', item?.name || '')
        .replace('{date}', date);
      await ctx.editMessageText(prompt, { reply_markup: buildRemoveSlotConfirmKeyboard(date, slot) });
    } catch (error) {
      logger.error('Error showing remove-slot confirmation:', error);
    }
  });

  bot.action(new RegExp(`^do_remove_slot_${DATE_SLOT}$`), async (ctx) => {
    try {
      await removeSlot(ctx.from.id, ctx.match[1], Number(ctx.match[2]));
      await ctx.answerCbQuery(texts.editSlot.removed);
      await rerenderWeeklyPlan(ctx);
    } catch (error) {
      logger.error('Error removing slot:', error);
      await ctx.answerCbQuery(texts.editSlot.errorRemove).catch(() => {});
    }
  });

  bot.action(new RegExp(`^cancel_remove_slot_${DATE_SLOT}$`), cancelToPlan('cancel-remove'));
}

/**
 * Registers weekly-plan handlers: view, generate, clear day, edit/remove slot.
 * @param {import('telegraf').Telegraf} bot
 */
function register(bot) {
  bot.hears(texts.mainMenu.buttons.weeklyPlan, (ctx) => sendWeeklyPlanMenu(ctx));

  bot.action('generate_weekly_plan', handleGenerate);

  bot.action('view_weekly_plan', async (ctx) => {
    await ctx.answerCbQuery();
    try {
      await sendPlan(ctx, await getWeeklyPlan(ctx.from.id));
    } catch (error) {
      logger.error('Error viewing plan:', error);
      await ctx.reply(texts.errors.general);
    }
  });

  registerClearDay(bot);
  registerEditSlot(bot);
  registerRemoveSlot(bot);
}

module.exports = { register };
