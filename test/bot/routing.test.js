const { seedDb } = require('../helpers/memory-db');
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { Telegram } = require('telegraf');
const texts = require('../../src/bot/texts');
const { createBot } = require('../../src/bot/create-bot');
const { formatLocalDate } = require('../../src/utils/date-helpers');

// [RU] Перехватываем все вызовы Bot API: тест проверяет маршрутизацию
// апдейтов в хэндлеры, а не сеть.
// [EN] Intercept every Bot API call: the test checks update routing, not the network.
let calls = [];
Telegram.prototype.callApi = async function callApi(method, payload) {
  calls.push({ method, payload });
  if (method === 'sendMessage' || method === 'editMessageText') {
    return { message_id: 1, date: 0, chat: { id: 1, type: 'private' }, text: payload.text };
  }
  return true;
};

const bot = createBot('123:TEST');
bot.botInfo = { id: 1, is_bot: true, first_name: 'test', username: 'test_bot' };

const USER = { id: 5001, is_bot: false, first_name: 'Tester', username: 'tester' };
const CHAT = { id: 5001, type: 'private' };
let updateId = 0;

const sendText = (text) => bot.handleUpdate({
  update_id: ++updateId,
  message: { message_id: updateId, date: 0, chat: CHAT, from: USER, text,
    ...(text.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: text.length }] } : {}) }
});

const sendCallback = (data) => bot.handleUpdate({
  update_id: ++updateId,
  callback_query: {
    id: String(updateId), from: USER, chat_instance: '1', data,
    message: { message_id: 1, date: 0, chat: CHAT, from: bot.botInfo, text: 'prev' }
  }
});

const methods = () => calls.map(c => c.method);

before(seedDb);
beforeEach(() => { calls = []; });

test('/start replies with welcome and main menu', async () => {
  await sendText('/start');
  assert.deepEqual(methods(), ['sendMessage', 'sendMessage']);
  assert.equal(calls[0].payload.text, texts.welcome);
});

for (const [key, label] of Object.entries(texts.mainMenu.buttons)) {
  test(`main menu button "${key}" is routed`, async () => {
    await sendText(label);
    assert.ok(methods().includes('sendMessage'), `no reply for ${label}`);
  });
}

test('generate → view → edit slot → cancel flow is routed', async () => {
  await sendCallback('generate_weekly_plan');
  assert.deepEqual(methods(), ['answerCallbackQuery', 'sendMessage', 'sendMessage']);
  assert.equal(calls[1].payload.text, texts.weeklyPlan.generated);

  calls = [];
  await sendCallback('view_weekly_plan');
  assert.deepEqual(methods(), ['answerCallbackQuery', 'sendMessage']);

  const today = formatLocalDate(new Date());
  calls = [];
  await sendCallback(`edit_slot_${today}_1`);
  assert.equal(methods()[0], 'answerCallbackQuery');
  assert.ok(methods().length > 1);

  calls = [];
  await sendCallback(`cancel_edit_${today}_1`);
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText']);
});

test('clear-day and remove-slot confirmations are routed', async () => {
  const today = formatLocalDate(new Date());
  for (const data of [`confirm_clear_day_${today}`, `confirm_remove_slot_${today}_2`]) {
    calls = [];
    await sendCallback(data);
    assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText'], data);
  }
});

test('shopping list rebuild and clear dialog are routed', async () => {
  await sendCallback('generate_shopping_list_week');
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText']);
  calls = [];
  await sendCallback('confirm_clear_shopping');
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText']);
});

test('dish selection category and reverse-search expiry are routed', async () => {
  await sendCallback('select_cat_breakfast');
  assert.ok(methods().length > 0);
  calls = [];
  await sendCallback('reverse_back_to_list');
  assert.deepEqual(methods(), ['answerCallbackQuery', 'sendMessage']);
  assert.equal(calls[1].payload.text, texts.reverseSearch.sessionExpired);
});
