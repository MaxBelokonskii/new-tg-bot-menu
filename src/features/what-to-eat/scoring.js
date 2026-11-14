// [RU] Чистый алгоритм «что ещё съесть сегодня» (roadmap 2.14): оценка блюда
// против остатка КБЖУ, выбор одиночных блюд и комбинаций. Без БД — данные
// готовит features/what-to-eat/logic.js.
// [EN] Pure "what else to eat today" algorithm (roadmap 2.14): scores a dish
// against the remaining macros, picks single dishes and combinations. No DB —
// features/what-to-eat/logic.js prepares the data.

const { NUTRIENTS, scaleNutrition, sumNutrition } = require('../../utils/nutrition-totals');
const { favoriteWeight } = require('../ingredient-prefs/scoring');

/** Below this many kcal left the day counts as done. */
const DONE_KCAL = 100;
/** One "next meal" suggestion aims at no more than this many kcal. */
const MEAL_KCAL_CAP = 700;
const SINGLE_PORTIONS = [0.5, 1];
const COMBO_PORTIONS = [0.5, 1, 1.5];
/** Recipes that enter the pair/triple search (by single score vs the whole remainder). */
const COMBO_POOL = 30;
const SINGLES_PER_PAGE = 3;
const COMBOS_PER_PAGE = 2;
const MAX_COMBO_PAGES = 5;

// [RU] Главное — калории, из макросов важнее белок (его чаще всего не хватает).
// Углеводы весят меньше всего: в каталоге мало углеводистых блюд, и при равных
// весах комбинации недобирали сотни ккал ради точных углеводов. Превысить
// хуже, чем недобрать.
// [EN] Calories matter most, protein is the key macro (usually short). Carbs
// weigh least: the catalog has few carb-heavy dishes, and with equal weights
// combos fell hundreds of kcal short chasing carbs. Overshooting is worse
// than undershooting.
const WEIGHTS = { calories: 1.5, protein: 1.2, fat: 0.6, carbs: 0.4 };
const OVER_PENALTY = 2;
// [RU] Мягкий учёт времени суток: после полудня завтраки хуже, основное блюдо —
// лучше, пока его сегодня не было.
// [EN] Soft time-of-day rules: after noon breakfasts rank lower, a main dish
// ranks higher while none was eaten today.
const LATE_BREAKFAST_FACTOR = 2;
const MISSING_MAIN_FACTOR = 0.85;
const NOON = 12;

/**
 * Remaining-day status: 'done' (< DONE_KCAL left), 'over' (kcal exceeded) or 'open'.
 * @param {{calories: number}} remaining
 * @returns {'open'|'done'|'over'}
 */
function remainingStatus(remaining) {
  if (remaining.calories < 0) return 'over';
  if (remaining.calories < DONE_KCAL) return 'done';
  return 'open';
}

/**
 * Target for one dish: the remainder itself, or — when more than one meal is
 * left — the remainder scaled down proportionally to MEAL_KCAL_CAP.
 * @param {{calories: number, protein: number, fat: number, carbs: number}} remaining
 * @returns {{calories: number, protein: number, fat: number, carbs: number}}
 */
function mealTarget(remaining) {
  if (remaining.calories <= MEAL_KCAL_CAP) return { ...remaining };
  return scaleNutrition(remaining, MEAL_KCAL_CAP / remaining.calories);
}

/**
 * Weighted distance between eaten nutrition and a target, each nutrient
 * normalized by the daily norm; overshooting costs OVER_PENALTY times more.
 * Lower is better, 0 is a perfect hit.
 *
 * @param {{calories: number, protein: number, fat: number, carbs: number}} nutrition
 * @param {{calories: number, protein: number, fat: number, carbs: number}} target
 * @param {{calories: number, protein: number, fat: number, carbs: number}} norms - daily targets
 * @returns {number}
 */
function nutritionDistance(nutrition, target, norms) {
  let score = 0;
  for (const key of NUTRIENTS) {
    const diff = nutrition[key] - target[key];
    const scale = Math.max(norms[key], 1);
    score += WEIGHTS[key] * (Math.abs(diff) / scale) * (diff > 0 ? OVER_PENALTY : 1);
  }
  return score;
}

/**
 * Multiplier from soft context rules (time of day, main dish not eaten yet).
 * @param {{category: string}} recipe
 * @param {{hour: number, eatenCategories: Set<string>}} context
 * @returns {number}
 */
function contextFactor(recipe, { hour, eatenCategories }) {
  let factor = 1;
  if (recipe.category === 'breakfast' && hour >= NOON) factor *= LATE_BREAKFAST_FACTOR;
  if (recipe.category === 'main' && hour >= NOON && !eatenCategories.has('main')) factor *= MISSING_MAIN_FACTOR;
  return factor;
}

/**
 * Scores one recipe at one portion against a target (lower is better).
 * @param {object} recipe - per-serving nutrition, category, ingredientIds
 * @param {number} portion
 * @param {object} target
 * @param {object} ctx - {norms, prefs, hour, eatenCategories}
 * @returns {{recipe: object, portion: number, nutrition: object, score: number}}
 */
function scoreRecipeForRemaining(recipe, portion, target, ctx) {
  const nutrition = scaleNutrition(recipe, portion);
  const score = nutritionDistance(nutrition, target, ctx.norms)
    * contextFactor(recipe, ctx) / favoriteWeight(recipe, ctx.prefs);
  return { recipe, portion, nutrition, score };
}

/**
 * Best portion of every recipe against the target, sorted by score.
 * @param {object[]} recipes
 * @param {object} target
 * @param {object} ctx
 * @param {number[]} portions
 * @returns {Array<{recipe: object, portion: number, nutrition: object, score: number}>}
 */
function rankSingles(recipes, target, ctx, portions = SINGLE_PORTIONS) {
  return recipes
    .map(recipe => portions
      .map(portion => scoreRecipeForRemaining(recipe, portion, target, ctx))
      .reduce((best, option) => (option.score < best.score ? option : best)))
    .sort((a, b) => a.score - b.score);
}

/**
 * Combos may repeat only the main category (two different mains is a normal day).
 * @param {object[]} recipes
 * @returns {boolean}
 */
function categoriesCompatible(recipes) {
  const seen = new Set();
  for (const { category } of recipes) {
    if (category !== 'main' && seen.has(category)) return false;
    seen.add(category);
  }
  return true;
}

/**
 * Yields all k-subsets of items (k = 2 or 3), index order preserved.
 * @template T
 * @param {T[]} items
 * @param {number} k
 * @returns {T[][]}
 */
function subsets(items, k) {
  const result = [];
  const walk = (start, picked) => {
    if (picked.length === k) {
      result.push(picked);
      return;
    }
    for (let i = start; i < items.length; i++) walk(i + 1, [...picked, items[i]]);
  };
  walk(0, []);
  return result;
}

/**
 * All portion assignments for a set of recipes.
 * @param {number} count
 * @returns {number[][]}
 */
function portionVariants(count) {
  if (count === 0) return [[]];
  return COMBO_PORTIONS.flatMap(p => portionVariants(count - 1).map(rest => [p, ...rest]));
}

/**
 * Searches pairs and triples from the pool that best close the whole remainder.
 *
 * [RU] Пул — топ COMBO_POOL рецептов по одиночной оценке против всего остатка
 * (так в пул попадают сытные блюда). Перебор: C(30,2)+C(30,3) ≈ 4500 наборов ×
 * до 27 вариантов порций — меньше секунды.
 * [EN] The pool is the top COMBO_POOL recipes by single score against the
 * whole remainder (so filling dishes get in). Search: C(30,2)+C(30,3) ≈ 4500
 * sets × up to 27 portion variants — well under a second.
 *
 * @param {object[]} recipes
 * @param {object} remaining
 * @param {object} ctx
 * @returns {Array<{items: Array<{recipe: object, portion: number}>, nutrition: object, score: number}>}
 */
function pickCombos(recipes, remaining, ctx) {
  const pool = rankSingles(recipes, remaining, ctx, [1]).slice(0, COMBO_POOL).map(o => o.recipe);
  const combos = [];
  for (const size of [2, 3]) {
    for (const set of subsets(pool, size)) {
      if (!categoriesCompatible(set)) continue;
      let best = null;
      for (const portions of portionVariants(size)) {
        const items = set.map((recipe, i) => ({ recipe, portion: portions[i] }));
        const nutrition = sumNutrition(items.map(it => scaleNutrition(it.recipe, it.portion)));
        const factor = items.reduce((f, it) => f * contextFactor(it.recipe, ctx), 1) ** (1 / size);
        const weight = items.reduce((w, it) => w + favoriteWeight(it.recipe, ctx.prefs), 0) / size;
        const score = nutritionDistance(nutrition, remaining, ctx.norms) * factor / weight;
        if (!best || score < best.score) best = { items, nutrition, score };
      }
      combos.push(best);
    }
  }
  return combos.sort((a, b) => a.score - b.score);
}

/**
 * Keeps combos that share at most one recipe with every already kept combo,
 * so the list doesn't repeat the same dishes in different portions.
 * @param {Array<{items: Array<{recipe: {id: number}}>}>} combos - sorted
 * @param {number} limit
 * @returns {Array} up to `limit` combos
 */
function distinctCombos(combos, limit) {
  const kept = [];
  for (const combo of combos) {
    const ids = new Set(combo.items.map(it => it.recipe.id));
    const overlaps = kept.some(k => k.items.filter(it => ids.has(it.recipe.id)).length > 1);
    if (!overlaps) kept.push(combo);
    if (kept.length >= limit) break;
  }
  return kept;
}

const wrapPage = (page, total) => ((page % total) + total) % total;

/**
 * Builds a page of suggestions: SINGLES_PER_PAGE dishes for the next meal and
 * COMBOS_PER_PAGE combinations closing the whole remainder. Pages wrap around
 * (singles and combos independently).
 *
 * @param {object[]} recipes - candidates (already without excluded / eaten today)
 * @param {object} remaining - target − eaten for today
 * @param {object} ctx - {norms, prefs, hour, eatenCategories}
 * @param {number} [page=0]
 * @returns {{singles: Array, combos: Array, page: number}}
 */
function buildSuggestions(recipes, remaining, ctx, page = 0) {
  const singles = rankSingles(recipes, mealTarget(remaining), ctx);
  const combos = distinctCombos(pickCombos(recipes, remaining, ctx), COMBOS_PER_PAGE * MAX_COMBO_PAGES);
  const singlePage = wrapPage(page, Math.max(1, Math.ceil(singles.length / SINGLES_PER_PAGE)));
  const comboPage = wrapPage(page, Math.max(1, Math.ceil(combos.length / COMBOS_PER_PAGE)));
  return {
    singles: singles.slice(singlePage * SINGLES_PER_PAGE, (singlePage + 1) * SINGLES_PER_PAGE),
    combos: combos.slice(comboPage * COMBOS_PER_PAGE, (comboPage + 1) * COMBOS_PER_PAGE),
    page
  };
}

module.exports = {
  DONE_KCAL,
  MEAL_KCAL_CAP,
  SINGLES_PER_PAGE,
  COMBOS_PER_PAGE,
  remainingStatus,
  mealTarget,
  nutritionDistance,
  contextFactor,
  scoreRecipeForRemaining,
  rankSingles,
  pickCombos,
  distinctCombos,
  buildSuggestions
};
