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

/**
 * Picks the Russian plural form for a count: 1 / 2–4 / 5+ (11–14 → 5+).
 * @param {number} n
 * @param {[string, string, string]} forms - forms for 1, 2–4 and 5+
 * @returns {string}
 */
function pluralRu(n, [one, few, many]) {
  const abs = Math.abs(Math.trunc(n));
  const mod100 = abs % 100;
  const mod10 = abs % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/**
 * Builds the recipe-card ingredients header: "Ингредиенты (на 4 порции):".
 * Ingredient amounts are for the whole dish, so the servings count is shown
 * next to them (nutrition on the card is per serving).
 * @param {number} servings - recipes.servings; falls back to 1
 * @returns {string}
 */
function formatIngredientsHeader(servings) {
  const n = Number.isInteger(servings) && servings > 0 ? servings : 1;
  const amount = pluralRu(n, texts.recipeCard.servings).replace('{n}', n);
  return texts.recipeCard.ingredientsLabel.replace('{servings}', amount);
}

// [RU] Номер слота плана → ключ подписи в texts.profile.calories.slots.
// [EN] Plan slot number → label key in texts.profile.calories.slots.
const SLOT_KEYS = { 1: 'breakfast', 2: 'main1', 3: 'main2', 4: 'salad', 5: 'dessert' };

/**
 * Localized label of a plan slot ("Завтрак", "Основное №1", …).
 * @param {number} slot - 1..5
 * @returns {string}
 */
function slotLabel(slot) {
  return texts.profile.calories.slots[SLOT_KEYS[slot]] || String(slot);
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

module.exports = {
  formatNutrition,
  pluralRu,
  formatIngredientsHeader,
  slotLabel,
  formatQuantity,
  formatShoppingQuantity
};
