const { db } = require('../../database/db');
const logger = require('../../utils/logger');
const { getCurrentWeekBounds, formatLocalDate } = require('../../utils/date-helpers');

/**
 * Получает ID пользователя в БД по telegram_id, создавая его если нужно
 * @param {number} telegramId
 * @param {string} username
 * @returns {Promise<number>} User internal ID
 */
async function getOrCreateUser(telegramId, username) {
  return new Promise((resolve, reject) => {
    db.get('SELECT id FROM users WHERE telegram_id = ?', [telegramId], (err, row) => {
      if (err) return reject(err);
      if (row) return resolve(row.id);

      db.run('INSERT INTO users (telegram_id, username) VALUES (?, ?)', [telegramId, username], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  });
}

/**
 * Генерирует план на неделю
 * @param {number} userId
 * @param {string} startDate - ГГГГ-ММ-ДД
 */
async function generateWeeklyPlan(userId, startDate) {
  // Реализация будет позже
  return true;
}

/**
 * Сохраняет выбранное блюдо для пользователя
 * @param {number} telegramId
 * @param {number} recipeId
 */
async function saveSelectedDish(telegramId, recipeId) {
  const userId = await getOrCreateUser(telegramId);
  // [RU] Локальная дата, а не UTC: иначе рядом с полуночью «сегодня» уезжает
  // в следующие сутки и не попадает в окно текущей недели из getWeeklyPlan.
  // [EN] Local date, not UTC: near midnight a UTC date can land in tomorrow
  // and slip out of the current-week window produced by getCurrentWeekBounds.
  const today = formatLocalDate(new Date());

  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // 1. Обеспечиваем наличие daily_menu на сегодня
      db.run(
        'INSERT OR IGNORE INTO daily_menu (user_id, date) VALUES (?, ?)',
        [userId, today],
        function(err) {
          if (err) return reject(err);

          // 2. Получаем ID daily_menu (используем get, так как INSERT OR IGNORE мог не создать запись)
          db.get(
            'SELECT id FROM daily_menu WHERE user_id = ? AND date = ?',
            [userId, today],
            (err, row) => {
              if (err) return reject(err);
              if (!row) return reject(new Error('Failed to create/find daily menu'));

              const dailyMenuId = row.id;

              // 3. Добавляем блюдо (slot пока будет просто автоинкрементом или фиксированным)
              db.get(
                'SELECT COUNT(*) as count FROM daily_menu_items WHERE daily_menu_id = ?',
                [dailyMenuId],
                (err, countRow) => {
                  if (err) return reject(err);
                  const slot = (countRow ? countRow.count : 0) + 1;

                  db.run(
                    'INSERT INTO daily_menu_items (daily_menu_id, recipe_id, slot) VALUES (?, ?, ?)',
                    [dailyMenuId, recipeId, slot],
                    (err) => {
                      if (err) reject(err);
                      else resolve(true);
                    }
                  );
                }
              );
            }
          );
        }
      );
    });
  });
}

/**
 * Returns the user's planned dishes for the current ISO week (Mon..Sun).
 * @param {number} telegramId
 * @returns {Promise<Array<{name: string, category: string, date: string}>>}
 */
async function getWeeklyPlan(telegramId) {
  const userId = await getOrCreateUser(telegramId);
  const { start, endExclusive } = getCurrentWeekBounds();

  return new Promise((resolve, reject) => {
    const query = `
      SELECT r.name, mc.name as category, dm.date
      FROM daily_menu_items dmi
      JOIN daily_menu dm ON dmi.daily_menu_id = dm.id
      JOIN recipes r ON dmi.recipe_id = r.id
      JOIN meal_categories mc ON r.category_id = mc.id
      WHERE dm.user_id = ?
        AND dm.date >= ?
        AND dm.date < ?
      ORDER BY dm.date ASC, dmi.slot ASC
    `;

    db.all(query, [userId, start, endExclusive], (err, rows) => {
      if (err) {
        logger.error('Error fetching weekly plan:', err);
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

/**
 * Очищает план на конкретный день
 * @param {number} telegramId
 * @param {string} date - ГГГГ-ММ-ДД
 */
async function clearDailyPlan(telegramId, date) {
  const userId = await getOrCreateUser(telegramId);

  return new Promise((resolve, reject) => {
    db.run(
      `DELETE FROM daily_menu_items 
       WHERE daily_menu_id IN (SELECT id FROM daily_menu WHERE user_id = ? AND date = ?)`,
      [userId, date],
      (err) => {
        if (err) return reject(err);
        resolve(true);
      }
    );
  });
}

module.exports = {
  getOrCreateUser,
  generateWeeklyPlan,
  saveSelectedDish,
  getWeeklyPlan,
  clearDailyPlan
};
