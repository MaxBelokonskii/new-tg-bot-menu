const { seedDb } = require('../helpers/memory-db');
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const texts = require('../../src/bot/texts');
const { dbGet, dbAll } = require('../../src/database/db');
const { addDays, getWeekBounds } = require('../../src/utils/date-helpers');
const { defaultClock } = require('../helpers/clock');
const { getOrCreateUser, saveSelectedDish } = require('../../src/features/weekly-planner/logic');
const { saveUserProfile } = require('../../src/features/profile/logic');
const { createFakeBot } = require('../helpers/fake-bot');

const TELEGRAM_ID = 8001;
const T = texts.foodLog;
const TODAY = defaultClock().today;
const YESTERDAY = addDays(TODAY, -1);

const { calls, sendText, sendCallback, methods, reset } = createFakeBot(TELEGRAM_ID);

const callbackData = (payload) => (payload.reply_markup?.inline_keyboard || [])
  .flat().map(b => b.callback_data);
const recipeId = async (name) => (await dbGet('SELECT id FROM recipes WHERE name = ?', [name])).id;
const logRows = async () => dbAll(
  'SELECT id, date, recipe_id, portion, slot FROM food_log WHERE user_id = ? ORDER BY id',
  [await getOrCreateUser(TELEGRAM_ID)]
);

before(seedDb);
beforeEach(reset);

test('main menu has the diary button; empty diary without a profile shows the hint', async () => {
  await sendText('/start');
  const keyboard = calls[1].payload.reply_markup.keyboard.flat().map(b => b.text ?? b);
  assert.ok(keyboard.includes(texts.mainMenu.buttons.foodLog));

  reset();
  await sendText(texts.mainMenu.buttons.foodLog);
  assert.deepEqual(methods(), ['sendMessage']);
  const { text } = calls[0].payload;
  assert.ok(text.includes(T.empty));
  assert.ok(text.includes(T.noProfileHint));
  assert.deepEqual(callbackData(calls[0].payload), [
    `fl_plan_${TODAY}`, `fl_search_${TODAY}`, `fl_fav_${TODAY}_0`, `fl_day_${YESTERDAY}`,
    `st_week_${getWeekBounds(TODAY).start}`
  ]);
});

test('add from plan: empty plan alerts; plan dish → portion → entry with slot', async () => {
  await sendCallback(`fl_plan_${TODAY}`);
  assert.deepEqual(methods(), ['answerCallbackQuery']);
  assert.equal(calls[0].payload.text, T.plan.empty);

  const breakfast = await recipeId('Омлет с сыром');
  await saveSelectedDish(TELEGRAM_ID, breakfast, TODAY);
  reset();
  await sendCallback(`fl_plan_${TODAY}`);
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText']);
  const pick = `fl_pick_${TODAY}_${breakfast}_1`;
  assert.deepEqual(callbackData(calls[1].payload), [pick, `fl_day_${TODAY}`]);

  reset();
  await sendCallback(pick);
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText']);
  assert.ok(calls[1].payload.text.includes('Омлет с сыром'));
  const portions = callbackData(calls[1].payload);
  assert.deepEqual(portions.slice(0, 4), [1, 2, 3, 4].map(h => `fl_add_${TODAY}_${breakfast}_1_${h}`));

  reset();
  await sendCallback(portions[2]);
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText']);
  assert.equal(calls[0].payload.text, T.added);
  assert.ok(calls[1].payload.text.includes('Омлет с сыром ×1½'));
  const rows = await logRows();
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { date: rows[0].date, recipe: rows[0].recipe_id, portion: rows[0].portion, slot: rows[0].slot },
    { date: TODAY, recipe: breakfast, portion: 1.5, slot: 1 }
  );
});

test('search scene: short query → not found → results → pick logs without slot', async () => {
  await sendCallback(`fl_search_${YESTERDAY}`);
  assert.deepEqual(methods(), ['answerCallbackQuery', 'sendMessage']);
  assert.equal(calls[1].payload.text, T.search.ask);

  reset();
  await sendText('о');
  assert.equal(calls[0].payload.text, T.search.tooShort);
  reset();
  await sendText('абракадабра');
  assert.equal(calls[0].payload.text, T.search.notFound.replace('{query}', 'абракадабра'));

  reset();
  await sendText('ТВОРОЖНЫЙ ОМЛЕТ');
  assert.deepEqual(methods(), ['sendMessage']);
  const omelet = await recipeId('Творожный омлет');
  const buttons = callbackData(calls[0].payload);
  assert.equal(buttons[0], `fl_pick_${YESTERDAY}_${omelet}_0`);
  assert.ok(buttons.includes(`fl_search_${YESTERDAY}`));

  // сцена закрыта после выдачи — следующий текст в неё не попадает
  reset();
  await sendText('омлет');
  assert.ok(!calls.some(c => c.payload.text?.startsWith('🔍')));

  reset();
  await sendCallback(`fl_add_${YESTERDAY}_${omelet}_0_2`);
  assert.equal(calls[0].payload.text, T.added);
  assert.ok(calls[1].payload.text.includes(T.dayYesterday.split(',')[0]));
  const last = (await logRows()).at(-1);
  assert.deepEqual([last.date, last.recipe_id, last.portion, last.slot], [YESTERDAY, omelet, 1, null]);
});

test('search scene: main-menu/inline buttons leave the scene and are routed; /cancel works', async () => {
  await sendCallback(`fl_search_${TODAY}`);
  reset();
  await sendText(texts.mainMenu.buttons.foodLog);
  assert.deepEqual(methods(), ['sendMessage']);
  assert.ok(calls[0].payload.text.startsWith(T.title.split(' — ')[0]));

  await sendCallback(`fl_search_${TODAY}`);
  reset();
  await sendCallback(`fl_day_${TODAY}`);
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText'], 'button press leaves the scene');

  await sendCallback(`fl_search_${TODAY}`);
  reset();
  await sendText('/cancel');
  assert.equal(calls[0].payload.text, T.search.canceled);
});

test('day screen with a profile shows norms; delete from the entry editor', async () => {
  await saveUserProfile(TELEGRAM_ID, {
    weight: 80, height: 180, age: 30, sex: 'male', activity_level: 'moderate', goal: 'maintain'
  });
  await sendCallback(`fl_day_${TODAY}`);
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText']);
  const { text } = calls[1].payload;
  assert.ok(text.includes(`${T.nutrients.protein}: `));
  assert.ok(text.includes('🟩') || text.includes('⬜') || text.includes('🟥'));
  assert.ok(!text.includes(T.noProfileHint));

  const [entry] = await logRows();
  assert.ok(!callbackData(calls[1].payload).some(d => d.startsWith('fl_del_')), 'delete lives in the editor');
  assert.ok(callbackData(calls[1].payload).includes(`fl_entry_${entry.id}`));

  reset();
  await sendCallback(`fl_entry_${entry.id}`);
  const del = callbackData(calls[1].payload).find(d => d.startsWith('fl_del_'));
  assert.equal(del, `fl_del_${entry.id}`);

  reset();
  await sendCallback(del);
  assert.equal(calls[0].payload.text, T.deleted);
  assert.ok(calls[1].payload.text.includes(T.empty));
  reset();
  await sendCallback(del);
  assert.equal(calls[0].payload.text, T.entryNotFound);
});

test('entry editor: current portion marked, new portion saved, back keeps it', async () => {
  const omelet = await recipeId('Омлет с сыром');
  await sendCallback(`fl_add_${YESTERDAY}_${omelet}_0_2`);
  const entry = (await logRows()).at(-1);
  const screen = calls.at(-1).payload;
  const editBtn = screen.reply_markup.inline_keyboard.flat().find(b => b.callback_data === `fl_entry_${entry.id}`);
  assert.ok(editBtn.text.startsWith('✏️'));

  reset();
  await sendCallback(`fl_entry_${entry.id}`);
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText']);
  const editor = calls[1].payload;
  assert.ok(editor.text.includes('Омлет с сыром'));
  const [portionRow, actionRow] = editor.reply_markup.inline_keyboard;
  assert.deepEqual(portionRow.map(b => b.callback_data), [1, 2, 3, 4].map(h => `fl_port_${entry.id}_${h}`));
  assert.deepEqual(portionRow.map(b => b.text), ['½', T.edit.currentMark.replace('{portion}', '1'), '1½', '2']);
  assert.deepEqual(actionRow.map(b => b.callback_data), [`fl_del_${entry.id}`, `fl_day_${YESTERDAY}`]);
  assert.ok([...portionRow, ...actionRow].every(b => Buffer.byteLength(b.callback_data) <= 64));

  // «назад» — без изменений
  reset();
  await sendCallback(`fl_day_${YESTERDAY}`);
  assert.equal((await logRows()).at(-1).portion, 1);

  reset();
  await sendCallback(`fl_port_${entry.id}_3`);
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText']);
  assert.equal(calls[0].payload.text, T.portionUpdated);
  assert.ok(calls[1].payload.text.includes('Омлет с сыром ×1½'));
  assert.ok(calls[1].payload.text.includes(T.dayYesterday.split(',')[0]), 'same day re-rendered');
  assert.equal((await logRows()).at(-1).portion, 1.5);

  reset();
  await sendCallback(`fl_entry_${entry.id}`);
  const marked = calls[1].payload.reply_markup.inline_keyboard[0].map(b => b.text);
  assert.deepEqual(marked, ['½', '1', T.edit.currentMark.replace('{portion}', '1½'), '2']);
});

test('entry editor refuses foreign, missing and out-of-window entries', async () => {
  const omelet = await recipeId('Омлет с сыром');
  const { addEntry } = require('../../src/features/food-log/logic');
  const foreign = await addEntry(TELEGRAM_ID + 1, { recipeId: omelet, date: TODAY });
  const old = await addEntry(TELEGRAM_ID, { recipeId: omelet, date: addDays(TODAY, -30) });

  for (const [data, toast] of [
    [`fl_entry_${foreign}`, T.entryNotFound],
    [`fl_port_${foreign}_4`, T.entryNotFound],
    ['fl_entry_999999', T.entryNotFound],
    [`fl_entry_${old}`, T.entryOutOfRange],
    [`fl_port_${old}_4`, T.entryOutOfRange]
  ]) {
    reset();
    await sendCallback(data);
    assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText'], data);
    assert.equal(calls[0].payload.text, toast, data);
    assert.ok(calls[1].payload.text.includes(T.dayToday.split(',')[0]), `${data} falls back to today`);
  }
  const portions = await dbAll('SELECT portion FROM food_log WHERE id IN (?, ?)', [foreign, old]);
  assert.deepEqual(portions.map(r => r.portion), [1, 1]);

  reset();
  await sendCallback(`fl_port_${foreign}_5`);
  assert.ok(!methods().includes('editMessageText'), 'halves outside 1..4 are not routed');
});

test('day navigation: yesterday ↔ today, out-of-window dates fall back to today', async () => {
  await sendCallback(`fl_day_${YESTERDAY}`);
  assert.ok(callbackData(calls[1].payload).includes(`fl_day_${TODAY}`));
  const labels = calls[1].payload.reply_markup.inline_keyboard.flat().map(b => b.text);
  assert.ok(labels.includes(T.buttons.fromPlanDay) && labels.includes(T.buttons.nextToday));
  assert.ok(callbackData(calls[1].payload).includes(`fl_day_${addDays(TODAY, -2)}`));

  reset();
  await sendCallback(`fl_day_${addDays(TODAY, 1)}`);
  assert.equal(calls[0].payload.text, T.dateOutOfRange);
  assert.ok(calls[1].payload.text.includes(T.dayToday.split(',')[0]));

  reset();
  await sendCallback(`fl_add_${addDays(TODAY, -30)}_1_0_2`);
  assert.equal(calls[0].payload.text, T.dateOutOfRange);
});

test('"🍽 Съел" on recipe cards opens the portion picker for today', async () => {
  await sendCallback('select_cat_desserts');
  const eat = callbackData(calls.at(-1).payload).find(d => d.startsWith('fl_eat_'));
  assert.ok(eat, 'random dish card has the ate button');

  reset();
  await sendCallback(eat);
  assert.deepEqual(methods(), ['answerCallbackQuery', 'sendMessage']);
  const id = eat.slice('fl_eat_'.length);
  assert.deepEqual(
    callbackData(calls[1].payload).slice(0, 4),
    [1, 2, 3, 4].map(h => `fl_add_${TODAY}_${id}_0_${h}`)
  );

  reset();
  await sendCallback('fl_eat_999999');
  assert.equal(calls[0].payload.text, T.recipeNotFound);

  const { buildRecipeCard } = require('../../src/interface/reverse-search');
  const card = buildRecipeCard({ id: 5, name: 'X', calories: 1, protein: 1, fat: 1, carbs: 1 }, [], []);
  assert.ok(card.keyboard.reply_markup.inline_keyboard.flat().some(b => b.callback_data === 'fl_eat_5'));
});
