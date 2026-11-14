const { Scenes } = require('telegraf');
const texts = require('../../bot/texts');
const logger = require('../../utils/logger');
const { formatLocalDate } = require('../../utils/date-helpers');
const { isDiaryDate, isSearchQuery, searchRecipes } = require('./logic');
const { buildSearchResults } = require('../../interface/food-log-pickers');
const { escapable } = require('../../bot/scene-escape');

const SCENE_ID = 'food_log_search';
const T = texts.foodLog.search;

/**
 * Runs the search for the typed query. Stays in the scene when nothing is
 * found so the user can retype; leaves after showing the results.
 * @param {import('telegraf').Context} ctx
 */
async function handleQuery(ctx) {
  const query = ctx.message?.text;
  if (typeof query !== 'string') {
    await ctx.reply(T.useText);
    return;
  }
  if (!isSearchQuery(query)) {
    await ctx.reply(T.tooShort);
    return;
  }
  try {
    const { recipes, total } = await searchRecipes(query);
    if (recipes.length === 0) {
      await ctx.reply(T.notFound.replace('{query}', query.trim()));
      return;
    }
    const { text, extra } = buildSearchResults(ctx.wizard.state.date, recipes, total);
    await ctx.reply(text, extra);
  } catch (error) {
    logger.error('Error searching recipes for the food log:', error);
    await ctx.reply(texts.errors.general);
  }
  await ctx.scene.leave();
}

// [RU] Дата дневника приходит в initial state (`ctx.scene.enter(SCENE_ID, { date })`).
// Любая inline-кнопка, кнопка главного меню или команда во время ожидания
// выводит из сцены и уходит обычным хэндлерам (bot/scene-escape.js).
// [EN] The diary date comes via initial state. Any inline button, main-menu
// button or command while waiting leaves the scene (bot/scene-escape.js).
const scene = new Scenes.WizardScene(
  SCENE_ID,
  async (ctx) => {
    if (!isDiaryDate(ctx.wizard.state.date)) ctx.wizard.state.date = formatLocalDate(new Date());
    await ctx.reply(T.ask);
    return ctx.wizard.next();
  },
  escapable(handleQuery)
);

scene.command('cancel', async (ctx) => {
  await ctx.reply(T.canceled);
  return ctx.scene.leave();
});

module.exports = {
  foodLogSearchScene: scene,
  SCENE_ID
};
