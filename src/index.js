require('dotenv').config();
const { initDb } = require('./database/schema');
const logger = require('./utils/logger');
const { createBot } = require('./bot/create-bot');

const bot = createBot(process.env.BOT_TOKEN || 'DUMMY_TOKEN');

async function start() {
  await initDb();
  if (!process.env.BOT_TOKEN || process.env.BOT_TOKEN === 'your_telegram_bot_token') {
    logger.warn('BOT_TOKEN is not set. Bot will not start.');
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
