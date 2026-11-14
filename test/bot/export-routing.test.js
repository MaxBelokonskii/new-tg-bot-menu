const { seedDb } = require('../helpers/memory-db');
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const texts = require('../../src/bot/texts');
const { dbRun } = require('../../src/database/db');
const { addDays } = require('../../src/utils/date-helpers');
const { generateWeeklyPlan } = require('../../src/features/weekly-planner/generator');
const { getLastShoppingList } = require('../../src/features/shopping-list/logic');
const { planWeeks } = require('../../src/features/weekly-planner/plan-weeks');
const { fillWeek } = require('../../src/interface/weekly-plan');
const { defaultClock } = require('../helpers/clock');
const { createFakeBot } = require('../helpers/fake-bot');

const TELEGRAM_ID = 9701;
const E = texts.export;
const { today: TODAY } = defaultClock();
const { current: THIS_WEEK, next: NEXT_WEEK } = planWeeks(TODAY);

const { calls, sendText, sendCallback, methods, reset } = createFakeBot(TELEGRAM_ID);

const callbackData = (payload) => (payload.reply_markup?.inline_keyboard || []).flat().map(b => b.callback_data);
const lastPayload = (method) => calls.filter(c => c.method === method).at(-1).payload;
const answer = () => calls.find(c => c.method === 'answerCallbackQuery').payload;

/**
 * The document sent with sendDocument: its file name and UTF-8 text.
 * @returns {{filename: string, text: string}}
 */
function sentFile() {
  const { document } = lastPayload('sendDocument');
  return { filename: document.filename, text: document.source.toString('utf8') };
}

before(seedDb);
beforeEach(reset);

test('shopping list: no list → alert, no file and no export button', async () => {
  await sendText(texts.mainMenu.buttons.shoppingList);
  assert.ok(!callbackData(calls[0].payload).includes('sl_export'));

  reset();
  await sendCallback('sl_export');
  assert.deepEqual(methods(), ['answerCallbackQuery']);
  assert.equal(answer().text, E.noList);
  assert.equal(answer().show_alert, true);
});

test('week plan: empty week → alert with the week, no file', async () => {
  await sendCallback(`wp_export_${THIS_WEEK.start}`);
  assert.deepEqual(methods(), ['answerCallbackQuery']);
  assert.equal(answer().text, fillWeek(E.emptyWeek, 'current', THIS_WEEK.start));
  assert.equal(answer().show_alert, true);
});

test('shopping list: the current list as .txt with marks and the bought counter', async () => {
  await generateWeeklyPlan(TELEGRAM_ID, { week: THIS_WEEK });
  await sendCallback('generate_shopping_list_week');
  assert.ok(callbackData(lastPayload('editMessageText')).includes('sl_export'), 'export button on the list');
  const { listId, items } = await getLastShoppingList(TELEGRAM_ID);
  await dbRun('UPDATE shopping_list_items SET is_bought = 1 WHERE shopping_list_id = ? AND ingredient_id = ?',
    [listId, items[0].ingredientId]);

  reset();
  await sendCallback('sl_export');
  assert.deepEqual(methods(), ['answerCallbackQuery', 'sendDocument']);
  assert.equal(answer().text, E.sent);
  assert.equal(calls[1].payload.chat_id, TELEGRAM_ID);
  const { filename, text } = sentFile();
  assert.equal(filename, `shopping-list-${THIS_WEEK.start}.txt`);
  assert.ok(text.startsWith(`${texts.shoppingList.title} (на эту неделю, `));
  assert.ok(text.includes(`☑ ${items[0].name} — `), 'bought item is checked');
  assert.equal(text.split('\n').filter(line => line.startsWith('☐ ')).length, items.length - 1);
  assert.ok(text.trimEnd().endsWith(`Куплено: 1 из ${items.length}`));
  assert.ok(!/<\/?[a-z]+>/.test(text), 'plain text');
});

test('week plan: this week from the day screen button as .txt', async () => {
  await sendCallback(`wp_day_${TODAY}`);
  assert.ok(callbackData(lastPayload('editMessageText')).includes(`wp_export_${THIS_WEEK.start}`));

  reset();
  await sendCallback(`wp_export_${THIS_WEEK.start}`);
  assert.deepEqual(methods(), ['answerCallbackQuery', 'sendDocument']);
  const { filename, text } = sentFile();
  assert.equal(filename, `meal-plan-${THIS_WEEK.start}.txt`);
  assert.ok(text.startsWith(fillWeek(E.plan.title, 'current', THIS_WEEK.start)));
  assert.equal(text.split('\n').filter(line => line.startsWith('• ')).length, 35, '7 days × 5 slots');
  assert.equal(text.split('\n').filter(line => line.startsWith('Итого за день: ')).length, 7);
  assert.ok(text.includes(E.plan.weekHeader.replace('{days}', 7)));
  assert.ok(!text.includes(E.plan.empty));
});

test('week plan: next week has its own button and file; empty days are marked', async () => {
  await generateWeeklyPlan(TELEGRAM_ID, { week: NEXT_WEEK });
  await dbRun(
    `DELETE FROM daily_menu_items WHERE daily_menu_id IN (
       SELECT dm.id FROM daily_menu dm JOIN users u ON u.id = dm.user_id
       WHERE u.telegram_id = ? AND dm.date = ?)`,
    [TELEGRAM_ID, addDays(NEXT_WEEK.start, 2)]
  );
  await sendCallback(`wp_day_${NEXT_WEEK.start}`);
  const data = callbackData(lastPayload('editMessageText'));
  assert.ok(data.includes(`wp_export_${NEXT_WEEK.start}`));
  assert.ok(!data.includes(`wp_export_${THIS_WEEK.start}`));

  reset();
  await sendCallback(`wp_export_${NEXT_WEEK.start}`);
  const { filename, text } = sentFile();
  assert.equal(filename, `meal-plan-${NEXT_WEEK.start}.txt`);
  assert.ok(text.startsWith(fillWeek(E.plan.title, 'next', NEXT_WEEK.start)));
  assert.equal(text.split('\n').filter(line => line === E.plan.empty).length, 1, 'Wednesday is empty');
  assert.ok(text.includes(E.plan.weekHeader.replace('{days}', 6)));
});

test('week plan: a stale or forged Monday → toast, no file', async () => {
  for (const monday of [addDays(THIS_WEEK.start, -7), addDays(NEXT_WEEK.start, 7), addDays(THIS_WEEK.start, 1)]) {
    reset();
    await sendCallback(`wp_export_${monday}`);
    assert.deepEqual(methods(), ['answerCallbackQuery'], monday);
    assert.equal(answer().text, E.staleWeek);
  }
});
