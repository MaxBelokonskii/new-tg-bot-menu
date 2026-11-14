const fs = require('fs');
const path = require('path');

const DICT_DIR = path.resolve(__dirname, '../../database');
const SUGGESTION_LIMIT = 3;
const MIN_STEM_LENGTH = 3;
// [RU] Подсказки сравнивают первые 4 буквы основы: «куриц-а» ~ «курин-ое».
// [EN] Suggestions compare the first 4 stem letters: "куриц-а" ~ "курин-ое".
const SUGGESTION_PREFIX = 4;

/**
 * Lowercases and folds "ё" to "е" — users type both spellings.
 * @param {string} value
 * @returns {string}
 */
function fold(value) {
  return String(value).trim().toLowerCase().replace(/ё/g, 'е');
}

/**
 * Crude Russian stem: drops trailing vowels / soft sign so that
 * "помидоры" and "помидор", "яйца" and "яйцо" compare equal.
 * @param {string} folded - already folded value
 * @returns {string}
 */
function stem(folded) {
  const cut = folded.replace(/[аяыиоеуюьй]+$/, '');
  return cut.length >= MIN_STEM_LENGTH ? cut : folded;
}

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(DICT_DIR, fileName), 'utf8'));
}

// [RU] Словарь «что ввёл пользователь → каноническое имя ингредиента» строится
// один раз при загрузке модуля: канонические имена из ingredient-types.json,
// алиасы из ingredient-aliases.json и правило «*» из _byUnit («перец» без
// единицы — это чёрный перец, как и в каталоге).
// [EN] "User-typed → canonical name" dictionary, built once at module load:
// canonical names from ingredient-types.json, aliases from
// ingredient-aliases.json and the "*" rule of _byUnit (a bare "перец" means
// black pepper, as in the catalog).
const { LOOKUP, CANONICAL } = (() => {
  const lookup = new Map();
  const canonical = [];
  for (const name of Object.keys(readJson('ingredient-types.json'))) {
    if (name.startsWith('_')) continue;
    canonical.push(name);
    lookup.set(fold(name), name);
  }
  const aliases = readJson('ingredient-aliases.json');
  for (const [name, list] of Object.entries(aliases)) {
    if (name.startsWith('_') || !Array.isArray(list)) continue;
    for (const alias of list) lookup.set(fold(alias), name);
  }
  for (const [name, rule] of Object.entries(aliases._byUnit || {})) {
    if (rule['*']) lookup.set(fold(name), rule['*']);
  }
  return { LOOKUP: lookup, CANONICAL: canonical };
})();

// [RU] Индекс по основам для второй попытки: только однозначные основы.
// [EN] Stem index for the second attempt: unambiguous stems only.
const STEM_LOOKUP = (() => {
  const byStem = new Map();
  for (const [key, name] of LOOKUP) {
    const s = stem(key);
    const prev = byStem.get(s);
    byStem.set(s, prev === undefined || prev === name ? name : null);
  }
  return byStem;
})();

/**
 * Resolves one user-typed product name to its canonical ingredient name:
 * exact / alias match first, then a match by word stem when it is unambiguous.
 * @param {string} token
 * @returns {string|null}
 */
function resolveIngredientName(token) {
  const key = fold(token);
  if (!key) return null;
  return LOOKUP.get(key) || STEM_LOOKUP.get(stem(key)) || null;
}

/**
 * Canonical names with a word starting like the token — hints for an
 * unrecognized input ("курица" → "Куриное филе", "огурцы" → "Огурец").
 * @param {string} token
 * @param {number} [limit]
 * @returns {string[]}
 */
function suggestIngredients(token, limit = SUGGESTION_LIMIT) {
  const prefix = stem(fold(token)).slice(0, SUGGESTION_PREFIX);
  if (prefix.length < MIN_STEM_LENGTH) return [];
  return CANONICAL
    .filter(name => fold(name).split(/\s+/).some(word => word.startsWith(prefix)))
    .slice(0, limit);
}

/**
 * Parses a comma-separated list typed by the user into canonical ingredient
 * names (ordered, deduplicated). Unresolved tokens are returned separately so
 * the UI can warn the user.
 *
 * @param {string} text - raw input, e.g. "огурец, помидоры, лук"
 * @returns {{canonical: string[], unknown: string[]}}
 */
function parseIngredientList(text) {
  if (!text) return { canonical: [], unknown: [] };
  const canonical = [];
  const unknown = [];
  for (const token of String(text).split(/[,;\n]/).map(t => t.trim()).filter(Boolean)) {
    const hit = resolveIngredientName(token);
    if (!hit) unknown.push(token);
    else if (!canonical.includes(hit)) canonical.push(hit);
  }
  return { canonical, unknown };
}

module.exports = {
  resolveIngredientName,
  suggestIngredients,
  parseIngredientList
};
