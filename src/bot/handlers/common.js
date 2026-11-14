const texts = require('../texts');
const logger = require('../../utils/logger');
const { sendMainMenu } = require('../../interface/main-menu');
const { getOrCreateUser } = require('../../features/weekly-planner/logic');

/**
 * Registers the user auto-registration/timing middleware and basic commands.
 * Must be registered before feature handlers.
 * @param {import('telegraf').Telegraf} bot
 */
function register(bot) {
  bot.use(async (ctx, next) => {
    const start = Date.now();
    // [RU] Авто-регистрация: к моменту любого хэндлера пользователь уже есть в БД.
    // [EN] Auto-registration: the user row exists before any handler runs.
    if (ctx.from) await getOrCreateUser(ctx.from.id, ctx.from.username);
    await next();
    logger.info(`Response time: ${Date.now() - start}ms`);
  });

  bot.start(async (ctx) => {
    await ctx.reply(texts.welcome);
    await sendMainMenu(ctx);
    logger.info(`User ${ctx.from.id} started the bot`);
  });

  bot.help((ctx) => ctx.reply('Send /start to begin.'));
}

module.exports = { register };
