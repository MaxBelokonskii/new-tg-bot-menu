const texts = require('../texts');
const logger = require('../../utils/logger');
const { getUserClock } = require('../../features/time-zone/logic');
const { getLastShoppingList } = require('../../features/shopping-list/logic');
const { getUserProfile } = require('../../features/profile/logic');
const { pickTargets } = require('../../features/profile/targets');
const { getWeekPlanNutrition, summarizePlanWeek } = require('../../features/weekly-planner/week-totals');
const { planWeeks, weekKindOfMonday } = require('../../features/weekly-planner/plan-weeks');
const {
  formatShoppingListExport,
  formatPlanExport,
  shoppingListFilename,
  planFilename
} = require('../../interface/export');
const { fillWeek } = require('../../interface/weekly-plan');

const E = texts.export;

/**
 * Answers the callback and sends the text as a UTF-8 .txt document.
 * @param {import('telegraf').Context} ctx
 * @param {string} text
 * @param {string} filename
 * @returns {Promise<void>}
 */
async function sendTextFile(ctx, text, filename) {
  await ctx.answerCbQuery(E.sent);
  await ctx.replyWithDocument({ source: Buffer.from(text, 'utf8'), filename });
}

/**
 * Wraps an export handler: logs failures and answers the callback with an
 * error toast (ignored when the query was already answered).
 * @param {string} name - for the log
 * @param {(ctx: import('telegraf').Context) => Promise<void>} handler
 * @returns {(ctx: import('telegraf').Context) => Promise<void>}
 */
function guarded(name, handler) {
  return async (ctx) => {
    try {
      await handler(ctx);
    } catch (error) {
      logger.error(`Error exporting ${name}:`, error);
      await ctx.answerCbQuery(E.error).catch(() => {});
    }
  };
}

/**
 * sl_export: the user's current saved shopping list as a .txt file.
 * @param {import('telegraf').Context} ctx
 */
async function exportShoppingList(ctx) {
  const list = await getLastShoppingList(ctx.from.id);
  if (list.items.length === 0) {
    await ctx.answerCbQuery(E.noList, { show_alert: true });
    return;
  }
  const { today } = await getUserClock(ctx.from.id);
  await sendTextFile(ctx, formatShoppingListExport(list, today), shoppingListFilename(list.periodStart));
}

/**
 * wp_export_<monday>: the plan of that week (the user's current or next one
 * at click time) as a .txt file.
 * @param {import('telegraf').Context} ctx
 */
async function exportPlanWeek(ctx) {
  const monday = ctx.match[1];
  const { today } = await getUserClock(ctx.from.id);
  // [RU] Принимаем только текущую или следующую неделю пользователя в момент
  // нажатия: кнопка со старого экрана после смены недели устарела.
  // [EN] Only the user's current or next week at click time is accepted: a
  // button from an old screen goes stale once the week rolls over.
  const kind = weekKindOfMonday(monday, today);
  if (!kind) {
    await ctx.answerCbQuery(E.staleWeek);
    return;
  }
  const rows = await getWeekPlanNutrition(ctx.from.id, planWeeks(today)[kind]);
  if (rows.length === 0) {
    await ctx.answerCbQuery(fillWeek(E.emptyWeek, kind, monday), { show_alert: true });
    return;
  }
  const profile = await getUserProfile(ctx.from.id);
  const text = formatPlanExport({
    kind, monday, rows, summary: summarizePlanWeek(rows), targets: profile ? pickTargets(profile) : null
  });
  await sendTextFile(ctx, text, planFilename(monday));
}

/**
 * Registers the .txt export handlers: shopping list and week plan.
 * @param {import('telegraf').Telegraf} bot
 */
function register(bot) {
  bot.action('sl_export', guarded('shopping list', exportShoppingList));
  bot.action(/^wp_export_(\d{4}-\d{2}-\d{2})$/, guarded('week plan', exportPlanWeek));
}

module.exports = { register };
