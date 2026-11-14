const { seedDb } = require('../helpers/memory-db');
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const texts = require('../../src/bot/texts');
const { dbGet } = require('../../src/database/db');
const { getOrCreateUser } = require('../../src/features/weekly-planner/logic');
const { saveUserProfile } = require('../../src/features/profile/logic');
const { listPrefs } = require('../../src/features/ingredient-prefs/logic');
const { isEscapeUpdate } = require('../../src/bot/scene-escape');
const { createFakeBot } = require('../helpers/fake-bot');

const TELEGRAM_ID = 9101;
const MENU = texts.mainMenu.buttons;
const { calls, sendText, sendCallback, methods, reset } = createFakeBot(TELEGRAM_ID);
const sentTexts = () => calls.filter(c => c.method === 'sendMessage').map(c => c.payload.text);
const prefsRow = async () => dbGet(
  'SELECT * FROM user_preferences WHERE user_id = ?',
  [await getOrCreateUser(TELEGRAM_ID)]
);

before(seedDb);
beforeEach(reset);

test('isEscapeUpdate: main-menu text, commands and foreign callbacks escape', () => {
  const text = (t) => ({ message: { text: t } });
  const cb = (data) => ({ callbackQuery: { data } });
  assert.equal(isEscapeUpdate(text(MENU.weeklyPlan)), true);
  assert.equal(isEscapeUpdate(text('/start')), true);
  assert.equal(isEscapeUpdate(text('72.5')), false);
  assert.equal(isEscapeUpdate({ message: { sticker: {} } }), false);
  assert.equal(isEscapeUpdate(cb('view_weekly_plan')), true);
  assert.equal(isEscapeUpdate(cb('macro_edit_fat'), { ownCallback: /^macro_edit_/ }), false);
  assert.equal(isEscapeUpdate(cb('macro_back'), { ownCallback: /^macro_edit_/ }), true);
});

test('survey: a main-menu button leaves the scene and opens that screen', async () => {
  await sendCallback('profile_start');
  assert.equal(sentTexts()[0], texts.profile.askWeight);

  reset();
  await sendText(MENU.weeklyPlan);
  assert.deepEqual(sentTexts(), [texts.weeklyPlan.title]);

  // сцена закрыта — число больше не ответ на анкету
  reset();
  await sendText('75');
  assert.ok(!sentTexts().includes(texts.profile.askHeight));
});

test('survey: own buttons stay in the flow; a foreign button and /start leave it', async () => {
  await sendCallback('profile_start');
  for (const answer of ['80', '180', '30']) await sendText(answer);
  reset();
  await sendCallback('profile_sex_male');
  assert.equal(sentTexts()[0], texts.profile.askActivity, 'own button is handled by the survey');

  reset();
  await sendCallback('wp_menu');
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText']);
  assert.equal(calls[1].payload.text, texts.weeklyPlan.title);

  await sendCallback('profile_start');
  reset();
  await sendText('/start');
  assert.equal(sentTexts()[0], texts.welcome);
});

test('norm edit: edit buttons switch the field, other buttons and menu leave', async () => {
  await saveUserProfile(TELEGRAM_ID, {
    weight: 80, height: 180, age: 30, sex: 'male', activity_level: 'moderate', goal: 'maintain'
  });
  const before = (await prefsRow()).target_calories;

  await sendCallback('macro_edit_calories');
  reset();
  await sendCallback('macro_edit_fat');
  assert.equal(sentTexts()[0], texts.macroTargets.ask.fat);

  reset();
  await sendCallback('macro_back');
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText']);
  assert.ok(calls[1].payload.text.startsWith(texts.profile.menuTitle));

  await sendCallback('macro_edit_calories');
  reset();
  await sendText(MENU.shoppingList);
  assert.ok(sentTexts().length > 0);
  assert.ok(!sentTexts().includes(texts.macroTargets.invalid.calories));
  reset();
  await sendText('2000');
  assert.equal((await prefsRow()).target_calories, before);
});

test('product prefs: a main-menu button leaves the add scene without saving', async () => {
  await sendCallback('prefs_add_excluded');
  reset();
  await sendText(MENU.suggestions);
  assert.deepEqual(sentTexts(), [texts.dishSelection.title]);
  reset();
  await sendText('грибы');
  assert.deepEqual(await listPrefs(TELEGRAM_ID, 'excluded'), []);

  await sendCallback('prefs_add_favorite');
  reset();
  await sendCallback('prefs_list_excluded');
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText']);
  assert.ok(calls[1].payload.text.startsWith(texts.ingredientPrefs.title.excluded));
});

test('reverse search: a main-menu button leaves the scene', async () => {
  await sendText(MENU.reverseSearch);
  assert.equal(sentTexts()[0], texts.reverseSearch.askInventory);
  reset();
  await sendText(MENU.foodLog);
  assert.ok(sentTexts()[0].startsWith(texts.foodLog.title.split(' — ')[0]));
  assert.ok(!sentTexts().includes(texts.reverseSearch.nothingMatched));

  reset();
  await sendText('огурец, помидор');
  assert.ok(!sentTexts().some(t => t.includes(texts.reverseSearch.resultsHeader)));
});
