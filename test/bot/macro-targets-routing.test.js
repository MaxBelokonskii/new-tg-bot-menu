const { seedDb } = require('../helpers/memory-db');
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const texts = require('../../src/bot/texts');
const { dbGet } = require('../../src/database/db');
const { getOrCreateUser } = require('../../src/features/weekly-planner/logic');
const { saveUserProfile } = require('../../src/features/profile/logic');
const { calculateAutoTargets } = require('../../src/utils/calculations');
const { createFakeBot } = require('../helpers/fake-bot');

const TELEGRAM_ID = 6001;
const SURVEY = {
  weight: 80, height: 180, age: 30, sex: 'male', activity_level: 'moderate', goal: 'maintain'
};
const AUTO = calculateAutoTargets(SURVEY);
const T = texts.macroTargets;

const { calls, sendText, sendCallback, methods, reset } = createFakeBot(TELEGRAM_ID);

const prefs = async () => dbGet(
  'SELECT * FROM user_preferences WHERE user_id = ?',
  [await getOrCreateUser(TELEGRAM_ID)]
);
const callbackData = (payload) => (payload.reply_markup?.inline_keyboard || [])
  .flat().map(b => b.callback_data);
const sentTexts = () => calls.map(c => c.payload.text);

before(seedDb);
beforeEach(reset);

test('settings without a profile has no norms button', async () => {
  await sendText(texts.mainMenu.buttons.settings);
  assert.deepEqual(methods(), ['sendMessage']);
  assert.ok(!callbackData(calls[0].payload).includes('macro_targets'));
});

test('settings with a profile shows macros and opens the norms screen', async () => {
  await saveUserProfile(TELEGRAM_ID, SURVEY);
  await sendText(texts.mainMenu.buttons.settings);
  assert.ok(callbackData(calls[0].payload).includes('macro_targets'));
  assert.match(calls[0].payload.text, new RegExp(`${texts.profile.calories.macros.protein}: ${AUTO.macros.protein}`));

  reset();
  await sendCallback('macro_targets');
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText']);
  assert.ok(calls[1].payload.text.startsWith(T.title));
  assert.ok(calls[1].payload.text.includes(T.autoMark));
  assert.deepEqual(callbackData(calls[1].payload), [
    'macro_edit_calories', 'macro_edit_protein', 'macro_edit_fat', 'macro_edit_carbs',
    'macro_recalc', 'macro_back'
  ]);
});

test('edit kcal end-to-end: prompt → invalid → valid saves, re-splits and marks manual', async () => {
  await sendCallback('macro_edit_calories');
  assert.deepEqual(methods(), ['answerCallbackQuery', 'sendMessage']);
  assert.equal(calls[1].payload.text, T.ask.calories);

  reset();
  await sendText('много');
  assert.deepEqual(sentTexts(), [T.invalid.calories]);
  reset();
  await sendText('100');
  assert.deepEqual(sentTexts(), [T.invalid.calories]);

  reset();
  await sendText('2400');
  assert.deepEqual(methods(), ['sendMessage', 'sendMessage']);
  assert.ok(calls[0].payload.text.startsWith(T.saved));
  assert.ok(calls[1].payload.text.includes(T.manualMark));
  const row = await prefs();
  assert.equal(row.target_calories, 2400);
  assert.equal(row.target_main1, 720);
  assert.equal(row.targets_manual, 1);

  // сцена закрыта: следующий текст уходит в обычные хэндлеры
  reset();
  await sendText('2500');
  assert.equal((await prefs()).target_calories, 2400);
});

test('edit macro warns on kcal mismatch; another edit button switches the field', async () => {
  await sendCallback('macro_edit_fat');
  reset();
  await sendCallback('macro_edit_protein');
  assert.deepEqual(methods(), ['answerCallbackQuery', 'sendMessage']);
  assert.equal(calls[1].payload.text, T.ask.protein);

  reset();
  await sendText('700');
  assert.deepEqual(sentTexts(), [T.invalid.macro]);
  reset();
  await sendText('400');
  assert.ok(calls[0].payload.text.includes('⚠️'), 'mismatch warning shown');
  const row = await prefs();
  assert.equal(row.target_protein, 400);
  assert.equal(row.target_fat, AUTO.macros.fat);
});

test('/cancel leaves the edit scene without saving', async () => {
  await sendCallback('macro_edit_carbs');
  reset();
  await sendText('/cancel');
  assert.deepEqual(sentTexts(), [T.canceled]);
  reset();
  await sendText('10');
  assert.notEqual((await prefs()).target_carbs, 10);
});

test('survey with manual targets asks to overwrite: "no" keeps them, "yes" recalculates', async () => {
  const walkSurvey = async (weight) => {
    await sendCallback('profile_start');
    for (const answer of [String(weight), '180', '30']) await sendText(answer);
    for (const data of ['profile_sex_male', 'profile_act_moderate', 'profile_goal_maintain']) {
      await sendCallback(data);
    }
  };

  reset();
  await walkSurvey(75);
  assert.equal(calls.at(-1).payload.text, texts.profile.askOverwriteManual);
  assert.deepEqual(callbackData(calls.at(-1).payload), ['profile_overwrite_yes', 'profile_overwrite_no']);
  reset();
  await sendCallback('profile_overwrite_no');
  assert.ok(sentTexts().includes(texts.profile.saved));
  let row = await prefs();
  assert.equal(row.weight, 75);
  assert.equal(row.target_calories, 2400);
  assert.equal(row.target_protein, 400);
  assert.equal(row.targets_manual, 1);

  reset();
  await walkSurvey(80);
  reset();
  await sendCallback('profile_overwrite_yes');
  row = await prefs();
  assert.equal(row.target_calories, AUTO.target);
  assert.equal(row.target_protein, AUTO.macros.protein);
  assert.equal(row.targets_manual, 0);
});

test('recalc restores auto targets, back returns to the profile menu', async () => {
  await sendCallback('macro_edit_calories');
  await sendText('1500');
  assert.equal((await prefs()).targets_manual, 1);

  reset();
  await sendCallback('macro_recalc');
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText']);
  assert.equal(calls[0].payload.text, T.recalculated);
  assert.ok(calls[1].payload.text.includes(T.autoMark));
  const row = await prefs();
  assert.equal(row.target_calories, AUTO.target);
  assert.equal(row.targets_manual, 0);

  reset();
  await sendCallback('macro_back');
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText']);
  assert.ok(calls[1].payload.text.startsWith(texts.profile.menuTitle));
});
