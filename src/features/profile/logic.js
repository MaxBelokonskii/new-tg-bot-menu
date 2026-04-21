const { db } = require('../../database/db');
const { getOrCreateUser } = require('../weekly-planner/logic');

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
  return filled ? row : null;
}

/**
 * UPSERTs the profile survey answers. Per-slot target calories are left
 * untouched — they will be populated by Stage 2.4 (Mifflin-St Jeor calc).
 *
 * @param {number} telegramId
 * @param {{weight: number, height: number, age: number, sex: string,
 *          activity_level: string, goal: string}} data
 */
async function saveUserProfile(telegramId, data) {
  const userId = await getOrCreateUser(telegramId);
  await dbRun(
    `INSERT INTO user_preferences
       (user_id, weight, height, age, sex, activity_level, goal)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       weight = excluded.weight,
       height = excluded.height,
       age = excluded.age,
       sex = excluded.sex,
       activity_level = excluded.activity_level,
       goal = excluded.goal`,
    [userId, data.weight, data.height, data.age, data.sex, data.activity_level, data.goal]
  );
}

module.exports = {
  getUserProfile,
  saveUserProfile
};
