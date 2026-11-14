const fs = require('fs');
const path = require('path');

const CONVERSIONS_PATH = path.resolve(__dirname, '../../database/unit-conversions.json');
const DEFAULT_BASE = 'г';

function loadConversions() {
  try {
    return JSON.parse(fs.readFileSync(CONVERSIONS_PATH, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to load ${CONVERSIONS_PATH}: ${err.message}`);
  }
}

const { units: DEFAULT_UNITS, noQuantity, ingredients: SPECS } = loadConversions();
const NO_QUANTITY = new Set(noQuantity);

/**
 * Extracts a total-weight hint from a raw unit: "шт (~500 г)" → 500,
 * "шт (200-300 г)" → 200 (lower bound, same as parseAmount).
 * @param {string} rawUnit
 * @returns {number|null}
 */
function parseWeightHint(rawUnit) {
  const match = /\(\s*~?\s*([\d.,]+)(?:\s*[-–—]\s*[\d.,]+)?\s*г\s*\)/.exec(rawUnit || '');
  return match ? parseFloat(match[1].replace(',', '.')) : null;
}

/**
 * @param {string} name - canonical ingredient name
 * @returns {string} base shopping unit: 'г', 'мл' or 'шт'
 */
function baseUnitOf(name) {
  return (SPECS[name] && SPECS[name].base) || DEFAULT_BASE;
}

/**
 * Converts an amount into the ingredient's base unit.
 *
 * [RU] Всё сводим к «граммам» (для жидкостей — мл при плотности воды), а для
 * штучных продуктов (base = 'шт') делим граммы на вес одной штуки. Подсказка
 * «(150 г)» из рецепта — это общий вес, она точнее справочных коэффициентов.
 * [EN] Everything is reduced to grams (ml at water density for liquids); for
 * piece-based products (base = 'шт') grams are divided by one piece's weight.
 * A "(150 г)" hint from the recipe is the total weight and beats the defaults.
 *
 * @param {string} name - canonical ingredient name
 * @param {number} amount
 * @param {string} unit - normalized unit
 * @param {number|null} [hintGrams] - total weight from a "(N г)" hint
 * @returns {{amountBase: number|null, baseUnit: string|null, convertible: boolean}}
 *   amountBase/baseUnit are null for "по вкусу"-like rows;
 *   convertible=false means the dictionary lacks a factor for this unit.
 */
function toBase(name, amount, unit, hintGrams = null) {
  if (!amount || NO_QUANTITY.has(unit)) {
    return { amountBase: null, baseUnit: null, convertible: true };
  }
  const spec = SPECS[name] || {};
  const baseUnit = baseUnitOf(name);
  if (baseUnit === 'шт' && unit === 'шт') {
    return { amountBase: amount, baseUnit, convertible: true };
  }
  const factor = spec[unit] !== undefined ? spec[unit] : DEFAULT_UNITS[unit];
  let grams = hintGrams && baseUnit !== 'шт' ? hintGrams : null;
  if (grams === null && factor !== undefined) grams = amount * factor;
  if (grams === null) return { amountBase: null, baseUnit: null, convertible: false };
  if (baseUnit !== 'шт') return { amountBase: grams, baseUnit, convertible: true };
  if (!spec['шт']) return { amountBase: null, baseUnit: null, convertible: false };
  return { amountBase: grams / spec['шт'], baseUnit, convertible: true };
}

/**
 * Weight in grams of an amount given in the ingredient's base unit
 * (pieces are multiplied by the piece weight).
 * @param {string} name - canonical ingredient name
 * @param {number} amountBase
 * @param {string} baseUnit
 * @returns {number}
 */
function baseToGrams(name, amountBase, baseUnit) {
  if (baseUnit !== 'шт') return amountBase;
  return amountBase * ((SPECS[name] && SPECS[name]['шт']) || 0);
}

module.exports = { toBase, baseUnitOf, baseToGrams, parseWeightHint };
