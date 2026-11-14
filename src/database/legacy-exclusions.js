const { dbAll, dbGet, dbRun, withTransaction } = require('./db');
const { parseIngredientList } = require('../utils/ingredient-lookup');
const logger = require('../utils/logger');

/**
 * Moves the legacy free-text `user_preferences.exclude_ingredients` into
 * `user_ingredient_prefs` (kind = 'excluded') and drops the column.
 *
 * [RU] Идемпотентно: если колонки уже нет — ничего не делает. Токены
 * распознаются тем же lookup, что и ввод в боте; нераспознанные и продукты,
 * которых нет в каталоге, пропускаются с предупреждением в лог. Перенос и
 * DROP COLUMN — одна транзакция.
 * [EN] Idempotent: no-op once the column is gone. Tokens are resolved with
 * the same lookup as bot input; unresolved ones and products missing from
 * the catalog are skipped with a log warning. Copy and DROP COLUMN run in
 * one transaction.
 *
 * @returns {Promise<{users: number, moved: number, skipped: string[]}>}
 */
async function migrateLegacyExclusions() {
  const columns = await dbAll('PRAGMA table_info(user_preferences)');
  if (!columns.some(c => c.name === 'exclude_ingredients')) {
    return { users: 0, moved: 0, skipped: [] };
  }
  return withTransaction(async () => {
    const rows = await dbAll(
      `SELECT user_id, exclude_ingredients FROM user_preferences
       WHERE exclude_ingredients IS NOT NULL AND TRIM(exclude_ingredients) <> ''`
    );
    let moved = 0;
    const skipped = [];
    for (const row of rows) {
      const { canonical, unknown } = parseIngredientList(row.exclude_ingredients);
      skipped.push(...unknown);
      for (const name of canonical) {
        const ingredient = await dbGet('SELECT id FROM ingredients WHERE name = ?', [name]);
        if (!ingredient) {
          skipped.push(name);
          continue;
        }
        await dbRun(
          `INSERT OR IGNORE INTO user_ingredient_prefs (user_id, ingredient_id, kind)
           VALUES (?, ?, 'excluded')`,
          [row.user_id, ingredient.id]
        );
        moved++;
      }
    }
    await dbRun('ALTER TABLE user_preferences DROP COLUMN exclude_ingredients');
    if (skipped.length > 0) {
      logger.warn(`Legacy exclusions not migrated: ${skipped.join(', ')}`);
    }
    return { users: rows.length, moved, skipped };
  });
}

module.exports = { migrateLegacyExclusions };
