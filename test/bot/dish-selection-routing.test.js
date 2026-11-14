const { seedDb } = require('../helpers/memory-db');
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const texts = require('../../src/bot/texts');
const { dbAll } = require('../../src/database/db');
const { formatLocalDate, addDays } = require('../../src/utils/date-helpers');
const { getDayPlan, checkDishPlacement } = require('../../src/features/weekly-planner/day-plan');
const { buildRecipeCard } = require('../../src/interface/reverse-search');
const { createFakeBot } = require('../helpers/fake-bot');

const TELEGRAM_ID = 9301;
const T = texts.dishSelection;
const TODAY = formatLocalDate(new Date());
const { calls, sendCallback, methods, reset } = createFakeBot(TELEGRAM_ID);

const callbackData = (payload) => (payload.reply_markup?.inline_keyboard || [])
  .flat().map(b => b.callback_data);
const toast = () => calls.find(c => c.method === 'answerCallbackQuery').payload.text;
const recipes = async (category) => dbAll(
  `SELECT r.id, r.name, r.servings FROM recipes r JOIN meal_categories mc ON r.category_id = mc.id
   WHERE mc.name = ? ORDER BY r.id`,
  [category]
);
const planNames = async () => (await getDayPlan(TELEGRAM_ID, TODAY)).map(i => [i.slot, i.name]);

before(seedDb);
beforeEach(reset);

test('recipe cards show servings and per-serving nutrition', async () => {
  await sendCallback('select_cat_main');
  const { text } = calls.find(c => c.method === 'editMessageText').payload;
  assert.match(text, /КБЖУ на порцию: /);
  assert.match(text, /Ингредиенты \(на \d+ порци(ю|и|й)\):/);

  const card = buildRecipeCard(
    { id: 1, name: 'X', calories: 1, protein: 1, fat: 1, carbs: 1, servings: 3 }, [], []
  );
  assert.ok(card.text.includes('Ингредиенты (на 3 порции):'));
});

test('free slot: dish is added and today summary is shown', async () => {
  const [b1] = await recipes('breakfast');
  await sendCallback(`confirm_dish_${b1.id}`);
  assert.deepEqual(methods(), ['answerCallbackQuery', 'sendMessage']);
  assert.equal(toast(), T.added);
  const { text } = calls[1].payload;
  assert.ok(text.startsWith(T.added));
  assert.ok(text.includes(T.summaryTitle));
  assert.ok(text.includes(`Завтрак: ${b1.name}`));
  assert.deepEqual(callbackData(calls[1].payload), ['back_to_categories', `wp_day_${TODAY}`]);
  assert.deepEqual(await planNames(), [[1, b1.name]]);

  reset();
  await sendCallback(`confirm_dish_${b1.id}`);
  assert.equal(toast(), T.unchanged);
});

test('occupied slot: asks "replace?"; No keeps, Yes replaces', async () => {
  const [b1, b2] = await recipes('breakfast');
  await sendCallback(`confirm_dish_${b2.id}`);
  assert.deepEqual(methods(), ['answerCallbackQuery', 'sendMessage']);
  const question = calls[1].payload;
  assert.equal(question.text, T.replaceAsk
    .replace('{slot}', 'Завтрак').replace('{old}', b1.name).replace('{new}', b2.name));
  const swap = `dish_swap_${TODAY}_1_${b2.id}`;
  assert.deepEqual(callbackData(question), [swap, 'dish_keep']);
  assert.deepEqual(await planNames(), [[1, b1.name]], 'nothing written before the answer');

  reset();
  await sendCallback('dish_keep');
  assert.equal(calls[1].payload.text, T.kept);
  assert.deepEqual(await planNames(), [[1, b1.name]]);

  reset();
  await sendCallback(swap);
  assert.deepEqual(methods(), ['editMessageText', 'answerCallbackQuery']);
  assert.ok(calls[0].payload.text.startsWith(T.replaced));
  assert.equal(toast(), T.replaced);
  assert.deepEqual(await planNames(), [[1, b2.name]]);
});

test('both main slots taken: one option per slot; stale question is not applied', async () => {
  const [m1, m2, m3] = await recipes('main');
  await sendCallback(`confirm_dish_${m1.id}`);
  await sendCallback(`confirm_dish_${m2.id}`);
  assert.deepEqual((await planNames()).filter(([s]) => s > 1), [[2, m1.name], [3, m2.name]]);

  const placement = await checkDishPlacement(TELEGRAM_ID, m3.id, TODAY);
  assert.equal(placement.freeSlot, null);
  assert.equal(placement.alreadyPlanned, false);

  reset();
  await sendCallback(`confirm_dish_${m3.id}`);
  assert.equal(calls[1].payload.text, T.replaceAskMain.replace('{new}', m3.name));
  assert.deepEqual(callbackData(calls[1].payload), [
    `dish_swap_${TODAY}_2_${m3.id}`, `dish_swap_${TODAY}_3_${m3.id}`, 'dish_keep'
  ]);

  reset();
  await sendCallback(`dish_swap_${TODAY}_3_${m3.id}`);
  assert.deepEqual((await planNames()).filter(([s]) => s > 1), [[2, m1.name], [3, m3.name]]);

  reset();
  await sendCallback(`dish_swap_${addDays(TODAY, -1)}_2_${m2.id}`);
  assert.equal(toast(), T.stale);
  assert.deepEqual((await planNames()).filter(([s]) => s > 1), [[2, m1.name], [3, m3.name]]);
});

test('unknown recipe answers with an error toast', async () => {
  await sendCallback('confirm_dish_999999');
  assert.deepEqual(methods(), ['answerCallbackQuery']);
  assert.equal(toast(), T.errorSave);
});
