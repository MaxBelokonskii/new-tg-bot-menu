const texts = require('../texts');
const logger = require('../../utils/logger');
const { safeEdit } = require('./helpers');
const { formatLocalDate } = require('../../utils/date-helpers');
const {
  sendCategorySelection,
  showDishSuggestion,
  buildReplaceQuestion,
  buildTodaySummary
} = require('../../interface/dish-selection');
const { saveSelectedDish, replaceInSlot } = require('../../features/weekly-planner/logic');
const { getDayPlan, checkDishPlacement } = require('../../features/weekly-planner/day-plan');
const { getUserProfile } = require('../../features/profile/logic');

const T = texts.dishSelection;
const today = () => formatLocalDate(new Date());

/**
 * Sends (or edits into) the short summary of today's plan.
 * @param {import('telegraf').Context} ctx
 * @param {'added'|'replaced'|'unchanged'} status
 * @param {{edit?: boolean}} [options]
 */
async function showTodaySummary(ctx, status, { edit = false } = {}) {
  const date = today();
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
 * [RU] Занятость слота проверяется до записи: свободный слот — сохраняем
 * через saveSelectedDish (контракт {slot, status} не меняется), блюдо уже
 * в плане — «уже в плане», все слоты категории заняты — спрашиваем
 * «заменить?» вместо молчаливой перезаписи.
 * [EN] Slot occupancy is checked before writing: a free slot is saved via
 * saveSelectedDish (its {slot, status} contract is unchanged), an already
 * planned dish reports "unchanged", and when every slot of the category is
 * taken the user is asked "replace?" instead of a silent overwrite.
 *
 * @param {import('telegraf').Context} ctx
 */
async function handleConfirmDish(ctx) {
  const recipeId = Number(ctx.match[1]);
  const date = today();
  try {
    const placement = await checkDishPlacement(ctx.from.id, recipeId, date);
    if (!placement) {
      await ctx.answerCbQuery(T.errorSave);
      return;
    }
    if (placement.alreadyPlanned) {
      await ctx.answerCbQuery(T.unchanged);
      await showTodaySummary(ctx, 'unchanged');
      return;
    }
    if (placement.freeSlot === null) {
      await ctx.answerCbQuery();
      const { text, extra } = buildReplaceQuestion(placement, date);
      await ctx.reply(text, extra);
      return;
    }
    const { status } = await saveSelectedDish(ctx.from.id, recipeId);
    await ctx.answerCbQuery(T[status] || T.added);
    await showTodaySummary(ctx, status);
  } catch (error) {
    logger.error('Error saving dish:', error);
    await ctx.answerCbQuery(T.errorSave).catch(() => {});
  }
}

/**
 * "Yes, replace" in the replace question: swaps the dish in the chosen slot
 * and turns the question into today's summary. A question left over from a
 * previous day is not applied.
 * @param {import('telegraf').Context} ctx
 */
async function handleSwap(ctx) {
  const [, date, slot, recipeId] = ctx.match;
  try {
    if (date !== today()) {
      await safeEdit(ctx, T.stale);
      await ctx.answerCbQuery(T.stale);
      return;
    }
    await replaceInSlot(ctx.from.id, date, Number(slot), Number(recipeId));
    await showTodaySummary(ctx, 'replaced', { edit: true });
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
