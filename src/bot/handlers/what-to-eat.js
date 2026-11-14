const texts = require('../texts');
const logger = require('../../utils/logger');
const { safeEdit } = require('./helpers');
const { getSuggestions, logCombo } = require('../../features/what-to-eat/logic');
const { addEntry, portionFromHalves } = require('../../features/food-log/logic');
const { saveSelectedDish } = require('../../features/weekly-planner/logic');
const { getPrefsByTelegramId } = require('../../features/ingredient-prefs/logic');
const { buildSuggestionsScreen } = require('../../interface/what-to-eat');

const T = texts.whatToEat;
// [RU] 2–3 блюда в комбинации, порция — число половинок 1..4 (как в дневнике).
// [EN] 2–3 dishes per combo, portion as halves 1..4 (as in the diary).
const COMBO_EAT = /^wte_eatc_(\d+x[1-4](?:-\d+x[1-4]){1,2})$/;
const COMBO_PLAN = /^wte_planc_(\d+(?:-\d+){1,2})$/;
const MAX_PAGE = 50;

/**
 * Renders the suggestions page in place; "noTargets" is an alert instead.
 * @param {import('telegraf').Context} ctx
 * @param {number} page
 * @param {string} [toast] - callback answer text
 */
async function showSuggestions(ctx, page, toast) {
  const result = await getSuggestions(ctx.from.id, { page });
  if (result.status === 'noTargets') {
    await ctx.answerCbQuery(T.noTargets, { show_alert: true });
    return;
  }
  await ctx.answerCbQuery(toast);
  const { text, extra } = buildSuggestionsScreen(result, await getPrefsByTelegramId(ctx.from.id));
  await safeEdit(ctx, text, extra);
}

function guarded(label, fn) {
  return async (ctx) => {
    try {
      await fn(ctx);
    } catch (error) {
      logger.error(`What to eat: error ${label}:`, error);
      await ctx.answerCbQuery(T.errorSave).catch(() => {});
    }
  };
}

/**
 * Registers "what else to eat today" handlers (opened from the diary screen).
 * @param {import('telegraf').Telegraf} bot
 */
function register(bot) {
  bot.action(/^wte_show_(\d+)$/, guarded('showing suggestions', (ctx) => (
    showSuggestions(ctx, Math.min(Number(ctx.match[1]), MAX_PAGE))
  )));

  bot.action(/^wte_eat_(\d+)_([1-4])$/, guarded('logging dish', async (ctx) => {
    const portion = portionFromHalves(Number(ctx.match[2]));
    const id = await addEntry(ctx.from.id, { recipeId: Number(ctx.match[1]), portion });
    await showSuggestions(ctx, 0, id ? T.eaten : texts.foodLog.recipeNotFound);
  }));

  bot.action(COMBO_EAT, guarded('logging combo', async (ctx) => {
    const items = ctx.match[1].split('-').map(part => {
      const [recipeId, halves] = part.split('x').map(Number);
      return { recipeId, portion: portionFromHalves(halves) };
    });
    const count = await logCombo(ctx.from.id, items);
    await showSuggestions(ctx, 0, T.comboEaten.replace('{count}', count));
  }));

  bot.action(/^wte_plan_(\d+)$/, guarded('adding to plan', async (ctx) => {
    const { status } = await saveSelectedDish(ctx.from.id, Number(ctx.match[1]));
    await ctx.answerCbQuery(texts.dishSelection[status] || texts.dishSelection.added);
  }));

  bot.action(COMBO_PLAN, guarded('adding combo to plan', async (ctx) => {
    const ids = ctx.match[1].split('-').map(Number);
    for (const id of ids) await saveSelectedDish(ctx.from.id, id);
    await ctx.answerCbQuery(T.comboPlanned.replace('{count}', ids.length));
  }));
}

module.exports = { register };
