const { seedDb } = require('../helpers/memory-db');
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const texts = require('../../src/bot/texts');
const { saveUserProfile } = require('../../src/features/profile/logic');
const { getDayLog } = require('../../src/features/food-log/logic');
const { dbAll } = require('../../src/database/db');
const { defaultClock } = require('../helpers/clock');
const { createFakeBot } = require('../helpers/fake-bot');

const TELEGRAM_ID = 8101;
const T = texts.whatToEat;
const SURVEY = { weight: 80, height: 180, age: 30, sex: 'male', activity_level: 'moderate', goal: 'maintain' };
const { calls, sendText, sendCallback, methods, reset } = createFakeBot(TELEGRAM_ID);

const callbackData = (payload) => (payload.reply_markup?.inline_keyboard || []).flat().map(b => b.callback_data);
const lastEdit = () => calls.filter(c => c.method === 'editMessageText').at(-1).payload;
const today = () => defaultClock().today;
const plannedToday = async () => (await dbAll(
  `SELECT dmi.recipe_id FROM daily_menu_items dmi
   JOIN daily_menu dm ON dm.id = dmi.daily_menu_id
   JOIN users u ON u.id = dm.user_id
   WHERE u.telegram_id = ? AND dm.date = ?`, [TELEGRAM_ID, today()]
)).map(r => r.recipe_id);

before(seedDb);
beforeEach(reset);

test('without a profile the diary has no button and the callback answers with an alert', async () => {
  await sendText(texts.mainMenu.buttons.foodLog);
  assert.ok(!callbackData(calls[0].payload).includes('wte_show_0'));
  reset();
  await sendCallback('wte_show_0');
  assert.deepEqual(methods(), ['answerCallbackQuery']);
  assert.equal(calls[0].payload.text, T.noTargets);
  assert.equal(calls[0].payload.show_alert, true);
});

test('diary → suggestions screen with eat / plan / more / back buttons', async () => {
  await saveUserProfile(TELEGRAM_ID, SURVEY);
  await sendText(texts.mainMenu.buttons.foodLog);
  assert.ok(callbackData(calls[0].payload).includes('wte_show_0'));

  reset();
  await sendCallback('wte_show_0');
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText']);
  const screen = lastEdit();
  assert.ok(screen.text.startsWith(T.title));
  const data = callbackData(screen);
  assert.equal(data.filter(d => /^wte_eat_\d+_[1-4]$/.test(d)).length, 3);
  assert.equal(data.filter(d => /^wte_plan_\d+$/.test(d)).length, 3);
  assert.ok(data.some(d => d.startsWith('wte_eatc_')));
  assert.ok(data.some(d => d.startsWith('wte_planc_')));
  assert.ok(data.includes('wte_show_1'));
  assert.ok(data.includes(`fl_day_${today()}`));
  for (const d of data) assert.ok(Buffer.byteLength(d) <= 64, d);
});

test('"ate" logs the dish and re-renders; "to plan" adds it to today', async () => {
  await sendCallback('wte_show_0');
  const data = callbackData(lastEdit());
  const eat = data.find(d => d.startsWith('wte_eat_'));
  const [, recipeId, halves] = eat.match(/^wte_eat_(\d+)_(\d)$/);

  reset();
  await sendCallback(eat);
  assert.equal(calls[0].payload.text, T.eaten);
  assert.ok(lastEdit().text.startsWith(T.title));
  const log = await getDayLog(TELEGRAM_ID, today());
  assert.deepEqual(log.map(e => [e.recipeId, e.portion]), [[Number(recipeId), Number(halves) / 2]]);
  assert.ok(!callbackData(lastEdit()).includes(eat), 'eaten dish is not suggested again');

  const plan = callbackData(lastEdit()).find(d => d.startsWith('wte_plan_'));
  reset();
  await sendCallback(plan);
  assert.deepEqual(methods(), ['answerCallbackQuery']);
  assert.equal(calls[0].payload.text, texts.dishSelection.added);
  assert.ok((await plannedToday()).includes(Number(plan.slice('wte_plan_'.length))));
});

test('combo buttons log every dish and add them to the plan', async () => {
  await sendCallback('wte_show_0');
  const data = callbackData(lastEdit());
  const eatCombo = data.find(d => d.startsWith('wte_eatc_'));
  const before = (await getDayLog(TELEGRAM_ID, today())).length;
  const size = eatCombo.slice('wte_eatc_'.length).split('-').length;

  reset();
  await sendCallback(eatCombo);
  assert.equal(calls[0].payload.text, T.comboEaten.replace('{count}', size));
  assert.equal((await getDayLog(TELEGRAM_ID, today())).length, before + size);

  const planCombo = callbackData(lastEdit()).find(d => d.startsWith('wte_planc_'));
  const ids = planCombo.slice('wte_planc_'.length).split('-').map(Number);
  reset();
  await sendCallback(planCombo);
  assert.equal(calls[0].payload.text, T.comboPlanned.replace('{count}', ids.length));
  const planned = await plannedToday();
  assert.ok(ids.some(id => planned.includes(id)));
});
