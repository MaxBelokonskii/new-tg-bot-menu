const { dbRun, withTransaction } = require('../../database/db');
const { getOrCreateUser } = require('../weekly-planner/logic');
const { readProfileRow, isFilled } = require('./logic');
const { calculateAutoTargets, splitCaloriesBySlots } = require('../../utils/calculations');

// [RU] Редактируемые вручную нормы: колонка в user_preferences и допустимый
// диапазон ввода. Ккал — дневная цель, БЖУ — граммы в день.
// [EN] Manually editable targets: user_preferences column and accepted
// input range. Calories are per day, macros are grams per day.
const TARGET_FIELDS = Object.freeze({
  calories: Object.freeze({ column: 'target_calories', min: 800, max: 6000 }),
  protein: Object.freeze({ column: 'target_protein', min: 0, max: 600 }),
  fat: Object.freeze({ column: 'target_fat', min: 0, max: 600 }),
  carbs: Object.freeze({ column: 'target_carbs', min: 0, max: 600 })
});

/**
 * Parses user input for a target field. Accepts "1800", "95.5", "95,5";
 * the value is rounded to an integer.
 *
 * @param {keyof typeof TARGET_FIELDS} field
 * @param {string|undefined} text
 * @returns {number|null} integer within the field range, or null if invalid
 */
function parseTargetValue(field, text) {
  const spec = TARGET_FIELDS[field];
  if (!spec || typeof text !== 'string') return null;
  const normalized = text.replace(',', '.').trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Math.round(Number(normalized));
  return value >= spec.min && value <= spec.max ? value : null;
}

/**
 * Picks the daily targets from a profile row.
 * @param {object} row - user_preferences row (getUserProfile shape)
 * @returns {{calories: number, protein: number, fat: number, carbs: number, manual: boolean}}
 */
function pickTargets(row) {
  return {
    calories: row.target_calories,
    protein: row.target_protein,
    fat: row.target_fat,
    carbs: row.target_carbs,
    manual: Boolean(row.targets_manual)
  };
}

/**
 * Stores a manually entered target and marks targets as manual. A new
 * calorie target also re-splits the per-slot calorie budgets (25/30/25/10/10)
 * used by the weekly generator.
 *
 * @param {number} telegramId
 * @param {keyof typeof TARGET_FIELDS} field
 * @param {number} value - already validated by parseTargetValue
 * @returns {Promise<{calories: number, protein: number, fat: number, carbs: number, manual: boolean}>}
 * @throws {Error} on unknown field or missing profile row
 */
async function updateTarget(telegramId, field, value) {
  const spec = TARGET_FIELDS[field];
  if (!spec) throw new Error(`Unknown target field: ${field}`);
  const userId = await getOrCreateUser(telegramId);
  return withTransaction(async () => {
    let result;
    if (field === 'calories') {
      const slots = splitCaloriesBySlots(value);
      result = await dbRun(
        `UPDATE user_preferences SET
           target_calories = ?, target_breakfast = ?, target_main1 = ?,
           target_main2 = ?, target_salad = ?, target_dessert = ?,
           targets_manual = 1
         WHERE user_id = ?`,
        [value, slots.breakfast, slots.main1, slots.main2, slots.salad, slots.dessert, userId]
      );
    } else {
      // column берётся из замороженного словаря TARGET_FIELDS, не из ввода
      result = await dbRun(
        `UPDATE user_preferences SET ${spec.column} = ?, targets_manual = 1 WHERE user_id = ?`,
        [value, userId]
      );
    }
    if (result.changes === 0) throw new Error(`No profile for telegram user ${telegramId}`);
    return pickTargets(await readProfileRow(userId));
  });
}

/**
 * Recomputes calories, per-slot split and macros from the survey answers
 * and resets the manual flag.
 *
 * @param {number} telegramId
 * @returns {Promise<{calories: number, protein: number, fat: number, carbs: number, manual: boolean}|null>}
 *   null if the profile is not filled
 */
async function recalcTargetsFromProfile(telegramId) {
  const userId = await getOrCreateUser(telegramId);
  return withTransaction(async () => {
    const row = await readProfileRow(userId);
    if (!row || !isFilled(row)) return null;
    const { target, slots, macros } = calculateAutoTargets(row);
    await dbRun(
      `UPDATE user_preferences SET
         target_calories = ?, target_breakfast = ?, target_main1 = ?,
         target_main2 = ?, target_salad = ?, target_dessert = ?,
         target_protein = ?, target_fat = ?, target_carbs = ?,
         targets_manual = 0
       WHERE user_id = ?`,
      [
        target, slots.breakfast, slots.main1, slots.main2, slots.salad, slots.dessert,
        macros.protein, macros.fat, macros.carbs, userId
      ]
    );
    return { calories: target, ...macros, manual: false };
  });
}

module.exports = {
  TARGET_FIELDS,
  parseTargetValue,
  pickTargets,
  updateTarget,
  recalcTargetsFromProfile
};
