const texts = require('../texts');
const logger = require('../../utils/logger');
const { safeEdit } = require('./helpers');
const { addDays } = require('../../utils/date-helpers');
const { getUserClock } = require('../../features/time-zone/logic');
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
  getEntry,
  updateEntryPortion,
  getDayLog,
  getPlanDishes
} = require('../../features/food-log/logic');
const { listFavorites } = require('../../features/favorite-recipes/logic');
const { SCENE_ID } = require('../../features/food-log/search-scene');
const { buildDayScreen } = require('../../interface/food-log');
const {
  buildPlanPicker, buildFavoritesPicker, buildPortionPicker, buildEntryEditor
} = require('../../interface/food-log-pickers');

const T = texts.foodLog;
const DATE = '(\\d{4}-\\d{2}-\\d{2})';
// Тост по статусу updateEntryPortion
const PORTION_TOASTS = { updated: T.portionUpdated, outOfRange: T.entryOutOfRange, notFound: T.entryNotFound };

/**
 * The user's local today (YYYY-MM-DD) — the diary window is counted from it.
 * @param {import('telegraf').Context} ctx
 * @returns {Promise<string>}
 */
async function userToday(ctx) {
  return (await getUserClock(ctx.from.id)).today;
}

/**
 * Loads the diary day and builds its screen.
 * @param {number} telegramId
 * @param {string} date - YYYY-MM-DD within the diary window
 * @param {string} today - YYYY-MM-DD, the user's local today
 * @returns {Promise<{text: string, extra: object}>}
 */
async function buildDayView(telegramId, date, today) {
  const entries = await getDayLog(telegramId, date);
  const profile = await getUserProfile(telegramId);
  return buildDayScreen({
    date,
    today,
    oldest: addDays(today, -HISTORY_DAYS),
    entries,
    totals: sumNutrition(entries),
    targets: profile ? pickTargets(profile) : null
  });
}

/**
 * Shows a diary day: edits the callback message (default) or sends a new one.
 * @param {import('telegraf').Context} ctx
 * @param {string} date - YYYY-MM-DD
 * @param {string} today - YYYY-MM-DD, the user's local today
 * @param {{edit?: boolean}} [options]
 */
async function showDay(ctx, date, today, { edit = true } = {}) {
  const { text, extra } = await buildDayView(ctx.from.id, date, today);
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
 * Validates the date from callback_data against the user's diary window.
 * Out-of-window dates answer the callback with a notice and show today instead.
 * @param {import('telegraf').Context} ctx
 * @param {string} date
 * @returns {Promise<string|null>} the user's today when the date is usable, otherwise null
 */
async function ensureDiaryDate(ctx, date) {
  const today = await userToday(ctx);
  if (isDiaryDate(date, today)) return today;
  await ctx.answerCbQuery(T.dateOutOfRange);
  await showDay(ctx, today, today);
  return null;
}

/**
 * Registers food diary handlers: day screen, day navigation, add from plan,
 * from ⭐ favorites, recipe search, portion choice, entry portion editing and
 * deletion, and "🍽 Съел" from recipe cards.
 * @param {import('telegraf').Telegraf} bot
 */
function register(bot) {
  bot.hears(texts.mainMenu.buttons.foodLog, guarded('opening diary', async (ctx) => {
    const today = await userToday(ctx);
    await showDay(ctx, today, today, { edit: false });
  }));

  bot.action(new RegExp(`^fl_day_${DATE}$`), guarded('showing day', async (ctx) => {
    const today = await ensureDiaryDate(ctx, ctx.match[1]);
    if (!today) return;
    await ctx.answerCbQuery();
    await showDay(ctx, ctx.match[1], today);
  }));

  bot.action(new RegExp(`^fl_plan_${DATE}$`), guarded('showing plan picker', async (ctx) => {
    const date = ctx.match[1];
    const today = await ensureDiaryDate(ctx, date);
    if (!today) return;
    const dishes = await getPlanDishes(ctx.from.id, date);
    if (dishes.length === 0) {
      await ctx.answerCbQuery(T.plan.empty, { show_alert: true });
      return;
    }
    await ctx.answerCbQuery();
    const { text, extra } = buildPlanPicker(date, today, dishes);
    await safeEdit(ctx, text, extra);
  }));

  bot.action(new RegExp(`^fl_fav_${DATE}_(\\d+)$`), guarded('showing favorites picker', async (ctx) => {
    const [, date, page] = ctx.match;
    const today = await ensureDiaryDate(ctx, date);
    if (!today) return;
    const list = await listFavorites(ctx.from.id, Number(page));
    if (list.total === 0) {
      await ctx.answerCbQuery(T.favorites.empty, { show_alert: true });
      return;
    }
    await ctx.answerCbQuery();
    const { text, extra } = buildFavoritesPicker(date, today, list);
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
    const today = await ensureDiaryDate(ctx, date);
    if (!today) return;
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
    if (entryId) await showDay(ctx, date, today);
  }));

  // [RU] Редактор записи: только своя запись и только в окне дневника;
  // иначе — тост и экран сегодняшнего дня.
  // [EN] Entry editor: own entries within the diary window only; otherwise
  // a toast and today's screen.
  bot.action(/^fl_entry_(\d+)$/, guarded('opening entry editor', async (ctx) => {
    const entry = await getEntry(ctx.from.id, Number(ctx.match[1]));
    const today = await userToday(ctx);
    if (!entry || !isDiaryDate(entry.date, today)) {
      await ctx.answerCbQuery(entry ? T.entryOutOfRange : T.entryNotFound);
      await showDay(ctx, today, today);
      return;
    }
    await ctx.answerCbQuery();
    const { text, extra } = buildEntryEditor(entry);
    await safeEdit(ctx, text, extra);
  }));

  bot.action(/^fl_port_(\d+)_([1-4])$/, guarded('updating portion', async (ctx) => {
    const [, entryId, halves] = ctx.match;
    const today = await userToday(ctx);
    let result;
    try {
      result = await updateEntryPortion(ctx.from.id, Number(entryId), portionFromHalves(Number(halves)), today);
    } catch (error) {
      logger.error('Food log: error updating portion:', error);
      await ctx.answerCbQuery(T.errorSave);
      return;
    }
    await ctx.answerCbQuery(PORTION_TOASTS[result.status]);
    await showDay(ctx, result.status === 'updated' ? result.date : today, today);
  }));

  bot.action(/^fl_del_(\d+)$/, guarded('deleting entry', async (ctx) => {
    const date = await deleteEntry(ctx.from.id, Number(ctx.match[1]));
    const today = await userToday(ctx);
    await ctx.answerCbQuery(date ? T.deleted : T.entryNotFound);
    await showDay(ctx, date && isDiaryDate(date, today) ? date : today, today);
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
    const { text, extra } = buildPortionPicker(await userToday(ctx), recipe, 0);
    await ctx.reply(text, extra);
  }));
}

module.exports = { register };
