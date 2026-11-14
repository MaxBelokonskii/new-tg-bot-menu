require('dotenv').config();
const { initDb } = require('./database/schema');
const logger = require('./utils/logger');
const { createBot, isUsableBotToken } = require('./bot/create-bot');

const bot = createBot(process.env.BOT_TOKEN || 'DUMMY_TOKEN');

async function start() {
  await initDb();
  if (!isUsableBotToken(process.env.BOT_TOKEN)) {
    logger.warn('BOT_TOKEN is missing or a placeholder. Bot will not start.');
    return;
  }
  await bot.launch(() => logger.info('Bot is running...'));
}

start().catch((err) => {
  logger.error('Failed to start bot:', err);
  process.exit(1);
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
