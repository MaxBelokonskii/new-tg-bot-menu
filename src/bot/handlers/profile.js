const texts = require('../texts');
const logger = require('../../utils/logger');
const { sendProfileMenu } = require('../../interface/profile');
const { SCENE_ID } = require('../../features/profile/scene');
const { getUserProfile } = require('../../features/profile/logic');

/**
 * Registers profile (settings) handlers.
 * @param {import('telegraf').Telegraf} bot
 */
function register(bot) {
  bot.hears(texts.mainMenu.buttons.settings, async (ctx) => {
    try {
      await sendProfileMenu(ctx, await getUserProfile(ctx.from.id));
    } catch (error) {
      logger.error('Error loading profile:', error);
      await ctx.reply(texts.errors.general);
    }
  });

  bot.action('profile_start', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.scene.enter(SCENE_ID);
  });
}

module.exports = { register };
