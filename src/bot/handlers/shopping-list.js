const texts = require('../texts');
const logger = require('../../utils/logger');
const { safeEdit } = require('./helpers');
const {
  getIngredientsFromPlan,
  saveShoppingList,
  getLastShoppingList,
  clearShoppingLists
} = require('../../features/shopping-list/logic');
const {
  formatShoppingList,
  getShoppingListKeyboard,
  buildClearShoppingConfirmKeyboard
} = require('../../interface/shopping-list');
const { getDayBounds } = require('../../utils/date-helpers');
const { planWeeks, weekKindOfMonday } = require('../../features/weekly-planner/plan-weeks');
const { getUserClock } = require('../../features/time-zone/logic');

/**
 * Re-renders the callback message as the user's current shopping list.
 * @param {import('telegraf').Context} ctx
 * @returns {Promise<void>}
 */
async function renderLastList(ctx) {
  const list = await getLastShoppingList(ctx.from.id);
  const { today } = await getUserClock(ctx.from.id);
  return safeEdit(ctx, formatShoppingList(list, today), {
    parse_mode: 'HTML', ...getShoppingListKeyboard(list.listId)
  });
}

// [RU] Период списка по режиму кнопки — от «сегодня» пользователя.
// [EN] List period per button mode — from the user's today.
const PERIOD_BOUNDS = {
  day: (today) => getDayBounds(today),
  week: (today) => planWeeks(today).current,
  nextweek: (today) => planWeeks(today).next
};

// Режим списка по виду недели из plan-weeks
const MODE_BY_WEEK_KIND = { current: 'week', next: 'nextweek' };

/**
 * Builds the shopping list for the given period and re-renders it; an empty
 * period is an alert and leaves the message as is.
 * @param {import('telegraf').Context} ctx
 * @param {'day'|'week'|'nextweek'} mode - picks the toast texts
 * @param {{start: string, endExclusive: string}} bounds
 */
async function buildListForPeriod(ctx, mode, bounds) {
  const ingredients = await getIngredientsFromPlan(ctx.from.id, bounds);
  if (ingredients.length === 0) {
    return ctx.answerCbQuery(texts.shoppingList.emptyForPeriod[mode], { show_alert: true });
  }
  await saveShoppingList(ctx.from.id, ingredients, bounds);
  await ctx.answerCbQuery(texts.shoppingList.generated[mode]);
  await renderLastList(ctx);
}

/**
 * Rebuilds the shopping list for the user's today, current week or next
 * week (relative to the moment of the click) and re-renders it.
 * @param {import('telegraf').Context} ctx
 * @param {'day'|'week'|'nextweek'} mode
 */
async function regenerateShoppingList(ctx, mode) {
  try {
    const { today } = await getUserClock(ctx.from.id);
    await buildListForPeriod(ctx, mode, PERIOD_BOUNDS[mode](today));
  } catch (error) {
    logger.error(`Error generating shopping list (${mode}):`, error);
    await ctx.answerCbQuery(texts.shoppingList.errorGenerate).catch(() => {});
  }
}

/**
 * sl_week_<monday> (weekly reminder): builds the list for that exact week.
 * @param {import('telegraf').Context} ctx
 */
async function buildWeekListFromCallback(ctx) {
  try {
    const monday = ctx.match[1];
    const { today } = await getUserClock(ctx.from.id);
    // [RU] Понедельник принимается, только если это текущая или следующая неделя
    // пользователя в момент нажатия; иначе — тост и текущий список без пересборки.
    // [EN] Only the user's current or next week is accepted at click time;
    // otherwise a toast and the current list, nothing rebuilt.
    const kind = weekKindOfMonday(monday, today);
    if (!kind) {
      await ctx.answerCbQuery(texts.shoppingList.staleWeek);
      return renderLastList(ctx);
    }
    await buildListForPeriod(ctx, MODE_BY_WEEK_KIND[kind], planWeeks(today)[kind]);
  } catch (error) {
    logger.error('Error generating shopping list for a dated week:', error);
    await ctx.answerCbQuery(texts.shoppingList.errorGenerate).catch(() => {});
  }
}

/**
 * Registers shopping-list handlers: show, rebuild (today / this week / next
 * week, or a dated week from the weekly reminder), clear.
 * @param {import('telegraf').Telegraf} bot
 */
function register(bot) {
  bot.hears(texts.mainMenu.buttons.shoppingList, async (ctx) => {
    try {
      const list = await getLastShoppingList(ctx.from.id);
      const { today } = await getUserClock(ctx.from.id);
      await ctx.reply(formatShoppingList(list, today), {
        parse_mode: 'HTML', ...getShoppingListKeyboard(list.listId)
      });
    } catch (error) {
      logger.error('Error showing shopping list:', error);
      await ctx.reply(texts.errors.general);
    }
  });

  bot.action('generate_shopping_list_day', (ctx) => regenerateShoppingList(ctx, 'day'));
  bot.action('generate_shopping_list_week', (ctx) => regenerateShoppingList(ctx, 'week'));
  bot.action('generate_shopping_list_nextweek', (ctx) => regenerateShoppingList(ctx, 'nextweek'));
  bot.action(/^sl_week_(\d{4}-\d{2}-\d{2})$/, buildWeekListFromCallback);

  bot.action('confirm_clear_shopping', async (ctx) => {
    await ctx.answerCbQuery();
    try {
      await ctx.editMessageText(texts.shoppingList.confirmClear, {
        reply_markup: buildClearShoppingConfirmKeyboard()
      });
    } catch (error) {
      logger.error('Error showing clear-shopping confirmation:', error);
    }
  });

  bot.action('do_clear_shopping', async (ctx) => {
    try {
      await clearShoppingLists(ctx.from.id);
      // [RU] Editим раньше answerCbQuery, чтобы catch мог безопасно ответить
      // об ошибке, если edit упал уже после закрытого query.
      // [EN] Edit before answerCbQuery so the error-path answer can't hit
      // an already-answered query.
      await safeEdit(ctx, texts.shoppingList.empty, getShoppingListKeyboard());
      await ctx.answerCbQuery(texts.shoppingList.cleared);
    } catch (error) {
      logger.error('Error clearing shopping list:', error);
      await ctx.answerCbQuery(texts.shoppingList.errorClear).catch(() => {});
    }
  });

  bot.action('cancel_clear_shopping', async (ctx) => {
    await ctx.answerCbQuery(texts.confirm.canceled);
    try {
      await renderLastList(ctx);
    } catch (error) {
      logger.error('Error restoring shopping list after cancel:', error);
    }
  });
}

module.exports = { register, renderLastList };
