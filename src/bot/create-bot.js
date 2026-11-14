const { Telegraf, Scenes, session } = require('telegraf');
const logger = require('../utils/logger');
const { profileScene } = require('../features/profile/scene');
const { reverseSearchScene } = require('../features/reverse-search/scene');
const { macroTargetScene } = require('../features/profile/targets-scene');
const common = require('./handlers/common');
const dishSelection = require('./handlers/dish-selection');
const weeklyPlan = require('./handlers/weekly-plan');
const shoppingList = require('./handlers/shopping-list');
const reverseSearch = require('./handlers/reverse-search');
const profile = require('./handlers/profile');
const macroTargets = require('./handlers/macro-targets');

// [RU] Формат токена BotFather: `<bot id>:<секрет из 35 символов>`. Проверка
// формата ловит любые заглушки (`your_telegram_bot_token_here` и т.п.).
// [EN] BotFather token format: `<bot id>:<35-char secret>`. A format check
// catches any placeholder (`your_telegram_bot_token_here` etc.).
const BOT_TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]{30,}$/;

/**
 * True if the value looks like a real BotFather token (not empty, not a placeholder).
 * @param {string|undefined} token
 * @returns {boolean}
 */
function isUsableBotToken(token) {
  return typeof token === 'string' && BOT_TOKEN_PATTERN.test(token.trim());
}

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

  // [RU] Session in-memory: состояние анкеты/обратного поиска/правки норм короткоживущее.
  // [EN] In-memory session: survey/reverse-search/target-edit state is short-lived.
  bot.use(session());
  bot.use(new Scenes.Stage([profileScene, reverseSearchScene, macroTargetScene]).middleware());

  const features = [
    common, dishSelection, weeklyPlan, shoppingList, reverseSearch, profile, macroTargets
  ];
  for (const feature of features) {
    feature.register(bot);
  }

  bot.catch((err, ctx) => {
    logger.error(`Ooops, encountered an error for ${ctx.updateType}`, err);
  });

  return bot;
}

module.exports = { createBot, isUsableBotToken };
