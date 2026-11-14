const texts = require('../texts');
const logger = require('../../utils/logger');
const { safeEdit } = require('./helpers');
const { getUserProfile } = require('../../features/profile/logic');
const { pickTargets, recalcTargetsFromProfile } = require('../../features/profile/targets');
const { SCENE_ID } = require('../../features/profile/targets-scene');
const { buildTargetsScreen } = require('../../interface/macro-targets');
const { buildSettingsScreen } = require('./settings-view');

/**
 * Registers the "my macro targets" screen handlers (open, edit, recalc, back).
 * @param {import('telegraf').Telegraf} bot
 */
function register(bot) {
  bot.action('macro_targets', async (ctx) => {
    await ctx.answerCbQuery();
    try {
      const profile = await getUserProfile(ctx.from.id);
      if (!profile) {
        await ctx.reply(texts.macroTargets.noProfile);
        return;
      }
      const { text, extra } = buildTargetsScreen(pickTargets(profile));
      await safeEdit(ctx, text, extra);
    } catch (error) {
      logger.error('Error opening macro targets:', error);
      await ctx.reply(texts.errors.general);
    }
  });

  bot.action(/^macro_edit_(calories|protein|fat|carbs)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.scene.enter(SCENE_ID, { field: ctx.match[1] });
  });

  bot.action('macro_recalc', async (ctx) => {
    try {
      const targets = await recalcTargetsFromProfile(ctx.from.id);
      if (!targets) {
        await ctx.answerCbQuery();
        await ctx.reply(texts.macroTargets.noProfile);
        return;
      }
      await ctx.answerCbQuery(texts.macroTargets.recalculated);
      const { text, extra } = buildTargetsScreen(targets);
      await safeEdit(ctx, text, extra);
    } catch (error) {
      logger.error('Error recalculating macro targets:', error);
      await ctx.reply(texts.errors.general);
    }
  });

  bot.action('macro_back', async (ctx) => {
    await ctx.answerCbQuery();
    try {
      const { text, extra } = await buildSettingsScreen(ctx.from.id);
      await safeEdit(ctx, text, extra);
    } catch (error) {
      logger.error('Error returning to profile menu:', error);
      await ctx.reply(texts.errors.general);
    }
  });
}

module.exports = { register };
