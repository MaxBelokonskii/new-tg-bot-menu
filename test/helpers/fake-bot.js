const { Telegram } = require('telegraf');
const { createBot } = require('../../src/bot/create-bot');

/**
 * Builds a fully wired bot whose Bot API calls are intercepted and recorded,
 * plus helpers to feed it text messages and callback queries from one user.
 * Require test/helpers/memory-db.js before this module.
 *
 * @param {number} userId - Telegram user id (also used as private chat id)
 * @returns {{bot: import('telegraf').Telegraf, calls: Array<{method: string, payload: object}>,
 *            sendText: (text: string) => Promise<void>,
 *            sendCallback: (data: string, options?: {replyMarkup?: object}) => Promise<void>,
 *            methods: () => string[], reset: () => void}}
 */
function createFakeBot(userId) {
  const calls = [];
  // [RU] Перехватываем все вызовы Bot API: тест проверяет маршрутизацию
  // апдейтов в хэндлеры, а не сеть.
  // [EN] Intercept every Bot API call: the test checks update routing, not the network.
  Telegram.prototype.callApi = async function callApi(method, payload) {
    calls.push({ method, payload });
    if (method === 'sendMessage' || method === 'editMessageText') {
      return { message_id: 1, date: 0, chat: { id: userId, type: 'private' }, text: payload.text };
    }
    return true;
  };

  const bot = createBot('123:TEST');
  bot.botInfo = { id: 1, is_bot: true, first_name: 'test', username: 'test_bot' };

  const user = { id: userId, is_bot: false, first_name: 'Tester', username: 'tester' };
  const chat = { id: userId, type: 'private' };
  let updateId = 0;

  const sendText = (text) => bot.handleUpdate({
    update_id: ++updateId,
    message: { message_id: updateId, date: 0, chat, from: user, text,
      ...(text.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: text.length }] } : {}) }
  });

  // [RU] replyMarkup — клавиатура сообщения, на котором нажата кнопка (Telegram
  // присылает её в callback_query.message).
  // [EN] replyMarkup — keyboard of the message whose button was tapped
  // (Telegram sends it in callback_query.message).
  const sendCallback = (data, { replyMarkup } = {}) => bot.handleUpdate({
    update_id: ++updateId,
    callback_query: {
      id: String(updateId), from: user, chat_instance: '1', data,
      message: { message_id: 1, date: 0, chat, from: bot.botInfo, text: 'prev',
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }
    }
  });

  return {
    bot,
    calls,
    sendText,
    sendCallback,
    methods: () => calls.map(c => c.method),
    reset: () => { calls.length = 0; }
  };
}

module.exports = { createFakeBot };
