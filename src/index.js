require('dotenv').config();
const { initDb } = require('./database/schema');
const logger = require('./utils/logger');
const { createBot, isUsableBotToken } = require('./bot/create-bot');
const { startReminderScheduler } = require('./features/reminders/scheduler');

const bot = createBot(process.env.BOT_TOKEN || 'DUMMY_TOKEN');
let stopReminders = null;

async function start() {
  await initDb();
  if (!isUsableBotToken(process.env.BOT_TOKEN)) {
    logger.warn('BOT_TOKEN is missing or a placeholder. Bot will not start.');
    return;
  }
  // [RU] bot.launch резолвится только после остановки polling, поэтому
  // планировщик напоминаний стартует в onLaunch (getMe уже прошёл).
  // [EN] bot.launch resolves only once polling stops, so the reminder
  // scheduler starts in onLaunch (getMe has already succeeded).
  await bot.launch(() => {
    logger.info('Bot is running...');
    stopReminders = startReminderScheduler(bot.telegram);
  });
}

start().catch((err) => {
  logger.error('Failed to start bot:', err);
  process.exit(1);
});

/**
 * Stops the reminder timer and the bot.
 * @param {string} signal
 */
function shutdown(signal) {
  if (stopReminders) stopReminders();
  bot.stop(signal);
}

// Enable graceful stop
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
