const texts = require('../texts');
const logger = require('../../utils/logger');
const { safeEdit } = require('./helpers');
const { buildSettingsScreen } = require('./settings-view');
const {
  getHouseholdSize, setHouseholdSize, getListHouseholdSize
} = require('../../features/household/logic');
const { buildHouseholdPicker } = require('../../interface/household');

const T = texts.household;

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
      logger.error(`Household: error ${label}:`, error);
      await ctx.answerCbQuery().catch(() => {});
      await ctx.reply(texts.errors.general);
    }
  };
}

/**
 * Toast after saving: a rebuild hint when the current shopping list was
 * built for another household size.
 * @param {number} telegramId
 * @param {number} size - the saved size
 * @returns {Promise<string>}
 */
async function savedToast(telegramId, size) {
  const listSize = await getListHouseholdSize(telegramId);
  return listSize !== null && listSize !== size ? T.savedRebuild : T.saved;
}

/**
 * Registers the "cooking for N people" picker opened from Settings
 * (`hh_pick`). Choosing a size (`hh_set_<n>`) saves it and returns to
 * Settings; the size only scales the shopping list.
 * @param {import('telegraf').Telegraf} bot
 */
function register(bot) {
  bot.action('hh_pick', guarded('opening picker', async (ctx) => {
    const { text, extra } = buildHouseholdPicker(await getHouseholdSize(ctx.from.id));
    await ctx.answerCbQuery();
    await safeEdit(ctx, text, extra);
  }));

  bot.action(/^hh_set_(\d{1,2})$/, guarded('setting size', async (ctx) => {
    const saved = await setHouseholdSize(ctx.from.id, Number(ctx.match[1]));
    if (saved === null) {
      await ctx.answerCbQuery(T.invalid);
      return;
    }
    const { text, extra } = await buildSettingsScreen(ctx.from.id);
    await ctx.answerCbQuery(await savedToast(ctx.from.id, saved));
    await safeEdit(ctx, text, extra);
  }));
}

module.exports = { register };
