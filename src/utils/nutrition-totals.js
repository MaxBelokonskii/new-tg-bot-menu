// [RU] Чистые функции подсчёта КБЖУ дневника: масштабирование на порцию,
// суммирование за день и остаток до нормы. Без БД — их же переиспользует
// подбор «что ещё съесть» (Этап 3.5).
// [EN] Pure food-diary nutrition math: per-portion scaling, daily sums and
// remainder against targets. No DB access — reused by the "what else to eat"
// picker (Stage 3.5).

const NUTRIENTS = ['calories', 'protein', 'fat', 'carbs'];

/**
 * Multiplies per-serving recipe nutrition by the eaten portion.
 * @param {{calories: number, protein: number, fat: number, carbs: number}} recipe - per serving
 * @param {number} portion - servings eaten (0.5, 1, 1.5, 2 …)
 * @returns {{calories: number, protein: number, fat: number, carbs: number}}
 */
function scaleNutrition(recipe, portion) {
  const result = {};
  for (const key of NUTRIENTS) result[key] = (Number(recipe[key]) || 0) * portion;
  return result;
}

/**
 * Sums nutrition of already scaled diary entries.
 * @param {Array<{calories: number, protein: number, fat: number, carbs: number}>} entries
 * @returns {{calories: number, protein: number, fat: number, carbs: number}}
 */
function sumNutrition(entries) {
  const total = { calories: 0, protein: 0, fat: 0, carbs: 0 };
  for (const entry of entries) {
    for (const key of NUTRIENTS) total[key] += Number(entry[key]) || 0;
  }
  return total;
}

/**
 * Returns target − eaten per nutrient; negative means over the target.
 * A nutrient without a target (null/undefined) yields null.
 *
 * @param {{calories: number, protein: number, fat: number, carbs: number}} totals
 * @param {{calories?: number|null, protein?: number|null, fat?: number|null, carbs?: number|null}} targets
 * @returns {{calories: number|null, protein: number|null, fat: number|null, carbs: number|null}}
 */
function calculateRemaining(totals, targets) {
  const result = {};
  for (const key of NUTRIENTS) {
    const target = targets[key];
    result[key] = target === null || target === undefined ? null : target - (totals[key] || 0);
  }
  return result;
}

module.exports = {
  NUTRIENTS,
  scaleNutrition,
  sumNutrition,
  calculateRemaining
};
