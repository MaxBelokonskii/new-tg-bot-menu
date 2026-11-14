const { dbGet, dbRun, withTransaction } = require('../../database/db');
const { getOrCreateUser } = require('../weekly-planner/logic');
const {
  calculateTargetCalories,
  calculateMacroTargets,
  calculateAutoTargets,
  splitCaloriesBySlots
} = require('../../utils/calculations');

const PROFILE_COLUMNS = ['weight', 'height', 'age', 'sex', 'activity_level', 'goal'];
const MACRO_COLUMNS = ['target_protein', 'target_fat', 'target_carbs'];

const PROFILE_SELECT =
  `SELECT weight, height, age, sex, activity_level, goal,
          target_calories, target_breakfast, target_main1,
          target_main2, target_salad, target_dessert,
          target_protein, target_fat, target_carbs, targets_manual
   FROM user_preferences WHERE user_id = ?`;

/**
 * True when every survey field of the row is populated.
 * @param {object} row
 * @returns {boolean}
 */
const isFilled = (row) => PROFILE_COLUMNS.every(col => row[col] !== null && row[col] !== undefined);
const hasMissingMacros = (row) => MACRO_COLUMNS.some(col => row[col] === null || row[col] === undefined);

/**
 * Reads the raw user_preferences row for an internal user id.
 * @param {number} userId
 * @returns {Promise<object|undefined>}
 */
function readProfileRow(userId) {
  return dbGet(PROFILE_SELECT, [userId]);
}

/**
 * Fills macro targets that are still NULL (profiles saved before macros
 * existed) from the stored calorie target. Existing values are kept.
 *
 * @param {number} userId
 * @param {object} row - filled profile row
 * @returns {Promise<{protein: number, fat: number, carbs: number}>}
 */
async function backfillMacros(userId, row) {
  const targetCalories = row.target_calories || calculateTargetCalories(row).target;
  const auto = calculateMacroTargets({ weight: row.weight, goal: row.goal, targetCalories });
  await dbRun(
    `UPDATE user_preferences SET
       target_protein = COALESCE(target_protein, ?),
       target_fat = COALESCE(target_fat, ?),
       target_carbs = COALESCE(target_carbs, ?)
     WHERE user_id = ?`,
    [auto.protein, auto.fat, auto.carbs, userId]
  );
  return {
    protein: row.target_protein ?? auto.protein,
    fat: row.target_fat ?? auto.fat,
    carbs: row.target_carbs ?? auto.carbs
  };
}

/**
 * Returns the user's profile row or null if profile has not been filled.
 * "Filled" means all basic survey fields are populated. Macro targets
 * missing from older profiles are backfilled on read.
 *
 * @param {number} telegramId
 * @returns {Promise<object|null>}
 */
async function getUserProfile(telegramId) {
  const userId = await getOrCreateUser(telegramId);
  const row = await readProfileRow(userId);
  if (!row || !isFilled(row)) return null;
  // [RU] Профили, заполненные до появления БЖУ, получают авто-нормы при
  // первом чтении — экран норм и сводка не показывают «пустые» значения.
  // [EN] Profiles saved before macros existed get auto macros on first read,
  // so the norms screen and summary never show blanks.
  if (hasMissingMacros(row)) {
    const macros = await backfillMacros(userId, row);
    Object.assign(row, {
      target_protein: macros.protein,
      target_fat: macros.fat,
      target_carbs: macros.carbs
    });
  }
  // [RU] BMR/TDEE не храним в БД — это производные числа, дешевле пересчитать,
  // чем держать в схеме рассинхронизированную копию. Добавляем их прямо в
  // объект профиля, чтобы UI показывал полную раскладку.
  // [EN] BMR/TDEE aren't stored — they're derived numbers, cheaper to
  // recompute than to keep a drifting copy. Attach them so UI can render
  // the full breakdown.
  const { bmr, tdee } = calculateTargetCalories(row);
  return { ...row, bmr, tdee };
}

/**
 * True if the user has manually edited targets (targets_manual = 1).
 * @param {number} telegramId
 * @returns {Promise<boolean>}
 */
async function hasManualTargets(telegramId) {
  const userId = await getOrCreateUser(telegramId);
  const row = await dbGet('SELECT targets_manual FROM user_preferences WHERE user_id = ?', [userId]);
  return Boolean(row && row.targets_manual);
}

/**
 * Picks targets to store on survey save: auto-calculated ones, or the
 * user's kept manual calories/macros (slot split follows the kept calories).
 *
 * @param {number} userId
 * @param {object} data - survey answers
 * @param {boolean} keepManualTargets
 * @returns {Promise<{target: number, slots: object, macros: object, manual: boolean}>}
 */
async function resolveTargets(userId, data, keepManualTargets) {
  const auto = calculateAutoTargets(data);
  const kept = keepManualTargets ? await readProfileRow(userId) : null;
  if (!kept || !kept.target_calories) {
    return { target: auto.target, slots: auto.slots, macros: auto.macros, manual: false };
  }
  const fallback = calculateMacroTargets({
    weight: data.weight, goal: data.goal, targetCalories: kept.target_calories
  });
  return {
    target: kept.target_calories,
    slots: splitCaloriesBySlots(kept.target_calories),
    macros: {
      protein: kept.target_protein ?? fallback.protein,
      fat: kept.target_fat ?? fallback.fat,
      carbs: kept.target_carbs ?? fallback.carbs
    },
    manual: Boolean(kept.targets_manual)
  };
}

/**
 * UPSERTs the profile survey answers and the daily / per-slot calorie and
 * macro targets. By default the targets are auto-calculated (Mifflin-St Jeor
 * → goal → 25/30/25/10/10 split + macros) and the manual flag is reset;
 * with `keepManualTargets` the stored manual calories/macros are preserved.
 * Returns the derived numbers so the caller can render them without
 * re-reading the DB.
 *
 * @param {number} telegramId
 * @param {{weight: number, height: number, age: number, sex: string,
 *          activity_level: string, goal: string}} data
 * @param {{keepManualTargets?: boolean}} [options]
 * @returns {Promise<{bmr: number, tdee: number, target: number,
 *                    slots: {breakfast: number, main1: number, main2: number,
 *                            salad: number, dessert: number},
 *                    macros: {protein: number, fat: number, carbs: number},
 *                    manual: boolean}>}
 */
async function saveUserProfile(telegramId, data, { keepManualTargets = false } = {}) {
  const userId = await getOrCreateUser(telegramId);
  const { bmr, tdee } = calculateTargetCalories(data);
  return withTransaction(async () => {
    const { target, slots, macros, manual } = await resolveTargets(userId, data, keepManualTargets);
    await dbRun(
      `INSERT INTO user_preferences
         (user_id, weight, height, age, sex, activity_level, goal,
          target_calories, target_breakfast, target_main1, target_main2,
          target_salad, target_dessert, target_protein, target_fat,
          target_carbs, targets_manual)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         weight = excluded.weight,
         height = excluded.height,
         age = excluded.age,
         sex = excluded.sex,
         activity_level = excluded.activity_level,
         goal = excluded.goal,
         target_calories = excluded.target_calories,
         target_breakfast = excluded.target_breakfast,
         target_main1 = excluded.target_main1,
         target_main2 = excluded.target_main2,
         target_salad = excluded.target_salad,
         target_dessert = excluded.target_dessert,
         target_protein = excluded.target_protein,
         target_fat = excluded.target_fat,
         target_carbs = excluded.target_carbs,
         targets_manual = excluded.targets_manual`,
      [
        userId, data.weight, data.height, data.age, data.sex,
        data.activity_level, data.goal, target,
        slots.breakfast, slots.main1, slots.main2, slots.salad, slots.dessert,
        macros.protein, macros.fat, macros.carbs, manual ? 1 : 0
      ]
    );
    return { bmr, tdee, target, slots, macros, manual };
  });
}

module.exports = {
  getUserProfile,
  hasManualTargets,
  saveUserProfile,
  readProfileRow,
  isFilled
};
