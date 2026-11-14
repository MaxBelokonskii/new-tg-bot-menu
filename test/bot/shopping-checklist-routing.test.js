const { seedDb } = require('../helpers/memory-db');
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const texts = require('../../src/bot/texts');
const { dbAll } = require('../../src/database/db');
const { generateWeeklyPlan } = require('../../src/features/weekly-planner/generator');
const { getLastShoppingList } = require('../../src/features/shopping-list/logic');
const { createFakeBot } = require('../helpers/fake-bot');
const { defaultClock } = require('../helpers/clock');

const TELEGRAM_ID = 8301;
const T = texts.shoppingList.checklist;

const { calls, sendText, sendCallback, methods, reset } = createFakeBot(TELEGRAM_ID);

const keyboard = (payload) => payload.reply_markup?.inline_keyboard || [];
const callbackData = (payload) => keyboard(payload).flat().map(b => b.callback_data);
const boughtIds = async () => (await dbAll(
  'SELECT ingredient_id FROM shopping_list_items WHERE is_bought = 1 ORDER BY ingredient_id'
)).map(r => r.ingredient_id);

before(seedDb);
beforeEach(reset);

test('no list → no checklist button; built list → checklist button with list id', async () => {
  await sendText(texts.mainMenu.buttons.shoppingList);
  assert.deepEqual(methods(), ['sendMessage']);
  assert.ok(!callbackData(calls[0].payload).some(d => d.startsWith('sl_check_')));

  await generateWeeklyPlan(TELEGRAM_ID, { week: defaultClock().week });
  reset();
  await sendCallback('generate_shopping_list_week');
  const { listId } = await getLastShoppingList(TELEGRAM_ID);
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText']);
  assert.equal(callbackData(calls[1].payload)[0], `sl_check_${listId}_0`);
});

test('open checklist → toggle an item → page re-rendered with the mark', async () => {
  const { listId, items } = await getLastShoppingList(TELEGRAM_ID);
  assert.ok(items.length > 10, 'a week list spans several pages');

  await sendCallback(`sl_check_${listId}_0`);
  assert.deepEqual(methods(), ['editMessageText', 'answerCallbackQuery']);
  const toggles = callbackData(calls[0].payload).filter(d => d.startsWith('sl_tgl_'));
  assert.equal(toggles.length, 10);
  assert.ok(keyboard(calls[0].payload)[0][0].text.startsWith(T.unchecked));
  assert.ok(callbackData(calls[0].payload).includes(`sl_check_${listId}_1`));
  assert.ok(!callbackData(calls[0].payload).some(d => d.startsWith('sl_reset_')));

  reset();
  await sendCallback(toggles[0]);
  assert.deepEqual(methods(), ['editMessageText', 'answerCallbackQuery']);
  const ingredientId = Number(toggles[0].split('_')[3]);
  assert.deepEqual(await boughtIds(), [ingredientId]);
  assert.ok(keyboard(calls[0].payload)[0][0].text.startsWith(T.checked));
  assert.ok(calls[0].payload.text.includes(`Куплено: 1 из ${items.length}`));
  assert.ok(callbackData(calls[0].payload).includes(`sl_reset_${listId}_0`));
});

test('paging keeps the page on toggle; back returns to the struck-through list', async () => {
  const { listId } = await getLastShoppingList(TELEGRAM_ID);
  await sendCallback(`sl_check_${listId}_1`);
  const toggles = callbackData(calls[0].payload).filter(d => d.startsWith('sl_tgl_'));
  assert.ok(toggles.every(d => d.endsWith('_1')));
  assert.ok(callbackData(calls[0].payload).includes(`sl_check_${listId}_0`));

  reset();
  await sendCallback(toggles[0]);
  assert.ok(callbackData(calls[0].payload).filter(d => d.startsWith('sl_tgl_')).every(d => d.endsWith('_1')));
  assert.equal((await boughtIds()).length, 2);

  reset();
  await sendCallback('sl_list');
  assert.deepEqual(methods(), ['editMessageText', 'answerCallbackQuery']);
  assert.ok(calls[0].payload.text.includes('<s>'));
  assert.equal(callbackData(calls[0].payload)[0], `sl_check_${listId}_0`);
});

test('stale list id: answers "outdated", shows the current list, changes nothing', async () => {
  const { listId: oldId } = await getLastShoppingList(TELEGRAM_ID);
  const before = await boughtIds();
  await sendCallback('generate_shopping_list_week');
  const { listId: newId } = await getLastShoppingList(TELEGRAM_ID);
  assert.notEqual(newId, oldId);
  assert.deepEqual(await boughtIds(), before, 'same period rebuild keeps marks');

  for (const data of [`sl_tgl_${oldId}_${before[0]}_0`, `sl_check_${oldId}_0`, `sl_reset_${oldId}_0`]) {
    reset();
    await sendCallback(data);
    assert.deepEqual(methods(), ['editMessageText', 'answerCallbackQuery'], data);
    assert.equal(calls[1].payload.text, T.staleList, data);
    assert.ok(calls[0].payload.text.startsWith(`<b>${texts.shoppingList.title}</b>`), data);
    assert.equal(callbackData(calls[0].payload)[0], `sl_check_${newId}_0`, data);
  }
  assert.deepEqual(await boughtIds(), before);
});

test('reset clears every mark and keeps the page', async () => {
  const { listId } = await getLastShoppingList(TELEGRAM_ID);
  await sendCallback(`sl_reset_${listId}_1`);
  assert.deepEqual(methods(), ['editMessageText', 'answerCallbackQuery']);
  assert.equal(calls[1].payload.text, T.resetDone);
  assert.deepEqual(await boughtIds(), []);
  assert.ok(callbackData(calls[0].payload).filter(d => d.startsWith('sl_tgl_')).every(d => d.endsWith('_1')));
  assert.ok(!callbackData(calls[0].payload).some(d => d.startsWith('sl_reset_')));
});
