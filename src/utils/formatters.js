const texts = require('../bot/texts');

/**
 * Formats a recipe's nutrition line ("КБЖУ: kcal / protein / fat / carbs").
 * @param {{calories: number, protein: number, fat: number, carbs: number}} recipe
 * @returns {string}
 */
function formatNutrition({ calories, protein, fat, carbs }) {
  return texts.recipeCard.nutrition
    .replace('{calories}', calories)
    .replace('{protein}', protein)
    .replace('{fat}', fat)
    .replace('{carbs}', carbs);
}

const LARGE_UNIT_FACTOR = 1000;

/**
 * Formats a decimal with a comma separator and at most one fraction digit.
 * @param {number} value
 * @returns {string}
 */
function formatDecimal(value) {
  return String(Math.round(value * 10) / 10).replace('.', ',');
}

/**
 * Formats a shopping-list quantity given in a base unit.
 *
 * [RU] Штуки округляются вверх (полавокадо всё равно покупают целиком),
 * граммы и миллилитры — до целого (минимум 1), от 1000 переводятся в кг/л.
 * [EN] Pieces round up (half an avocado is still bought whole); grams and
 * millilitres round to an integer (min 1) and switch to kg/l from 1000.
 *
 * @param {number} amount
 * @param {string} unit - base unit: 'г' | 'мл' | 'шт'
 * @returns {string}
 */
function formatQuantity(amount, unit) {
  if (unit === 'шт') return `${Math.max(1, Math.ceil(amount - 1e-9))} ${unit}`;
  const large = texts.shoppingList.largeUnits[unit];
  if (large && amount >= LARGE_UNIT_FACTOR) {
    return `${formatDecimal(amount / LARGE_UNIT_FACTOR)} ${large}`;
  }
  return `${Math.max(1, Math.round(amount))} ${unit}`;
}

/**
 * Formats one shopping-list item quantity: "300 г", "по вкусу" or
 * "300 г + по вкусу".
 * @param {{total_amount: number, unit: string, to_taste: boolean}} item
 * @returns {string}
 */
function formatShoppingQuantity({ total_amount: amount, unit, to_taste: toTaste }) {
  if (!(amount > 0) || !unit) return texts.shoppingList.toTaste;
  const qty = formatQuantity(amount, unit);
  return toTaste ? `${qty} + ${texts.shoppingList.toTaste}` : qty;
}

module.exports = { formatNutrition, formatQuantity, formatShoppingQuantity };
