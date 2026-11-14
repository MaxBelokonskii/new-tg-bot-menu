const texts = require('../texts');
const logger = require('../../utils/logger');
const { safeEdit } = require('./helpers');
const { buildSettingsScreen } = require('./settings-view');
const { SCENE_ID } = require('../../features/profile/scene');

/**
 * Registers profile (settings) handlers: the settings screen from the main
 * menu and from "back to settings" buttons, and the profile survey start.
 * @param {import('telegraf').Telegraf} bot
 */
function register(bot) {
  bot.hears(texts.mainMenu.buttons.settings, async (ctx) => {
    try {
      const { text, extra } = await buildSettingsScreen(ctx.from.id);
      await ctx.reply(text, extra);
    } catch (error) {
      logger.error('Error loading profile:', error);
      await ctx.reply(texts.errors.general);
    }
  });

  bot.action('settings_menu', async (ctx) => {
    await ctx.answerCbQuery();
    try {
      const { text, extra } = await buildSettingsScreen(ctx.from.id);
      await safeEdit(ctx, text, extra);
    } catch (error) {
      logger.error('Error returning to settings:', error);
      await ctx.reply(texts.errors.general);
    }
  });

  bot.action('profile_start', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.scene.enter(SCENE_ID);
  });
}

module.exports = { register };
