const { Telegraf, Scenes, session } = require('telegraf');
const logger = require('../utils/logger');
const { profileScene } = require('../features/profile/scene');
const { reverseSearchScene } = require('../features/reverse-search/scene');
const common = require('./handlers/common');
const dishSelection = require('./handlers/dish-selection');
const weeklyPlan = require('./handlers/weekly-plan');
const shoppingList = require('./handlers/shopping-list');
const reverseSearch = require('./handlers/reverse-search');
const profile = require('./handlers/profile');

/**
 * Builds a fully wired Telegraf bot without launching it.
 *
 * [RU] Порядок важен: session → stage (Stage кладёт данные в ctx.session),
 * затем common (авто-регистрация пользователя) — до фичевых хэндлеров.
 * Новые экраны — отдельным файлом в handlers/ и строкой в этом списке.
 * [EN] Order matters: session → stage (Stage stores data in ctx.session),
 * then common (user auto-registration) — before feature handlers. New screens
 * get their own file in handlers/ plus a line in this list.
 *
 * @param {string} token
 * @returns {import('telegraf').Telegraf}
 */
function createBot(token) {
  const bot = new Telegraf(token);

  // [RU] Session in-memory: состояние анкеты/обратного поиска короткоживущее.
  // [EN] In-memory session: survey/reverse-search state is short-lived.
  bot.use(session());
  bot.use(new Scenes.Stage([profileScene, reverseSearchScene]).middleware());

  for (const feature of [common, dishSelection, weeklyPlan, shoppingList, reverseSearch, profile]) {
    feature.register(bot);
  }

  bot.catch((err, ctx) => {
    logger.error(`Ooops, encountered an error for ${ctx.updateType}`, err);
  });

  return bot;
}

module.exports = { createBot };
