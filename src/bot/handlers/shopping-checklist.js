const texts = require('../texts');
const logger = require('../../utils/logger');
const { safeEdit } = require('./helpers');
const { renderLastList } = require('./shopping-list');
const { getLastShoppingList } = require('../../features/shopping-list/logic');
const { toggleBought, resetBought } = require('../../features/shopping-list/bought');
const { buildChecklistScreen } = require('../../interface/shopping-checklist');

const T = texts.shoppingList.checklist;

/**
 * Tells the user the pressed button belongs to an outdated list and shows the
 * current list instead.
 * @param {import('telegraf').Context} ctx
 * @returns {Promise<void>}
 */
async function showStale(ctx) {
  await renderLastList(ctx);
  await ctx.answerCbQuery(T.staleList);
}

/**
 * Re-renders the checklist page of the user's current list, or falls back to
 * the stale flow when `listId` is no longer current.
 * @param {import('telegraf').Context} ctx
 * @param {number} listId
 * @param {number} page
 * @param {string} [toast] - callback answer text
 * @returns {Promise<void>}
 */
async function renderChecklist(ctx, listId, page, toast) {
  const list = await getLastShoppingList(ctx.from.id);
  if (list.listId !== listId) return showStale(ctx);
  const { text, extra } = buildChecklistScreen(list, page);
  await safeEdit(ctx, text, extra);
  await ctx.answerCbQuery(toast);
}

// [RU] Везде сначала edit, потом answerCbQuery: если edit упадёт, guarded
// ещё может ответить тостом об ошибке.
// [EN] Edit first, answer second everywhere: if the edit fails, guarded can
// still answer with an error toast.

/**
 * Wraps a checklist action with error logging and an error toast.
 * @param {string} name - action name for the log
 * @param {(ctx: import('telegraf').Context) => Promise<void>} fn
 * @returns {(ctx: import('telegraf').Context) => Promise<void>}
 */
function guarded(name, fn) {
  return async (ctx) => {
    try {
      await fn(ctx);
    } catch (error) {
      logger.error(`Error in shopping checklist (${name}):`, error);
      await ctx.answerCbQuery(T.error).catch(() => {});
    }
  };
}

/**
 * Registers the "bought" checklist of the shopping list:
 * sl_check_<list>_<page> — open a page, sl_tgl_<list>_<ingredient>_<page> —
 * toggle an item, sl_reset_<list>_<page> — clear all marks, sl_list — back.
 * @param {import('telegraf').Telegraf} bot
 */
function register(bot) {
  bot.action(/^sl_check_(\d+)_(\d+)$/, guarded('open', (ctx) => (
    renderChecklist(ctx, Number(ctx.match[1]), Number(ctx.match[2]))
  )));

  bot.action(/^sl_tgl_(\d+)_(\d+)_(\d+)$/, guarded('toggle', async (ctx) => {
    const [listId, ingredientId, page] = ctx.match.slice(1, 4).map(Number);
    const result = await toggleBought(ctx.from.id, listId, ingredientId);
    if (result.status !== 'ok') return showStale(ctx);
    return renderChecklist(ctx, listId, page);
  }));

  bot.action(/^sl_reset_(\d+)_(\d+)$/, guarded('reset', async (ctx) => {
    const [listId, page] = ctx.match.slice(1, 3).map(Number);
    const result = await resetBought(ctx.from.id, listId);
    if (result.status !== 'ok') return showStale(ctx);
    return renderChecklist(ctx, listId, page, T.resetDone);
  }));

  bot.action('sl_list', guarded('back', async (ctx) => {
    await renderLastList(ctx);
    await ctx.answerCbQuery();
  }));
}

module.exports = { register };
