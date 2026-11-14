const texts = require('../texts');
const logger = require('../../utils/logger');
const { safeEdit } = require('./helpers');
const { getUserClock } = require('../../features/time-zone/logic');
const {
  sendCategorySelection,
  showDishSuggestion,
  buildReplaceQuestion,
  buildTodaySummary
} = require('../../interface/dish-selection');
const { replaceInSlot } = require('../../features/weekly-planner/logic');
const { getDayPlan, placeDishToday } = require('../../features/weekly-planner/day-plan');
const { getUserProfile } = require('../../features/profile/logic');

const T = texts.dishSelection;

/**
 * Sends (or edits into) the short summary of today's plan.
 * @param {import('telegraf').Context} ctx
 * @param {'added'|'replaced'|'unchanged'} status
 * @param {string} date - YYYY-MM-DD, the user's local today
 * @param {{edit?: boolean}} [options]
 */
async function showTodaySummary(ctx, status, date, { edit = false } = {}) {
  const items = await getDayPlan(ctx.from.id, date);
  const profile = await getUserProfile(ctx.from.id);
  const { text, extra } = buildTodaySummary({
    statusText: T[status] || T.added,
    date,
    items,
    targetCalories: profile ? profile.target_calories : null
  });
  if (edit) await safeEdit(ctx, text, extra);
  else await ctx.reply(text, extra);
}

/**
 * "✅ Select" on a recipe card (dish selection and reverse search).
 *
 * [RU] placeDishToday проверяет занятость до записи: свободный слот —
 * сохраняем, блюдо уже в плане — «уже в плане», все слоты категории
 * заняты — спрашиваем «заменить?» вместо молчаливой перезаписи.
 * [EN] placeDishToday checks occupancy before writing: a free slot is saved,
 * an already planned dish reports "unchanged", and when every slot of the
 * category is taken the user is asked "replace?" instead of an overwrite.
 *
 * @param {import('telegraf').Context} ctx
 */
async function handleConfirmDish(ctx) {
  try {
    const { today } = await getUserClock(ctx.from.id);
    const { status, date, placement } = await placeDishToday(ctx.from.id, Number(ctx.match[1]), today);
    if (status === 'missing') {
      await ctx.answerCbQuery(T.errorSave);
      return;
    }
    if (status === 'conflict') {
      await ctx.answerCbQuery();
      const { text, extra } = buildReplaceQuestion(placement, date);
      await ctx.reply(text, extra);
      return;
    }
    await ctx.answerCbQuery(T[status] || T.added);
    await showTodaySummary(ctx, status, date);
  } catch (error) {
    logger.error('Error saving dish:', error);
    await ctx.answerCbQuery(T.errorSave).catch(() => {});
  }
}

/**
 * "Yes, replace" in the replace question: swaps the dish in the chosen slot
 * and turns the question into today's summary. A question left over from a
 * previous day (in the user's time zone) is not applied.
 * @param {import('telegraf').Context} ctx
 */
async function handleSwap(ctx) {
  const [, date, slot, recipeId] = ctx.match;
  try {
    if (date !== (await getUserClock(ctx.from.id)).today) {
      await safeEdit(ctx, T.stale);
      await ctx.answerCbQuery(T.stale);
      return;
    }
    await replaceInSlot(ctx.from.id, date, Number(slot), Number(recipeId));
    await showTodaySummary(ctx, 'replaced', date, { edit: true });
    await ctx.answerCbQuery(T.replaced);
  } catch (error) {
    logger.error('Error replacing dish from selection:', error);
    await ctx.answerCbQuery(T.errorSave).catch(() => {});
  }
}

/**
 * Registers "random dish by category → add to today's plan" handlers.
 * @param {import('telegraf').Telegraf} bot
 */
function register(bot) {
  bot.hears(texts.mainMenu.buttons.suggestions, (ctx) => sendCategorySelection(ctx));

  bot.action(/^select_cat_(.+)$/, (ctx) => showDishSuggestion(ctx, ctx.match[1]));

  bot.action('back_to_categories', (ctx) => sendCategorySelection(ctx));

  bot.action(/^confirm_dish_(\d+)$/, handleConfirmDish);

  bot.action(/^dish_swap_(\d{4}-\d{2}-\d{2})_(\d)_(\d+)$/, handleSwap);

  bot.action('dish_keep', async (ctx) => {
    await ctx.answerCbQuery(texts.confirm.canceled);
    try {
      await safeEdit(ctx, T.kept);
    } catch (error) {
      logger.error('Error closing the replace question:', error);
    }
  });
}

module.exports = { register };
