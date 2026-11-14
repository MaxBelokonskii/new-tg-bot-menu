const texts = require('../texts');
const logger = require('../../utils/logger');
const { safeEdit } = require('./helpers');
const { getSuggestions, logCombo } = require('../../features/what-to-eat/logic');
const { addEntry, portionFromHalves } = require('../../features/food-log/logic');
const { placeDishToday } = require('../../features/weekly-planner/day-plan');
const { buildReplaceQuestion } = require('../../interface/dish-selection');
const { getPrefsByTelegramId } = require('../../features/ingredient-prefs/logic');
const { buildSuggestionsScreen } = require('../../interface/what-to-eat');
const { getUserClock } = require('../../features/time-zone/logic');

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
  const { today, hour } = await getUserClock(ctx.from.id);
  const result = await getSuggestions(ctx.from.id, { today, hour, page });
  if (result.status === 'noTargets') {
    await ctx.answerCbQuery(T.noTargets, { show_alert: true });
    return;
  }
  await ctx.answerCbQuery(toast);
  const { text, extra } = buildSuggestionsScreen(result, await getPrefsByTelegramId(ctx.from.id), today);
  await safeEdit(ctx, text, extra);
}

/**
 * Sends the "slot is taken — replace?" question as a new message, so the
 * suggestions screen stays in place.
 * @param {import('telegraf').Context} ctx
 * @param {{date: string, placement: object}} result - placeDishToday result
 */
async function askReplace(ctx, { date, placement }) {
  const { text, extra } = buildReplaceQuestion(placement, date);
  await ctx.reply(text, extra);
}

/**
 * Summarises a combo "to plan" as one toast: added / already planned / asked.
 * @param {Array<{status: string}>} results
 * @returns {string}
 */
function comboPlanToast(results) {
  const count = (pred) => results.filter(r => pred(r.status)).length;
  const added = count(s => s === 'added' || s === 'replaced');
  const parts = [T.comboPlanned.replace('{count}', added)];
  const already = count(s => s === 'unchanged');
  const asked = count(s => s === 'conflict');
  if (already) parts.push(T.comboAlready.replace('{count}', already));
  if (asked) parts.push(T.comboAsked.replace('{count}', asked));
  return parts.join(T.toastJoin);
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
    const { today } = await getUserClock(ctx.from.id);
    const id = await addEntry(ctx.from.id, { recipeId: Number(ctx.match[1]), portion, date: today });
    await showSuggestions(ctx, 0, id ? T.eaten : texts.foodLog.recipeNotFound);
  }));

  bot.action(COMBO_EAT, guarded('logging combo', async (ctx) => {
    const items = ctx.match[1].split('-').map(part => {
      const [recipeId, halves] = part.split('x').map(Number);
      return { recipeId, portion: portionFromHalves(halves) };
    });
    const count = await logCombo(ctx.from.id, items, (await getUserClock(ctx.from.id)).today);
    await showSuggestions(ctx, 0, T.comboEaten.replace('{count}', count));
  }));

  bot.action(/^wte_plan_(\d+)$/, guarded('adding to plan', async (ctx) => {
    const { today } = await getUserClock(ctx.from.id);
    const result = await placeDishToday(ctx.from.id, Number(ctx.match[1]), today);
    if (result.status === 'conflict') {
      await ctx.answerCbQuery();
      await askReplace(ctx, result);
      return;
    }
    const DS = texts.dishSelection;
    await ctx.answerCbQuery(result.status === 'missing'
      ? texts.foodLog.recipeNotFound
      : (DS[result.status] || DS.added));
  }));

  bot.action(COMBO_PLAN, guarded('adding combo to plan', async (ctx) => {
    const ids = ctx.match[1].split('-').map(Number);
    const { today } = await getUserClock(ctx.from.id);
    const results = [];
    // [RU] Последовательно: блюдо из комбинации может занять слот для следующего.
    // [EN] Sequential: one combo dish may take the slot the next one needs.
    for (const id of ids) results.push(await placeDishToday(ctx.from.id, id, today));
    await ctx.answerCbQuery(comboPlanToast(results));
    for (const result of results.filter(r => r.status === 'conflict')) await askReplace(ctx, result);
  }));
}

module.exports = { register };
