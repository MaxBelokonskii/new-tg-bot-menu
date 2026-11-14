const texts = require('../texts');
const logger = require('../../utils/logger');
const { safeEdit } = require('./helpers');
const { listPrefs, removePref } = require('../../features/ingredient-prefs/logic');
const { SCENE_ID } = require('../../features/ingredient-prefs/scene');
const { buildPrefsScreen } = require('../../interface/ingredient-prefs');
const { buildSettingsScreen } = require('./settings-view');

const KIND = '(excluded|favorite)';

/**
 * Re-renders the list screen in place.
 * @param {import('telegraf').Context} ctx
 * @param {string} kind
 */
async function editListScreen(ctx, kind) {
  const { text, extra } = buildPrefsScreen(kind, await listPrefs(ctx.from.id, kind));
  await safeEdit(ctx, text, extra);
}

/**
 * Registers the excluded / favorite products screens (settings → products).
 * @param {import('telegraf').Telegraf} bot
 */
function register(bot) {
  bot.action(new RegExp(`^prefs_list_${KIND}$`), async (ctx) => {
    await ctx.answerCbQuery();
    try {
      await editListScreen(ctx, ctx.match[1]);
    } catch (error) {
      logger.error('Error opening ingredient prefs:', error);
      await ctx.reply(texts.errors.general);
    }
  });

  bot.action(new RegExp(`^prefs_add_${KIND}$`), async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.scene.enter(SCENE_ID, { kind: ctx.match[1] });
  });

  bot.action(new RegExp(`^prefs_del_${KIND}_(\\d+)$`), async (ctx) => {
    const [, kind, ingredientId] = ctx.match;
    try {
      const removed = await removePref(ctx.from.id, Number(ingredientId));
      await ctx.answerCbQuery(removed ? texts.ingredientPrefs.removed : texts.ingredientPrefs.notFound);
      await editListScreen(ctx, kind);
    } catch (error) {
      logger.error('Error removing ingredient pref:', error);
      await ctx.answerCbQuery(texts.ingredientPrefs.errorSave).catch(() => {});
    }
  });

  bot.action('prefs_back', async (ctx) => {
    await ctx.answerCbQuery();
    try {
      const { text, extra } = await buildSettingsScreen(ctx.from.id);
      await safeEdit(ctx, text, extra);
    } catch (error) {
      logger.error('Error returning to settings:', error);
      await ctx.reply(texts.errors.general);
    }
  });

  // [RU] «Отмена» из уже закрытой сцены — просто гасим часики.
  // [EN] "Cancel" from an already closed scene — just stop the spinner.
  bot.action('prefs_add_cancel', (ctx) => ctx.answerCbQuery());
}

module.exports = { register };
