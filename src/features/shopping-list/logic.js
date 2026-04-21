const { db } = require('../../database/db');
const logger = require('../../utils/logger');
const { getCurrentWeekBounds } = require('../../utils/date-helpers');

/**
 * Получает агрегированный список ингредиентов из плана пользователя на текущую
 * неделю (Пн..Вс, включая сегодня).
 * @param {number} telegramId
 * @returns {Promise<Array>}
 */
async function getIngredientsFromPlan(telegramId) {
  const { start, endExclusive } = getCurrentWeekBounds();
  return new Promise((resolve, reject) => {
    const query = `
      SELECT i.id, i.name, i.type, SUM(ri.amount) as total_amount, ri.unit
      FROM users u
      JOIN daily_menu dm ON u.id = dm.user_id
      JOIN daily_menu_items dmi ON dm.id = dmi.daily_menu_id
      JOIN recipe_ingredients ri ON dmi.recipe_id = ri.recipe_id
      JOIN ingredients i ON ri.ingredient_id = i.id
      WHERE u.telegram_id = ?
        AND dm.date >= ?
        AND dm.date < ?
      GROUP BY i.id, ri.unit
    `;

    db.all(query, [telegramId, start, endExclusive], (err, rows) => {
      if (err) {
        logger.error('Error fetching ingredients from plan:', err);
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

/**
 * Сохраняет сформированный список покупок в БД
 * @param {number} telegramId
 * @param {Array} ingredients
 * @returns {Promise<number>} Shopping list ID
 */
async function saveShoppingList(telegramId, ingredients) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');

      const getUserQuery = 'SELECT id FROM users WHERE telegram_id = ?';
      db.get(getUserQuery, [telegramId], (err, user) => {
        if (err || !user) {
          db.run('ROLLBACK');
          return reject(err || new Error('User not found'));
        }

        const insertListQuery = `
          INSERT INTO shopping_lists (user_id, period_start, period_end)
          VALUES (?, DATE('now'), DATE('now', '+7 days'))
        `;

        db.run(insertListQuery, [user.id], function(err) {
          if (err) {
            db.run('ROLLBACK');
            return reject(err);
          }

          const listId = this.lastID;
          const insertItemsQuery = `
            INSERT INTO shopping_list_items (shopping_list_id, ingredient_id, total_amount, unit)
            VALUES (?, ?, ?, ?)
          `;

          const stmt = db.prepare(insertItemsQuery);
          ingredients.forEach(item => {
            stmt.run(listId, item.id, item.total_amount, item.unit);
          });

          stmt.finalize((err) => {
            if (err) {
              db.run('ROLLBACK');
              return reject(err);
            }
            db.run('COMMIT', (err) => {
              if (err) reject(err);
              else resolve(listId);
            });
          });
        });
      });
    });
  });
}

/**
 * Получает последний список покупок пользователя
 * @param {number} telegramId
 * @returns {Promise<Array>}
 */
async function getLastShoppingList(telegramId) {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT i.name, i.type, sli.total_amount, sli.unit
      FROM users u
      JOIN shopping_lists sl ON u.id = sl.user_id
      JOIN shopping_list_items sli ON sl.id = sli.shopping_list_id
      JOIN ingredients i ON sli.ingredient_id = i.id
      WHERE u.telegram_id = ? AND sl.id = (
        SELECT MAX(id) FROM shopping_lists WHERE user_id = u.id
      )
    `;

    db.all(query, [telegramId], (err, rows) => {
      if (err) {
        logger.error('Error fetching last shopping list:', err);
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

/**
 * Очищает все списки покупок пользователя
 * @param {number} telegramId
 */
async function clearShoppingLists(telegramId) {
    return new Promise((resolve, reject) => {
        const query = `
            DELETE FROM shopping_lists 
            WHERE user_id = (SELECT id FROM users WHERE telegram_id = ?)
        `;
        db.run(query, [telegramId], function(err) {
            if (err) {
                logger.error('Error clearing shopping lists:', err);
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

module.exports = {
  getIngredientsFromPlan,
  saveShoppingList,
  getLastShoppingList,
  clearShoppingLists
};
