const { seedDb } = require('../helpers/memory-db');
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const texts = require('../../src/bot/texts');
const { dbAll } = require('../../src/database/db');
const { formatLocalDate } = require('../../src/utils/date-helpers');
const { getOrCreateUser } = require('../../src/features/weekly-planner/logic');
const { setFavorite, isFavorite } = require('../../src/features/favorite-recipes/logic');
const { buildRecipeCard } = require('../../src/interface/reverse-search');
const { createFakeBot } = require('../helpers/fake-bot');

const TELEGRAM_ID = 9401;
const T = texts.favoriteRecipes;
const TODAY = formatLocalDate(new Date());
const { calls, sendText, sendCallback, methods, reset } = createFakeBot(TELEGRAM_ID);

const callbackData = (payload) => (payload.reply_markup?.inline_keyboard || [])
  .flat().map(b => b.callback_data);
const lastEdit = () => calls.filter(c => c.method === 'editMessageText').at(-1).payload;
const toast = () => calls.find(c => c.method === 'answerCallbackQuery').payload;
const favButton = (markup) => markup.inline_keyboard.flat().find(b => /^fav_(add|rm)_/.test(b.callback_data));
const recipeIds = async (limit) => (await dbAll('SELECT id FROM recipes ORDER BY id LIMIT ?', [limit])).map(r => r.id);
const logRows = async () => dbAll(
  'SELECT recipe_id, portion, slot, date FROM food_log WHERE user_id = ?',
  [await getOrCreateUser(TELEGRAM_ID)]
);

before(seedDb);
beforeEach(reset);

test('category picker has the favorites entry; empty list shows the hint', async () => {
  await sendText(texts.mainMenu.buttons.suggestions);
  assert.ok(callbackData(calls[0].payload).includes('fav_list_0'));

  reset();
  await sendCallback('fav_list_0');
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText']);
  assert.equal(lastEdit().text, T.empty);
  assert.deepEqual(callbackData(lastEdit()), ['back_to_categories']);
});

test('⭐ on a random card adds, then removes; only the keyboard is redrawn', async () => {
  await sendCallback('select_cat_desserts');
  const card = lastEdit().reply_markup;
  const addBtn = favButton(card);
  assert.equal(addBtn.text, T.addBtn);
  const recipeId = Number(addBtn.callback_data.slice('fav_add_'.length));
  const row = card.inline_keyboard.find(r => r.includes(addBtn));
  assert.deepEqual(row.map(b => b.callback_data), [`fl_eat_${recipeId}`, addBtn.callback_data]);

  reset();
  await sendCallback(addBtn.callback_data, { replyMarkup: card });
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageReplyMarkup']);
  assert.equal(toast().text, T.added);
  const flipped = calls[1].payload.reply_markup;
  assert.deepEqual(favButton(flipped), { text: T.removeBtn, callback_data: `fav_rm_${recipeId}` });
  assert.deepEqual(
    callbackData({ reply_markup: flipped }).filter(d => !d.startsWith('fav_')),
    callbackData({ reply_markup: card }).filter(d => !d.startsWith('fav_')),
    'other buttons are kept'
  );
  assert.equal(await isFavorite(TELEGRAM_ID, recipeId), true);

  reset();
  await sendCallback(`fav_rm_${recipeId}`, { replyMarkup: flipped });
  assert.equal(toast().text, T.removed);
  assert.deepEqual(favButton(calls[1].payload.reply_markup), { text: T.addBtn, callback_data: `fav_add_${recipeId}` });
  assert.equal(await isFavorite(TELEGRAM_ID, recipeId), false);

  reset();
  await sendCallback('fav_add_999999');
  assert.deepEqual(methods(), ['answerCallbackQuery']);
  assert.equal(toast().text, T.recipeNotFound);
});

test('reverse-search card shows the button for the current state', () => {
  const recipe = { id: 5, name: 'X', calories: 1, protein: 1, fat: 1, carbs: 1, servings: 1 };
  assert.equal(favButton(buildRecipeCard(recipe, [], []).keyboard.reply_markup).callback_data, 'fav_add_5');
  assert.equal(
    favButton(buildRecipeCard(recipe, [], [], { favorite: true }).keyboard.reply_markup).callback_data,
    'fav_rm_5'
  );
});

test('list pages, opening a card and going back to the same page', async () => {
  const nine = await recipeIds(9);
  for (const id of nine) await setFavorite(TELEGRAM_ID, id, true);

  await sendCallback('fav_list_0');
  let data = callbackData(lastEdit());
  assert.deepEqual(data.slice(0, 8), nine.slice(1).reverse().map(id => `fav_open_${id}_0`));
  assert.deepEqual(data.slice(8), ['fav_list_1', 'back_to_categories']);
  assert.match(lastEdit().text, /\(9\)/);

  reset();
  await sendCallback('fav_list_1');
  data = callbackData(lastEdit());
  assert.deepEqual(data, [`fav_open_${nine[0]}_1`, 'fav_list_0', 'back_to_categories']);

  reset();
  await sendCallback(`fav_open_${nine[0]}_1`);
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText']);
  assert.match(lastEdit().text, /КБЖУ на порцию/);
  assert.deepEqual(callbackData(lastEdit()), [
    `confirm_dish_${nine[0]}`, `fl_eat_${nine[0]}`, `fav_rm_${nine[0]}`, 'fav_list_1'
  ]);

  reset();
  await sendCallback('fav_open_999999_0');
  assert.equal(toast().text, T.recipeNotFound);
  assert.ok(callbackData(lastEdit()).includes('back_to_categories'), 'falls back to the list');
  for (const id of nine) await setFavorite(TELEGRAM_ID, id, false);
});

test('diary «⭐ Из избранного»: empty → alert; recipe → portion → entry without slot', async () => {
  await sendCallback(`fl_fav_${TODAY}_0`);
  assert.deepEqual(methods(), ['answerCallbackQuery']);
  assert.equal(toast().text, texts.foodLog.favorites.empty);
  assert.equal(toast().show_alert, true);

  const [recipeId] = await recipeIds(1);
  await setFavorite(TELEGRAM_ID, recipeId, true);
  reset();
  await sendCallback(`fl_fav_${TODAY}_0`);
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText']);
  const pick = `fl_pick_${TODAY}_${recipeId}_0`;
  assert.deepEqual(callbackData(lastEdit()), [pick, `fl_day_${TODAY}`]);

  reset();
  await sendCallback(pick);
  const add = `fl_add_${TODAY}_${recipeId}_0_2`;
  assert.ok(callbackData(lastEdit()).includes(add));

  reset();
  await sendCallback(add);
  assert.equal(toast().text, texts.foodLog.added);
  assert.deepEqual(await logRows(), [{ recipe_id: recipeId, portion: 1, slot: null, date: TODAY }]);
});
