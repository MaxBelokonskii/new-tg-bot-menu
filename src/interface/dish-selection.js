const { Markup } = require('telegraf');
const texts = require('../bot/texts');
const logger = require('../utils/logger');
const { getRandomRecipeByCategory, getRecipeIngredients } = require('../features/meal-suggestions/logic');
const { categoryForSlot } = require('../features/weekly-planner/logic');

/**
 * Отправляет меню выбора категорий
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
    `КБЖУ: ${recipe.calories} / ${recipe.protein} / ${recipe.fat} / ${recipe.carbs}\n\n` +
    `<b>Ингредиенты:</b>\n${ingredientText}\n\n` +
    `<b>Рецепт:</b>\n${recipe.description || 'Описание отсутствует'}`;
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
 * Показывает случайный рецепт из категории (поток «выбор блюда в рацион»).
 * @param {object} ctx
 * @param {string} category
 */
async function showDishSuggestion(ctx, category) {
  try {
    const recipe = await getRandomRecipeByCategory(category);
    if (!recipe) {
      return ctx.reply(texts.editSlot.noRecipesInCategory);
    }
    const message = await _buildRecipeCard(recipe);
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(texts.dishSelection.nextOption, `select_cat_${category}`)],
      [Markup.button.callback(texts.dishSelection.select, `confirm_dish_${recipe.id}`)],
      [Markup.button.callback(texts.dishSelection.back, 'back_to_categories')]
    ]);
    await _sendOrEditCard(ctx, message, keyboard);
  } catch (error) {
    logger.error('Error showing dish suggestion:', error);
    await ctx.reply(texts.errors.general);
  }
}

/**
 * Показывает случайный рецепт для замены конкретного слота в плане
 * (поток «редактирование приёма пищи»). Категория вычисляется из слота,
 * так что callback_data содержит только date и slot.
 *
 * @param {object} ctx
 * @param {string} date - YYYY-MM-DD
 * @param {number} slot
 */
async function showReplacementSuggestion(ctx, date, slot) {
  try {
    const category = categoryForSlot(slot);
    const recipe = await getRandomRecipeByCategory(category);
    if (!recipe) {
      return ctx.reply(texts.editSlot.noRecipesInCategory);
    }
    const card = await _buildRecipeCard(recipe);
    const hint = texts.editSlot.replaceHint.replace('{date}', date);
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

module.exports = {
  sendCategorySelection,
  showDishSuggestion,
  showReplacementSuggestion
};
