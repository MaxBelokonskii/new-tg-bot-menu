const { seedDb } = require('../helpers/memory-db');
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { dbGet, dbRun } = require('../../src/database/db');
const { getOrCreateUser } = require('../../src/features/weekly-planner/logic');
const {
  getUserProfile,
  hasManualTargets,
  saveUserProfile
} = require('../../src/features/profile/logic');
const {
  parseTargetValue,
  updateTarget,
  recalcTargetsFromProfile
} = require('../../src/features/profile/targets');
const { calculateAutoTargets } = require('../../src/utils/calculations');

const SURVEY = {
  weight: 80, height: 180, age: 30, sex: 'male', activity_level: 'moderate', goal: 'maintain'
};
const AUTO = calculateAutoTargets(SURVEY);

const prefs = async (telegramId) => dbGet(
  'SELECT * FROM user_preferences WHERE user_id = ?',
  [await getOrCreateUser(telegramId)]
);

before(seedDb);

test('parseTargetValue validates numbers and per-field ranges', () => {
  assert.equal(parseTargetValue('calories', '1800'), 1800);
  assert.equal(parseTargetValue('calories', ' 1800,4 '), 1800);
  assert.equal(parseTargetValue('protein', '95.5'), 96);
  assert.equal(parseTargetValue('fat', '0'), 0);
  for (const [field, text] of [
    ['calories', '799'], ['calories', '6001'], ['calories', 'abc'], ['calories', '-100'],
    ['protein', '601'], ['carbs', '12abc'], ['fat', ''], ['fat', undefined], ['unknown', '10']
  ]) {
    assert.equal(parseTargetValue(field, text), null, `${field}=${text}`);
  }
});

test('saveUserProfile stores auto macros and resets the manual flag', async () => {
  const result = await saveUserProfile(3001, SURVEY);
  assert.deepEqual(result.macros, AUTO.macros);
  assert.equal(result.manual, false);
  const row = await prefs(3001);
  assert.equal(row.target_calories, AUTO.target);
  assert.equal(row.target_protein, AUTO.macros.protein);
  assert.equal(row.target_fat, AUTO.macros.fat);
  assert.equal(row.target_carbs, AUTO.macros.carbs);
  assert.equal(row.targets_manual, 0);
  assert.equal(await hasManualTargets(3001), false);
});

test('updateTarget: calories re-split slots, macros set the manual flag', async () => {
  await saveUserProfile(3002, SURVEY);
  const afterKcal = await updateTarget(3002, 'calories', 2000);
  assert.equal(afterKcal.calories, 2000);
  assert.equal(afterKcal.manual, true);
  let row = await prefs(3002);
  assert.deepEqual(
    [row.target_breakfast, row.target_main1, row.target_main2, row.target_salad, row.target_dessert],
    [500, 600, 500, 200, 200]
  );
  assert.equal(row.target_protein, AUTO.macros.protein, 'macros untouched by kcal edit');

  const afterProtein = await updateTarget(3002, 'protein', 150);
  assert.equal(afterProtein.protein, 150);
  row = await prefs(3002);
  assert.equal(row.target_protein, 150);
  assert.equal(row.target_calories, 2000);
  assert.equal(row.targets_manual, 1);
  assert.equal(await hasManualTargets(3002), true);
});

test('updateTarget rejects unknown fields and missing profiles', async () => {
  await assert.rejects(updateTarget(3002, 'sugar', 10));
  await assert.rejects(updateTarget(3999, 'fat', 10));
});

test('saveUserProfile with keepManualTargets keeps manual targets, updates body data', async () => {
  await saveUserProfile(3003, SURVEY);
  await updateTarget(3003, 'calories', 2200);
  await updateTarget(3003, 'fat', 90);

  const result = await saveUserProfile(3003, { ...SURVEY, weight: 75 }, { keepManualTargets: true });
  assert.equal(result.target, 2200);
  assert.equal(result.macros.fat, 90);
  assert.equal(result.manual, true);
  const row = await prefs(3003);
  assert.equal(row.weight, 75);
  assert.equal(row.target_calories, 2200);
  assert.equal(row.target_main1, 660);
  assert.equal(row.target_fat, 90);
  assert.equal(row.target_protein, AUTO.macros.protein);
  assert.equal(row.targets_manual, 1);
});

test('saveUserProfile without keepManualTargets overwrites manual targets', async () => {
  await saveUserProfile(3004, SURVEY);
  await updateTarget(3004, 'carbs', 50);
  await saveUserProfile(3004, SURVEY);
  const row = await prefs(3004);
  assert.equal(row.target_carbs, AUTO.macros.carbs);
  assert.equal(row.target_calories, AUTO.target);
  assert.equal(row.targets_manual, 0);
});

test('recalcTargetsFromProfile restores auto targets and clears the flag', async () => {
  await saveUserProfile(3005, SURVEY);
  await updateTarget(3005, 'calories', 1500);
  await updateTarget(3005, 'protein', 200);
  const targets = await recalcTargetsFromProfile(3005);
  assert.deepEqual(targets, { calories: AUTO.target, ...AUTO.macros, manual: false });
  const row = await prefs(3005);
  assert.equal(row.target_calories, AUTO.target);
  assert.equal(row.target_breakfast, AUTO.slots.breakfast);
  assert.equal(row.target_protein, AUTO.macros.protein);
  assert.equal(row.targets_manual, 0);

  assert.equal(await recalcTargetsFromProfile(3998), null, 'no profile → null');
});

test('getUserProfile backfills macros for profiles saved before Stage 3.3', async () => {
  await saveUserProfile(3006, SURVEY);
  const userId = await getOrCreateUser(3006);
  await dbRun(
    `UPDATE user_preferences SET target_protein = NULL, target_fat = NULL,
       target_carbs = NULL, target_calories = 2000 WHERE user_id = ?`,
    [userId]
  );
  const profile = await getUserProfile(3006);
  assert.equal(profile.target_protein, 112);
  assert.equal(profile.target_fat, 67);
  const row = await prefs(3006);
  assert.equal(row.target_protein, 112, 'backfill is persisted');
  assert.equal(row.target_carbs, profile.target_carbs);
});
