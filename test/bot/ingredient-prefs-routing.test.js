const { seedDb } = require('../helpers/memory-db');
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const texts = require('../../src/bot/texts');
const { dbGet } = require('../../src/database/db');
const { listPrefs } = require('../../src/features/ingredient-prefs/logic');
const { createFakeBot } = require('../helpers/fake-bot');

const TELEGRAM_ID = 7101;
const T = texts.ingredientPrefs;
const { calls, sendText, sendCallback, methods, reset } = createFakeBot(TELEGRAM_ID);

const callbackData = (payload) => (payload.reply_markup?.inline_keyboard || [])
  .flat().map(b => b.callback_data);
const sentTexts = () => calls.filter(c => c.method === 'sendMessage').map(c => c.payload.text);
const names = async (kind) => (await listPrefs(TELEGRAM_ID, kind)).map(i => i.name);

before(seedDb);
beforeEach(reset);

test('settings show both product lists even without a profile', async () => {
  await sendText(texts.mainMenu.buttons.settings);
  const data = callbackData(calls[0].payload);
  assert.ok(data.includes('prefs_list_excluded'));
  assert.ok(data.includes('prefs_list_favorite'));

  reset();
  await sendCallback('prefs_list_excluded');
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText']);
  assert.ok(calls[1].payload.text.startsWith(T.title.excluded));
  assert.ok(calls[1].payload.text.includes(T.empty));
  assert.deepEqual(callbackData(calls[1].payload), ['prefs_add_excluded', 'prefs_back']);
});

test('add flow: unrecognized input keeps waiting, valid input saves and shows the list', async () => {
  await sendCallback('prefs_add_excluded');
  assert.equal(calls[1].payload.text, T.askAdd.excluded);
  assert.deepEqual(callbackData(calls[1].payload), ['prefs_add_cancel']);

  reset();
  await sendText('абракадабра');
  assert.ok(sentTexts()[0].startsWith(T.nothingRecognized));
  assert.deepEqual(await names('excluded'), []);

  reset();
  await sendText('грибы, курица');
  const [summary, screen] = sentTexts();
  assert.ok(summary.includes('«Грибы»'));
  assert.ok(summary.includes('«Куриное филе»'), 'suggestion for the unknown token');
  assert.ok(screen.startsWith(T.title.excluded));
  assert.deepEqual(await names('excluded'), ['Грибы']);

  // сцена закрыта: следующий текст не попадает в список
  reset();
  await sendText('молоко');
  assert.deepEqual(await names('excluded'), ['Грибы']);
});

test('remove button deletes the product and re-renders the list', async () => {
  const { id } = await dbGet("SELECT id FROM ingredients WHERE name = 'Грибы'");
  await sendCallback('prefs_list_excluded');
  assert.ok(callbackData(calls[1].payload).includes(`prefs_del_excluded_${id}`));

  reset();
  await sendCallback(`prefs_del_excluded_${id}`);
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText']);
  assert.equal(calls[0].payload.text, T.removed);
  assert.ok(calls[1].payload.text.includes(T.empty));
  assert.deepEqual(await names('excluded'), []);
});

test('cancel button and /cancel leave the add scene without saving', async () => {
  await sendCallback('prefs_add_favorite');
  reset();
  await sendCallback('prefs_add_cancel');
  assert.deepEqual(sentTexts()[0], T.canceled);
  assert.ok(sentTexts()[1].startsWith(T.title.favorite));

  await sendCallback('prefs_add_favorite');
  reset();
  await sendText('/cancel');
  assert.equal(sentTexts()[0], T.canceled);
  reset();
  await sendText('творог');
  assert.deepEqual(await names('favorite'), []);
});

test('back returns to the settings screen', async () => {
  await sendCallback('prefs_back');
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText']);
  assert.ok(calls[1].payload.text.startsWith(texts.profile.menuTitle));
});
