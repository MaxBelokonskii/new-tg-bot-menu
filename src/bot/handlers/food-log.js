const texts = require('../texts');
const logger = require('../../utils/logger');
const { safeEdit } = require('./helpers');
const { formatLocalDate, addDays } = require('../../utils/date-helpers');
const { sumNutrition } = require('../../utils/nutrition-totals');
const { getUserProfile } = require('../../features/profile/logic');
const { pickTargets } = require('../../features/profile/targets');
const {
  HISTORY_DAYS,
  isDiaryDate,
  portionFromHalves,
  getRecipeNutrition,
  addEntry,
  deleteEntry,
  getDayLog,
  getPlanDishes
} = require('../../features/food-log/logic');
const { SCENE_ID } = require('../../features/food-log/search-scene');
const { buildDayScreen } = require('../../interface/food-log');
const { buildPlanPicker, buildPortionPicker } = require('../../interface/food-log-pickers');

const T = texts.foodLog;
const DATE = '(\\d{4}-\\d{2}-\\d{2})';
const today = () => formatLocalDate(new Date());

/**
 * Loads the diary day and builds its screen.
 * @param {number} telegramId
 * @param {string} date - YYYY-MM-DD within the diary window
 * @returns {Promise<{text: string, extra: object}>}
 */
async function buildDayView(telegramId, date) {
  const now = today();
  const entries = await getDayLog(telegramId, date);
  const profile = await getUserProfile(telegramId);
  return buildDayScreen({
    date,
    today: now,
    oldest: addDays(now, -HISTORY_DAYS),
    entries,
    totals: sumNutrition(entries),
    targets: profile ? pickTargets(profile) : null
  });
}

async function showDay(ctx, date, { edit = true } = {}) {
  const { text, extra } = await buildDayView(ctx.from.id, date);
  if (edit) await safeEdit(ctx, text, extra);
  else await ctx.reply(text, extra);
}

/**
 * Wraps a handler with error logging and a generic error reply.
 * @param {string} label
 * @param {(ctx: import('telegraf').Context) => Promise<void>} fn
 */
function guarded(label, fn) {
  return async (ctx) => {
    try {
      await fn(ctx);
    } catch (error) {
      logger.error(`Food log: error ${label}:`, error);
      await ctx.reply(texts.errors.general);
    }
  };
}

/**
 * Validates the date from callback_data. Out-of-window dates answer the
 * callback with a notice and show today instead.
 * @returns {Promise<boolean>} true when the date is usable
 */
async function ensureDiaryDate(ctx, date) {
  if (isDiaryDate(date)) return true;
  await ctx.answerCbQuery(T.dateOutOfRange);
  await showDay(ctx, today());
  return false;
}

/**
 * Registers food diary handlers: day screen, day navigation, add from plan,
 * recipe search, portion choice, entry deletion and "🍽 Съел" from recipe cards.
 * @param {import('telegraf').Telegraf} bot
 */
function register(bot) {
  bot.hears(texts.mainMenu.buttons.foodLog, guarded('opening diary', (ctx) => (
    showDay(ctx, today(), { edit: false })
  )));

  bot.action(new RegExp(`^fl_day_${DATE}$`), guarded('showing day', async (ctx) => {
    if (!(await ensureDiaryDate(ctx, ctx.match[1]))) return;
    await ctx.answerCbQuery();
    await showDay(ctx, ctx.match[1]);
  }));

  bot.action(new RegExp(`^fl_plan_${DATE}$`), guarded('showing plan picker', async (ctx) => {
    const date = ctx.match[1];
    if (!(await ensureDiaryDate(ctx, date))) return;
    const dishes = await getPlanDishes(ctx.from.id, date);
    if (dishes.length === 0) {
      await ctx.answerCbQuery(T.plan.empty, { show_alert: true });
      return;
    }
    await ctx.answerCbQuery();
    const { text, extra } = buildPlanPicker(date, today(), dishes);
    await safeEdit(ctx, text, extra);
  }));

  bot.action(new RegExp(`^fl_search_${DATE}$`), guarded('entering search', async (ctx) => {
    const date = ctx.match[1];
    if (!(await ensureDiaryDate(ctx, date))) return;
    await ctx.answerCbQuery();
    await ctx.scene.enter(SCENE_ID, { date });
  }));

  bot.action(new RegExp(`^fl_pick_${DATE}_(\\d+)_([0-5])$`), guarded('showing portions', async (ctx) => {
    const [, date, recipeId, slot] = ctx.match;
    if (!(await ensureDiaryDate(ctx, date))) return;
    const recipe = await getRecipeNutrition(Number(recipeId));
    if (!recipe) {
      await ctx.answerCbQuery(T.recipeNotFound);
      return;
    }
    await ctx.answerCbQuery();
    const { text, extra } = buildPortionPicker(date, recipe, Number(slot));
    await safeEdit(ctx, text, extra);
  }));

  bot.action(new RegExp(`^fl_add_${DATE}_(\\d+)_([0-5])_([1-4])$`), guarded('adding entry', async (ctx) => {
    const [, date, recipeId, slot, halves] = ctx.match;
    if (!(await ensureDiaryDate(ctx, date))) return;
    let entryId;
    try {
      entryId = await addEntry(ctx.from.id, {
        recipeId: Number(recipeId),
        portion: portionFromHalves(Number(halves)),
        date,
        slot: slot === '0' ? null : Number(slot)
      });
    } catch (error) {
      logger.error('Food log: error saving entry:', error);
      await ctx.answerCbQuery(T.errorSave);
      return;
    }
    await ctx.answerCbQuery(entryId ? T.added : T.recipeNotFound);
    if (entryId) await showDay(ctx, date);
  }));

  bot.action(/^fl_del_(\d+)$/, guarded('deleting entry', async (ctx) => {
    const date = await deleteEntry(ctx.from.id, Number(ctx.match[1]));
    await ctx.answerCbQuery(date ? T.deleted : T.entryNotFound);
    await showDay(ctx, date && isDiaryDate(date) ? date : today());
  }));

  // [RU] «🍽 Съел» из карточки рецепта: выбор порции — новым сообщением,
  // чтобы карточка осталась на экране; запись идёт на сегодня без слота.
  // [EN] "🍽 Ate it" from a recipe card: the portion picker is a new message
  // so the card stays visible; the entry goes to today without a slot.
  bot.action(/^fl_eat_(\d+)$/, guarded('opening portions from card', async (ctx) => {
    const recipe = await getRecipeNutrition(Number(ctx.match[1]));
    if (!recipe) {
      await ctx.answerCbQuery(T.recipeNotFound);
      return;
    }
    await ctx.answerCbQuery();
    const { text, extra } = buildPortionPicker(today(), recipe, 0);
    await ctx.reply(text, extra);
  }));
}

module.exports = { register };
