const { seedDb } = require('../helpers/memory-db');
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const texts = require('../../src/bot/texts');
const { dbAll } = require('../../src/database/db');
const { defaultClock } = require('../helpers/clock');
const { getDayPlan } = require('../../src/features/weekly-planner/day-plan');
const { saveSelectedDish } = require('../../src/features/weekly-planner/logic');
const { createFakeBot } = require('../helpers/fake-bot');

// «➕ В план» из «Что ещё съесть» не перезаписывает занятые слоты молча.
const TELEGRAM_ID = 8201;
const T = texts.whatToEat;
const DS = texts.dishSelection;
const TODAY = defaultClock().today;
const { calls, sendCallback, methods, reset } = createFakeBot(TELEGRAM_ID);

const byCategory = {};
const toast = () => calls.find(c => c.method === 'answerCallbackQuery').payload.text;
const questions = () => calls.filter(c => c.method === 'sendMessage').map(c => c.payload);
const swapData = (payload) => payload.reply_markup.inline_keyboard.flat()
  .map(b => b.callback_data).filter(d => d.startsWith(`dish_swap_${TODAY}_`));
const plan = async () => (await getDayPlan(TELEGRAM_ID, TODAY)).map(i => [i.slot, i.recipe_id]);

before(async () => {
  await seedDb();
  const rows = await dbAll(
    `SELECT r.id, mc.name AS category FROM recipes r
     JOIN meal_categories mc ON r.category_id = mc.id ORDER BY r.id`
  );
  for (const { id, category } of rows) (byCategory[category] ||= []).push(id);
});
beforeEach(reset);

test('free slot: the dish is added with a toast only', async () => {
  const [breakfast] = byCategory.breakfast;
  await sendCallback(`wte_plan_${breakfast}`);
  assert.deepEqual(methods(), ['answerCallbackQuery']);
  assert.equal(toast(), DS.added);
  assert.deepEqual(await plan(), [[1, breakfast]]);
});

test('same dish again: "already planned", nothing changes', async () => {
  const [breakfast] = byCategory.breakfast;
  await sendCallback(`wte_plan_${breakfast}`);
  assert.equal(toast(), DS.unchanged);
  assert.deepEqual(await plan(), [[1, breakfast]]);
});

test('taken slot: asks "replace?" in a new message and keeps the plan', async () => {
  const [old, other] = byCategory.breakfast;
  await sendCallback(`wte_plan_${other}`);
  assert.deepEqual(methods(), ['answerCallbackQuery', 'sendMessage']);
  const [question] = questions();
  assert.deepEqual(swapData(question), [`dish_swap_${TODAY}_1_${other}`]);
  assert.deepEqual(await plan(), [[1, old]]);

  reset();
  await sendCallback(`dish_swap_${TODAY}_1_${other}`);
  assert.deepEqual(await plan(), [[1, other]]);
});

test('combo: free slots filled, taken ones asked, planned ones reported', async () => {
  const [main1, main2, main3] = byCategory.main;
  const [salad] = byCategory.salads;
  await saveSelectedDish(TELEGRAM_ID, main1, TODAY);
  await saveSelectedDish(TELEGRAM_ID, main2, TODAY);
  const breakfast = (await plan())[0][1];

  // завтрак уже в плане, основные заняты, салат — свободен
  await sendCallback(`wte_planc_${breakfast}-${main3}-${salad}`);
  assert.equal(toast(), [
    T.comboPlanned.replace('{count}', 1),
    T.comboAlready.replace('{count}', 1),
    T.comboAsked.replace('{count}', 1)
  ].join(T.toastJoin));
  const asked = questions();
  assert.equal(asked.length, 1);
  assert.deepEqual(swapData(asked[0]), [`dish_swap_${TODAY}_2_${main3}`, `dish_swap_${TODAY}_3_${main3}`]);
  assert.deepEqual(await plan(), [[1, breakfast], [2, main1], [3, main2], [4, salad]]);
});

test('combo of two mains on an empty day takes both main slots without questions', async () => {
  const [, , , m4, m5] = byCategory.main;
  // новый пользователь — пустой день: второе основное должно уйти в слот 3, а не спросить про слот 2
  const other = createFakeBot(TELEGRAM_ID + 1);
  await other.sendCallback(`wte_planc_${m4}-${m5}`);
  const otherToast = other.calls.find(c => c.method === 'answerCallbackQuery').payload.text;
  assert.equal(otherToast, T.comboPlanned.replace('{count}', 2));
  assert.equal(other.calls.filter(c => c.method === 'sendMessage').length, 0);
  const otherPlan = await getDayPlan(TELEGRAM_ID + 1, TODAY);
  assert.deepEqual(otherPlan.map(i => [i.slot, i.recipe_id]), [[2, m4], [3, m5]]);
});
