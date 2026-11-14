const { Markup } = require('telegraf');
const texts = require('../bot/texts');
const logger = require('../utils/logger');
const { getRandomRecipeByCategory, getRecipeIngredients } = require('../features/meal-suggestions/logic');
const { categoryForSlot } = require('../features/weekly-planner/logic');
const { getPrefsByTelegramId } = require('../features/ingredient-prefs/logic');
const { formatNutrition, formatIngredientsHeader, slotLabel } = require('../utils/formatters');
const { formatPlanDate, formatPlanItem } = require('./plan-day');

/**
 * Sends (or edits into) the category picker.
 * @param {object} ctx
 */
async function sendCategorySelection(ctx) {
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(texts.categories.breakfast, 'select_cat_breakfast')],
    [Markup.button.callback(texts.categories.main, 'select_cat_main')],
    [Markup.button.callback(texts.categories.salad, 'select_cat_salads')],
    [Markup.button.callback(texts.categories.dessert, 'select_cat_desserts')]
  ]);

  const text = texts.dishSelection.title;
  if (ctx.updateType === 'callback_query') {
    await ctx.editMessageText(text, keyboard);
  } else {
    await ctx.reply(text, keyboard);
  }
}

async function _buildRecipeCard(recipe) {
  const ingredients = await getRecipeIngredients(recipe.id);
  const ingredientText = ingredients
    .map(i => `- ${i.name}: ${i.amount} ${i.unit}`)
    .join('\n');
  return `<b>${recipe.name}</b>\n\n` +
    `${formatNutrition(recipe)}\n\n` +
    `<b>${formatIngredientsHeader(recipe.servings)}</b>\n${ingredientText}\n\n` +
    `<b>${texts.recipeCard.recipeLabel}</b>\n${recipe.description || texts.recipeCard.noDescription}`;
}

async function _sendOrEditCard(ctx, message, keyboard) {
  const extra = { parse_mode: 'HTML', ...keyboard };
  if (ctx.updateType === 'callback_query') {
    await ctx.editMessageText(message, extra);
  } else {
    await ctx.reply(message, extra);
  }
}

/**
 * Shows a random recipe from the category ("pick a dish for the plan" flow).
 * @param {object} ctx
 * @param {string} category
 */
async function showDishSuggestion(ctx, category) {
  try {
    const prefs = await getPrefsByTelegramId(ctx.from.id);
    const recipe = await getRandomRecipeByCategory(category, { prefs });
    if (!recipe) {
      return ctx.reply(texts.editSlot.noRecipesInCategory);
    }
    const message = await _buildRecipeCard(recipe);
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(texts.dishSelection.nextOption, `select_cat_${category}`)],
      [Markup.button.callback(texts.dishSelection.select, `confirm_dish_${recipe.id}`)],
      [Markup.button.callback(texts.foodLog.ateBtn, `fl_eat_${recipe.id}`)],
      [Markup.button.callback(texts.dishSelection.back, 'back_to_categories')]
    ]);
    await _sendOrEditCard(ctx, message, keyboard);
  } catch (error) {
    logger.error('Error showing dish suggestion:', error);
    await ctx.reply(texts.errors.general);
  }
}

/**
 * Shows a random replacement recipe for a specific plan slot ("edit a meal"
 * flow). The category is derived from the slot, so callback_data carries
 * only date and slot.
 *
 * @param {object} ctx
 * @param {string} date - YYYY-MM-DD
 * @param {number} slot
 */
async function showReplacementSuggestion(ctx, date, slot) {
  try {
    const category = categoryForSlot(slot);
    const prefs = await getPrefsByTelegramId(ctx.from.id);
    const recipe = await getRandomRecipeByCategory(category, { prefs });
    if (!recipe) {
      return ctx.reply(texts.editSlot.noRecipesInCategory);
    }
    const card = await _buildRecipeCard(recipe);
    const hint = texts.editSlot.replaceHint.replace('{date}', formatPlanDate(date));
    const message = `<i>${hint}</i>\n\n${card}`;
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(texts.dishSelection.nextOption, `edit_slot_${date}_${slot}`)],
      [Markup.button.callback(texts.editSlot.replaceNow, `replace_now_${date}_${slot}_${recipe.id}`)],
      [Markup.button.callback(texts.editSlot.backToPlan, `cancel_edit_${date}_${slot}`)]
    ]);
    await _sendOrEditCard(ctx, message, keyboard);
  } catch (error) {
    logger.error('Error showing replacement suggestion:', error);
    await ctx.reply(texts.errors.general);
  }
}

/**
 * Builds the "slot is taken — replace?" question shown before overwriting
 * a dish in today's plan. One occupied slot → Yes/No; both main slots taken
 * → one "instead of X" button per slot plus No.
 *
 * @param {{recipe: {id: number, name: string},
 *   occupied: Array<{slot: number, name: string}>}} placement - non-empty occupied
 * @param {string} date - YYYY-MM-DD the question is about (today)
 * @returns {{text: string, extra: object}}
 */
function buildReplaceQuestion({ recipe, occupied }, date) {
  const T = texts.dishSelection;
  const swap = (slot) => `dish_swap_${date}_${slot}_${recipe.id}`;
  let text;
  let rows;
  if (occupied.length === 1) {
    const [current] = occupied;
    text = T.replaceAsk
      .replace('{slot}', slotLabel(current.slot))
      .replace('{old}', current.name)
      .replace('{new}', recipe.name);
    rows = [[Markup.button.callback(T.replaceYes, swap(current.slot))]];
  } else {
    text = T.replaceAskMain.replace('{new}', recipe.name);
    rows = occupied.map(item => [
      Markup.button.callback(T.replaceOption.replace('{name}', item.name), swap(item.slot))
    ]);
  }
  rows.push([Markup.button.callback(T.keepBtn, 'dish_keep')]);
  return { text, extra: Markup.inlineKeyboard(rows) };
}

/**
 * Builds the short "today's plan" summary shown after a dish is added:
 * status line, today's dishes with kcal and the day total (vs the calorie
 * target when the profile is filled).
 *
 * @param {{statusText: string, date: string,
 *   items: Array<{slot: number, name: string, calories: number}>,
 *   targetCalories: number|null}} view
 * @returns {{text: string, extra: object}}
 */
function buildTodaySummary({ statusText, date, items, targetCalories }) {
  const T = texts.dishSelection;
  const kcal = Math.round(items.reduce((sum, item) => sum + (Number(item.calories) || 0), 0));
  const total = targetCalories
    ? T.summaryTotalTarget.replace('{kcal}', kcal).replace('{target}', targetCalories)
    : T.summaryTotal.replace('{kcal}', kcal);
  const lines = [statusText, '', T.summaryTitle, ...items.map(item => `• ${formatPlanItem(item)}`), total];
  const keyboard = Markup.inlineKeyboard([[
    Markup.button.callback(T.moreBtn, 'back_to_categories'),
    Markup.button.callback(T.openDayBtn, `wp_day_${date}`)
  ]]);
  return { text: lines.join('\n'), extra: { parse_mode: 'HTML', ...keyboard } };
}

module.exports = {
  buildReplaceQuestion,
  buildTodaySummary,
  sendCategorySelection,
  showDishSuggestion,
  showReplacementSuggestion
};
