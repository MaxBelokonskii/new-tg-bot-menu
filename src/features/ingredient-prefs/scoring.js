// [RU] Чистые функции применения предпочтений к кандидатам-рецептам. Каждый
// кандидат несёт `ingredientIds: number[]`; prefs — результат
// getUserIngredientPrefs ({ excluded: Set, favorite: Set }).
// [EN] Pure helpers applying preferences to recipe candidates. Every
// candidate carries `ingredientIds: number[]`; prefs come from
// getUserIngredientPrefs ({ excluded: Set, favorite: Set }).

/** Weight bonus per favorite ingredient in a recipe. */
const FAVORITE_BONUS = 0.5;
/** Favorites counted at most this many times — a recipe can't win on a pile of them. */
const FAVORITE_CAP = 2;

const EMPTY_PREFS = Object.freeze({ excluded: new Set(), favorite: new Set() });

/**
 * Parses a GROUP_CONCAT of ingredient ids ("3,17,42") into numbers.
 * @param {string|null} raw
 * @returns {number[]}
 */
function parseIdList(raw) {
  if (!raw) return [];
  return String(raw).split(',').map(Number).filter(Number.isInteger);
}

/**
 * Drops recipes that contain any excluded ingredient (hard filter).
 * @template {{ingredientIds: number[]}} T
 * @param {T[]} candidates
 * @param {{excluded: Set<number>}} [prefs]
 * @returns {T[]}
 */
function filterByPrefs(candidates, prefs = EMPTY_PREFS) {
  if (prefs.excluded.size === 0) return candidates;
  return candidates.filter(c => !c.ingredientIds.some(id => prefs.excluded.has(id)));
}

/**
 * Number of the user's favorite ingredients in the recipe.
 * @param {{ingredientIds: number[]}} candidate
 * @param {{favorite: Set<number>}} [prefs]
 * @returns {number}
 */
function favoriteCount(candidate, prefs = EMPTY_PREFS) {
  if (prefs.favorite.size === 0) return 0;
  return new Set(candidate.ingredientIds.filter(id => prefs.favorite.has(id))).size;
}

/**
 * Soft-priority weight: 1 for a plain recipe, up to 1 + BONUS × CAP with favorites.
 * @param {{ingredientIds: number[]}} candidate
 * @param {{favorite: Set<number>}} [prefs]
 * @returns {number}
 */
function favoriteWeight(candidate, prefs = EMPTY_PREFS) {
  return 1 + FAVORITE_BONUS * Math.min(favoriteCount(candidate, prefs), FAVORITE_CAP);
}

/**
 * Weighted random choice.
 * @template T
 * @param {T[]} items
 * @param {(item: T) => number} weightOf - positive weight
 * @param {() => number} [random=Math.random]
 * @returns {T|null}
 */
function pickWeighted(items, weightOf, random = Math.random) {
  if (items.length === 0) return null;
  const weights = items.map(weightOf);
  const total = weights.reduce((sum, w) => sum + w, 0);
  let point = random() * total;
  for (let i = 0; i < items.length; i++) {
    point -= weights[i];
    if (point < 0) return items[i];
  }
  return items[items.length - 1];
}

module.exports = {
  FAVORITE_BONUS,
  FAVORITE_CAP,
  EMPTY_PREFS,
  parseIdList,
  filterByPrefs,
  favoriteCount,
  favoriteWeight,
  pickWeighted
};
