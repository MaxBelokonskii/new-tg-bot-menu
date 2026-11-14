const { dbAll, dbRun, withTransaction } = require('../../database/db');
const { getOrCreateUser } = require('../weekly-planner/logic');
const { parseIngredientList, suggestIngredients } = require('../../utils/ingredient-lookup');

/** Preference kinds stored in user_ingredient_prefs.kind. */
const PREF_KINDS = Object.freeze({ EXCLUDED: 'excluded', FAVORITE: 'favorite' });
const KIND_VALUES = new Set(Object.values(PREF_KINDS));

/**
 * @param {string} kind
 * @returns {string}
 * @throws {Error} on an unknown kind
 */
function assertKind(kind) {
  if (!KIND_VALUES.has(kind)) throw new Error(`Unknown ingredient pref kind: ${kind}`);
  return kind;
}

/**
 * Loads the user's preferences as id sets — the shape every recipe picker
 * consumes (generator, random dish, slot replacement, reverse search).
 * @param {number} userId - internal users.id
 * @returns {Promise<{excluded: Set<number>, favorite: Set<number>}>}
 */
async function getUserIngredientPrefs(userId) {
  const rows = await dbAll(
    'SELECT ingredient_id, kind FROM user_ingredient_prefs WHERE user_id = ?',
    [userId]
  );
  const prefs = { excluded: new Set(), favorite: new Set() };
  for (const row of rows) prefs[row.kind]?.add(row.ingredient_id);
  return prefs;
}

/**
 * Same as {@link getUserIngredientPrefs}, addressed by Telegram id.
 * @param {number} telegramId
 * @returns {Promise<{excluded: Set<number>, favorite: Set<number>}>}
 */
async function getPrefsByTelegramId(telegramId) {
  return getUserIngredientPrefs(await getOrCreateUser(telegramId));
}

/**
 * Lists products of one kind for the settings screen, alphabetically.
 * @param {number} telegramId
 * @param {string} kind - 'excluded' | 'favorite'
 * @returns {Promise<Array<{id: number, name: string}>>}
 */
async function listPrefs(telegramId, kind) {
  const userId = await getOrCreateUser(telegramId);
  const rows = await dbAll(
    `SELECT i.id, i.name FROM user_ingredient_prefs p
     JOIN ingredients i ON i.id = p.ingredient_id
     WHERE p.user_id = ? AND p.kind = ?`,
    [userId, assertKind(kind)]
  );
  // [RU] Сортировка в JS: SQLite не умеет кириллическую коллацию.
  // [EN] Sort in JS: SQLite has no Cyrillic collation.
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

/**
 * Resolves user input and stores the recognized products under `kind`.
 *
 * [RU] Продукт из противоположного списка переносится (PK по user+ingredient):
 * добавить в исключённые любимый продукт — значит перестать считать его
 * любимым. Нераспознанные токены возвращаются с подсказками.
 * [EN] A product from the opposite list is moved (PK on user+ingredient):
 * excluding a favorite product stops it being a favorite. Unresolved tokens
 * come back with suggestions.
 *
 * @param {number} telegramId
 * @param {string} kind - 'excluded' | 'favorite'
 * @param {string} text - comma-separated user input
 * @returns {Promise<{added: string[], moved: string[], already: string[],
 *   unknown: Array<{token: string, suggestions: string[]}>}>}
 */
async function addPrefsFromText(telegramId, kind, text) {
  assertKind(kind);
  const { canonical, unknown } = parseIngredientList(text);
  const result = {
    added: [], moved: [], already: [],
    unknown: unknown.map(token => ({ token, suggestions: suggestIngredients(token) }))
  };
  if (canonical.length === 0) return result;

  const userId = await getOrCreateUser(telegramId);
  return withTransaction(async () => {
    const placeholders = canonical.map(() => '?').join(', ');
    const rows = await dbAll(
      `SELECT i.id, i.name, p.kind FROM ingredients i
       LEFT JOIN user_ingredient_prefs p ON p.ingredient_id = i.id AND p.user_id = ?
       WHERE i.name IN (${placeholders})`,
      [userId, ...canonical]
    );
    const found = new Set(rows.map(r => r.name));
    for (const name of canonical.filter(n => !found.has(n))) {
      result.unknown.push({ token: name, suggestions: [] });
    }
    for (const row of rows) {
      if (row.kind === kind) {
        result.already.push(row.name);
        continue;
      }
      await dbRun(
        `INSERT INTO user_ingredient_prefs (user_id, ingredient_id, kind) VALUES (?, ?, ?)
         ON CONFLICT(user_id, ingredient_id) DO UPDATE SET kind = excluded.kind`,
        [userId, row.id, kind]
      );
      (row.kind ? result.moved : result.added).push(row.name);
    }
    return result;
  });
}

/**
 * Removes one product from the user's preference lists.
 * @param {number} telegramId
 * @param {number} ingredientId
 * @returns {Promise<boolean>} true if a row was deleted
 */
async function removePref(telegramId, ingredientId) {
  const userId = await getOrCreateUser(telegramId);
  const { changes } = await dbRun(
    'DELETE FROM user_ingredient_prefs WHERE user_id = ? AND ingredient_id = ?',
    [userId, ingredientId]
  );
  return changes > 0;
}

module.exports = {
  PREF_KINDS,
  getUserIngredientPrefs,
  getPrefsByTelegramId,
  listPrefs,
  addPrefsFromText,
  removePref
};
