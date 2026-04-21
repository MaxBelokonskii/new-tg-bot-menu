const { db } = require('../../database/db');
const logger = require('../../utils/logger');

/**
 * Aggregates ingredients from the user's daily_menu within the given period.
 * @param {number} telegramId
 * @param {{ start: string, endExclusive: string }} bounds — half-open YYYY-MM-DD range
 * @returns {Promise<Array>}
 */
async function getIngredientsFromPlan(telegramId, bounds) {
  const { start, endExclusive } = bounds;
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
 * Persists the aggregated shopping list for the given period.
 * @param {number} telegramId
 * @param {Array} ingredients
 * @param {{ start: string, endExclusive: string }} bounds — period_start/period_end
 * @returns {Promise<number>} Shopping list ID
 */
async function saveShoppingList(telegramId, ingredients, bounds) {
  const { start, endExclusive } = bounds;
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
          VALUES (?, ?, ?)
        `;

        db.run(insertListQuery, [user.id, start, endExclusive], function(err) {
          if (err) {
            db.run('ROLLBACK');
            return reject(err);
          }

          const listId = this.lastID;
          const insertItemsQuery = `
            INSERT INTO shopping_list_items (shopping_list_id, ingredient_id, total_amount, unit)
            VALUES (?, ?, ?, ?)
          `;

          // [RU] Один и тот же ингредиент может встретиться с разными единицами
          // (например, «лук» как `300 г` в одном рецепте и `2 шт` в другом).
          // PK таблицы — (shopping_list_id, ingredient_id), поэтому две строки
          // на один ингредиент нарушают UNIQUE. Склеиваем единицы в одну строку,
          // суммарно amount берём у первой — в UI отображается целиком через unit.
          // [EN] Same ingredient may arrive with multiple units. PK is
          // (shopping_list_id, ingredient_id), so two rows for one ingredient
          // would violate UNIQUE. Merge units into a single display string;
          // first amount is kept as-is since unit already carries the total.
          const merged = new Map();
          for (const item of ingredients) {
            const existing = merged.get(item.id);
            const part = `${item.total_amount} ${item.unit}`;
            if (existing) {
              existing.parts.push(part);
            } else {
              merged.set(item.id, {
                id: item.id,
                total_amount: item.total_amount,
                unit: item.unit,
                parts: [part]
              });
            }
          }

          const stmt = db.prepare(insertItemsQuery);
          let stmtError = null;
          for (const item of merged.values()) {
            const unit = item.parts.length > 1 ? item.parts.join(' + ') : item.unit;
            const amount = item.parts.length > 1 ? 0 : item.total_amount;
            stmt.run(listId, item.id, amount, unit, (runErr) => {
              if (runErr && !stmtError) stmtError = runErr;
            });
          }

          stmt.finalize((err) => {
            const finalErr = err || stmtError;
            if (finalErr) {
              db.run('ROLLBACK');
              return reject(finalErr);
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
 * Returns the user's latest shopping list together with its period.
 * @param {number} telegramId
 * @returns {Promise<{ items: Array, periodStart: string|null, periodEnd: string|null }>}
 */
async function getLastShoppingList(telegramId) {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT sl.period_start, sl.period_end, i.name, i.type, sli.total_amount, sli.unit
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
        return reject(err);
      }
      if (!rows || rows.length === 0) {
        return resolve({ items: [], periodStart: null, periodEnd: null });
      }
      const { period_start: periodStart, period_end: periodEnd } = rows[0];
      const items = rows.map(({ name, type, total_amount, unit }) => ({
        name, type, total_amount, unit
      }));
      resolve({ items, periodStart, periodEnd });
    });
  });
}

/**
 * Очищает все списки покупок пользователя
 * @param {number} telegramId
 */
async function clearShoppingLists(telegramId) {
  // [RU] FK ON: shopping_list_items.shopping_list_id ссылается на shopping_lists(id)
  // без ON DELETE CASCADE, поэтому сначала удаляем дочерние строки, затем родителей.
  // Обе операции — в одной транзакции, чтобы при падении на втором шаге первый тоже откатился.
  // [EN] FK ON: shopping_list_items.shopping_list_id references shopping_lists(id)
  // without ON DELETE CASCADE. Delete children first, then parents, inside a single
  // transaction so a failure on step 2 rolls back step 1.
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      const childSql = `
        DELETE FROM shopping_list_items
        WHERE shopping_list_id IN (
          SELECT id FROM shopping_lists
          WHERE user_id = (SELECT id FROM users WHERE telegram_id = ?)
        )
      `;
      const parentSql = `
        DELETE FROM shopping_lists
        WHERE user_id = (SELECT id FROM users WHERE telegram_id = ?)
      `;
      db.run(childSql, [telegramId], (err) => {
        if (err) {
          logger.error('Error clearing shopping list items:', err);
          db.run('ROLLBACK');
          return reject(err);
        }
        db.run(parentSql, [telegramId], (err) => {
          if (err) {
            logger.error('Error clearing shopping lists:', err);
            db.run('ROLLBACK');
            return reject(err);
          }
          db.run('COMMIT', (commitErr) => {
            if (commitErr) reject(commitErr);
            else resolve();
          });
        });
      });
    });
  });
}

module.exports = {
  getIngredientsFromPlan,
  saveShoppingList,
  getLastShoppingList,
  clearShoppingLists
};
