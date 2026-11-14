const { Scenes } = require('telegraf');
const texts = require('../../bot/texts');
const logger = require('../../utils/logger');
const { formatLocalDate } = require('../../utils/date-helpers');
const { isDiaryDate, isSearchQuery, searchRecipes } = require('./logic');
const { buildSearchResults } = require('../../interface/food-log-pickers');

const SCENE_ID = 'food_log_search';
const T = texts.foodLog.search;
const MAIN_MENU_LABELS = new Set(Object.values(texts.mainMenu.buttons));

/**
 * True when the update should leave the search and be routed by the regular
 * handlers: any button press, a main-menu button or a command other than /cancel.
 * @param {import('telegraf').Context} ctx
 * @returns {boolean}
 */
function isEscapeUpdate(ctx) {
  if (ctx.callbackQuery) return true;
  const text = ctx.message?.text;
  return typeof text === 'string' && (MAIN_MENU_LABELS.has(text) || text.startsWith('/'));
}

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
// Нажатие любой кнопки или кнопки главного меню во время ожидания выводит из
// сцены и передаёт апдейт обычным хэндлерам (next) — иначе сцена «глотала» бы
// навигацию. Повторного входа по кругу нет: при входе сцена прогоняет callback
// только через шаг 0.
// [EN] The diary date comes via initial state. Any button press or main-menu
// button while waiting leaves the scene and passes the update on (next) —
// otherwise the scene would swallow navigation. No re-entry loop: on enter
// the scene runs the entering callback through step 0 only.
const scene = new Scenes.WizardScene(
  SCENE_ID,
  async (ctx) => {
    if (!isDiaryDate(ctx.wizard.state.date)) ctx.wizard.state.date = formatLocalDate(new Date());
    await ctx.reply(T.ask);
    return ctx.wizard.next();
  },
  async (ctx, next) => {
    if (isEscapeUpdate(ctx)) {
      await ctx.scene.leave();
      return next();
    }
    return handleQuery(ctx);
  }
);

scene.command('cancel', async (ctx) => {
  await ctx.reply(T.canceled);
  return ctx.scene.leave();
});

module.exports = {
  foodLogSearchScene: scene,
  SCENE_ID
};
