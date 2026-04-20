const { Markup } = require('telegraf');
const texts = require('../bot/texts');
const { getRandomRecipeByCategory, getRecipeIngredients } = require('../features/meal-suggestions/logic');

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

/**
 * Показывает случайный рецепт из категории
 * @param {object} ctx
 * @param {string} category
 */
async function showDishSuggestion(ctx, category) {
  try {
    const recipe = await getRandomRecipeByCategory(category);
    if (!recipe) {
      return ctx.reply('Рецепты в этой категории не найдены.');
    }

    const ingredients = await getRecipeIngredients(recipe.id);
    let ingredientText = ingredients.map(i => `- ${i.name}: ${i.amount} ${i.unit}`).join('\n');

    const message = `<b>${recipe.name}</b>\n\n` +
      `КБЖУ: ${recipe.calories} / ${recipe.protein} / ${recipe.fat} / ${recipe.carbs}\n\n` +
      `<b>Ингредиенты:</b>\n${ingredientText}\n\n` +
      `<b>Рецепт:</b>\n${recipe.description || 'Описание отсутствует'}`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(texts.dishSelection.nextOption, `select_cat_${category}`)],
      [Markup.button.callback(texts.dishSelection.select, `confirm_dish_${recipe.id}`)],
      [Markup.button.callback(texts.dishSelection.back, 'back_to_categories')]
    ]);

    if (ctx.updateType === 'callback_query') {
      await ctx.editMessageText(message, { parse_mode: 'HTML', ...keyboard });
    } else {
      await ctx.reply(message, { parse_mode: 'HTML', ...keyboard });
    }
  } catch (error) {
    console.error(error);
    await ctx.reply(texts.errors.general);
  }
}

module.exports = {
  sendCategorySelection,
  showDishSuggestion
};
