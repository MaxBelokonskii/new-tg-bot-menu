const texts = require('../texts');
const logger = require('../../utils/logger');
const { showPlanDay } = require('./plan-view');
const { showReplacementSuggestion } = require('../../interface/dish-selection');
const { formatPlanDate } = require('../../interface/plan-day');
const {
  buildClearDayConfirmKeyboard,
  buildRemoveSlotConfirmKeyboard
} = require('../../interface/weekly-plan');
const { clearDailyPlan, removeSlot, replaceInSlot } = require('../../features/weekly-planner/logic');
const { getDayPlan } = require('../../features/weekly-planner/day-plan');

const DATE = '(\\d{4}-\\d{2}-\\d{2})';
const DATE_SLOT = `${DATE}_(\\d+)`;

/**
 * Builds a "cancel → back to the plan day" handler (the date is the first
 * capture group of the callback pattern).
 * @param {string} logLabel
 */
function cancelToDay(logLabel) {
  return async (ctx) => {
    await ctx.answerCbQuery(texts.confirm.canceled);
    try {
      await showPlanDay(ctx, ctx.match[1]);
    } catch (error) {
      logger.error(`Error restoring plan day after ${logLabel}:`, error);
    }
  };
}

function registerClearDay(bot) {
  bot.action(new RegExp(`^confirm_clear_day_${DATE}$`), async (ctx) => {
    const date = ctx.match[1];
    await ctx.answerCbQuery();
    try {
      await ctx.editMessageText(
        texts.weeklyPlan.confirmClear.replace('{date}', formatPlanDate(date)),
        { reply_markup: buildClearDayConfirmKeyboard(date) }
      );
    } catch (error) {
      logger.error('Error showing clear-day confirmation:', error);
    }
  });

  bot.action(new RegExp(`^do_clear_day_${DATE}$`), async (ctx) => {
    const date = ctx.match[1];
    try {
      await clearDailyPlan(ctx.from.id, date);
      // [RU] Экран до answerCbQuery: иначе второй answer в catch попадёт на
      // уже закрытый query и вызовет unhandled rejection.
      // [EN] Render before answerCbQuery — otherwise a fallback answer inside
      // catch would hit an already-answered query and throw.
      await showPlanDay(ctx, date);
      await ctx.answerCbQuery(texts.weeklyPlan.cleared.replace('{date}', formatPlanDate(date)));
    } catch (error) {
      logger.error('Error clearing daily plan:', error);
      await ctx.answerCbQuery(texts.weeklyPlan.errorClear).catch(() => {});
    }
  });

  bot.action(new RegExp(`^cancel_clear_day_${DATE}$`), cancelToDay('cancel-clear'));
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
      await showPlanDay(ctx, date);
    } catch (error) {
      logger.error('Error replacing slot:', error);
      await ctx.answerCbQuery(texts.editSlot.errorReplace).catch(() => {});
    }
  });

  bot.action(new RegExp(`^cancel_edit_${DATE_SLOT}$`), cancelToDay('cancel-edit'));
}

function registerRemoveSlot(bot) {
  bot.action(new RegExp(`^confirm_remove_slot_${DATE_SLOT}$`), async (ctx) => {
    const date = ctx.match[1];
    const slot = Number(ctx.match[2]);
    await ctx.answerCbQuery();
    try {
      const item = (await getDayPlan(ctx.from.id, date)).find(p => p.slot === slot);
      const prompt = texts.editSlot.confirmRemove
        .replace('{name}', item?.name || '')
        .replace('{date}', formatPlanDate(date));
      await ctx.editMessageText(prompt, { reply_markup: buildRemoveSlotConfirmKeyboard(date, slot) });
    } catch (error) {
      logger.error('Error showing remove-slot confirmation:', error);
    }
  });

  bot.action(new RegExp(`^do_remove_slot_${DATE_SLOT}$`), async (ctx) => {
    const date = ctx.match[1];
    try {
      await removeSlot(ctx.from.id, date, Number(ctx.match[2]));
      await ctx.answerCbQuery(texts.editSlot.removed);
      await showPlanDay(ctx, date);
    } catch (error) {
      logger.error('Error removing slot:', error);
      await ctx.answerCbQuery(texts.editSlot.errorRemove).catch(() => {});
    }
  });

  bot.action(new RegExp(`^cancel_remove_slot_${DATE_SLOT}$`), cancelToDay('cancel-remove'));
}

/**
 * Registers plan-day editing handlers: clear day, replace and remove a dish.
 * Every action returns the user to the same plan day.
 * @param {import('telegraf').Telegraf} bot
 */
function register(bot) {
  registerClearDay(bot);
  registerEditSlot(bot);
  registerRemoveSlot(bot);
}

module.exports = { register };
