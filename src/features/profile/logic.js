const { db } = require('../../database/db');
const { getOrCreateUser } = require('../weekly-planner/logic');
const {
  calculateTargetCalories,
  splitCaloriesBySlots
} = require('../../utils/calculations');

const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
});
const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) {
    if (err) reject(err);
    else resolve(this);
  });
});

const PROFILE_COLUMNS = ['weight', 'height', 'age', 'sex', 'activity_level', 'goal'];

/**
 * Returns the user's profile row or null if profile has not been filled.
 * "Filled" means all basic survey fields are populated.
 *
 * @param {number} telegramId
 * @returns {Promise<object|null>}
 */
async function getUserProfile(telegramId) {
  const userId = await getOrCreateUser(telegramId);
  const row = await dbGet(
    `SELECT weight, height, age, sex, activity_level, goal,
            target_calories, target_breakfast, target_main1,
            target_main2, target_salad, target_dessert
     FROM user_preferences WHERE user_id = ?`,
    [userId]
  );
  if (!row) return null;
  const filled = PROFILE_COLUMNS.every(col => row[col] !== null && row[col] !== undefined);
  if (!filled) return null;
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
 * UPSERTs the profile survey answers and the auto-calculated daily /
 * per-slot calorie targets (Mifflin-St Jeor BMR → TDEE → goal adjustment,
 * then 25/30/25/10/10 split). Returns the derived numbers so the caller
 * can render them without re-reading the DB.
 *
 * @param {number} telegramId
 * @param {{weight: number, height: number, age: number, sex: string,
 *          activity_level: string, goal: string}} data
 * @returns {Promise<{bmr: number, tdee: number, target: number,
 *                    slots: {breakfast: number, main1: number, main2: number,
 *                            salad: number, dessert: number}}>}
 */
async function saveUserProfile(telegramId, data) {
  const userId = await getOrCreateUser(telegramId);
  const calories = calculateTargetCalories(data);
  const slots = splitCaloriesBySlots(calories.target);
  await dbRun(
    `INSERT INTO user_preferences
       (user_id, weight, height, age, sex, activity_level, goal,
        target_calories, target_breakfast, target_main1, target_main2,
        target_salad, target_dessert)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
       target_dessert = excluded.target_dessert`,
    [
      userId, data.weight, data.height, data.age, data.sex,
      data.activity_level, data.goal, calories.target,
      slots.breakfast, slots.main1, slots.main2, slots.salad, slots.dessert
    ]
  );
  return { ...calories, slots };
}

module.exports = {
  getUserProfile,
  saveUserProfile
};
