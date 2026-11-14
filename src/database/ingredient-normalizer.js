const fs = require('fs');
const path = require('path');

const DICT_DIR = path.resolve(__dirname, '../../database');
const FALLBACK_TYPE = 'Другое';

/**
 * Reads a JSON dictionary file, skipping keys that start with "_" (docs/meta).
 * @param {string} fileName - file name inside database/
 * @returns {object}
 */
function readDictionary(fileName) {
  const filePath = path.join(DICT_DIR, fileName);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to load dictionary ${filePath}: ${err.message}`);
  }
}

/**
 * Inverts a "canonical -> [aliases]" object into an alias -> canonical Map.
 * @param {object} raw
 * @returns {Map<string, string>}
 */
function invertAliases(raw) {
  const map = new Map();
  for (const [canonical, aliases] of Object.entries(raw)) {
    if (canonical.startsWith('_') || !Array.isArray(aliases)) continue;
    for (const alias of aliases) map.set(alias, canonical);
  }
  return map;
}

const ingredientDict = readDictionary('ingredient-aliases.json');
const ingredientAliases = invertAliases(ingredientDict);
const splitRules = ingredientDict._split || {};
const byUnitRules = ingredientDict._byUnit || {};
const unitAliases = invertAliases(readDictionary('unit-aliases.json'));
const ingredientTypes = new Map(
  Object.entries(readDictionary('ingredient-types.json'))
    .filter(([name, type]) => !name.startsWith('_') && typeof type === 'string')
);

/**
 * Parses an ingredient amount string into a numeric amount + raw unit.
 *
 *   "100 г" → {100, "г"}; "1/2 ст." → {0.5, "ст."}; "2-3 шт" → {2, "шт"} (lower bound);
 *   "по вкусу" → {0, "по вкусу"}; "" → {0, "не указано"}.
 *
 * @param {string} amountStr
 * @returns {{amount: number, unit: string}}
 */
function parseAmount(amountStr) {
  if (!amountStr) return { amount: 0, unit: 'не указано' };

  // [RU] Диапазон: ведущее число, опционально "-/–/— второе число", затем единица.
  // [EN] Range: leading number, optional "- / – / — second number", then unit.
  const match = amountStr.match(
    /^([\d.,]+(?:\/[\d.,]+)?)(?:\s*[-–—]\s*[\d.,]+(?:\/[\d.,]+)?)?\s*(.*)$/
  );
  if (!match) return { amount: 0, unit: amountStr };

  const lead = match[1];
  let amount;
  if (lead.includes('/')) {
    const [num, den] = lead.split('/').map(s => parseFloat(s.replace(',', '.')));
    amount = den ? num / den : num;
  } else {
    amount = parseFloat(lead.replace(',', '.'));
  }

  const unit = match[2].trim() || 'шт';
  return { amount: isNaN(amount) ? 0 : amount, unit };
}

/**
 * Collapses unit spelling variants and strips "(150 г)" hints.
 * @param {string} unit
 * @returns {string}
 */
function normalizeUnit(unit) {
  if (!unit) return unit;
  const clean = unit.replace(/\s*\(.*\)\s*$/, '').trim();
  return unitAliases.get(clean) || clean;
}

/**
 * "Йогурт или сметана" / "Миндаль/фундук" → first option (owner decision 2026-11-14).
 * @param {string} name
 * @returns {string}
 */
function firstAlternative(name) {
  return name.split(/\s+или\s+|\//)[0].trim();
}

/**
 * Maps one source name (no commas) to its canonical name: alternatives →
 * first option, then unit-dependent rules ("Перец" in "шт" is a bell pepper),
 * then the alias dictionary.
 *
 * @param {string} name
 * @param {string} unit - normalized unit
 * @returns {string}
 */
function canonicalName(name, unit) {
  const base = firstAlternative(name);
  const rule = byUnitRules[base];
  const byUnit = rule ? (rule[unit] || rule['*']) : null;
  const resolved = byUnit || base;
  return ingredientAliases.get(resolved) || resolved;
}

/**
 * Resolves one recipes.json ingredient entry into one or more canonical rows.
 * Compound entries ("Соль, перец") are split via `_split`; a quantitative
 * amount is divided evenly between the parts.
 *
 * @param {{item: string, amount: string}} entry
 * @returns {Array<{name: string, amount: number, unit: string}>}
 */
function resolveIngredient(entry) {
  const parsed = parseAmount(entry.amount);
  const unit = normalizeUnit(parsed.unit);
  const parts = splitRules[entry.item] || [entry.item];
  const amount = parsed.amount / parts.length;
  return parts.map(part => ({ name: canonicalName(part, unit), amount, unit }));
}

/**
 * Merges rows that collapsed onto the same ingredient inside one recipe
 * (e.g. "Соль" + "Соль, перец"). Same unit → amounts are summed; a
 * no-amount row ("по вкусу") yields to a quantitative one; otherwise the
 * first row wins and the conflict is reported.
 *
 * @param {Array<{name: string, amount: number, unit: string}>} rows
 * @returns {{rows: Array<{name: string, amount: number, unit: string}>, conflicts: string[]}}
 */
function mergeRecipeRows(rows) {
  const byName = new Map();
  const conflicts = [];
  for (const row of rows) {
    const prev = byName.get(row.name);
    if (!prev) {
      byName.set(row.name, { ...row });
    } else if (prev.unit === row.unit) {
      prev.amount += row.amount;
    } else if (!prev.amount && row.amount) {
      byName.set(row.name, { ...row });
    } else if (row.amount) {
      conflicts.push(`${row.name}: ${prev.amount} ${prev.unit} vs ${row.amount} ${row.unit}`);
    }
  }
  return { rows: [...byName.values()], conflicts };
}

/**
 * Full per-recipe pipeline: resolve every entry, then merge collisions.
 * @param {Array<{item: string, amount: string}>} ingredients
 * @returns {{rows: Array<{name: string, amount: number, unit: string}>, conflicts: string[]}}
 */
function resolveRecipeIngredients(ingredients) {
  return mergeRecipeRows(ingredients.flatMap(resolveIngredient));
}

/**
 * @param {string} canonical
 * @returns {string} shopping-list type, or FALLBACK_TYPE
 */
function classifyIngredient(canonical) {
  return ingredientTypes.get(canonical) || FALLBACK_TYPE;
}

/**
 * @param {string} canonical
 * @returns {boolean}
 */
function hasType(canonical) {
  return ingredientTypes.has(canonical);
}

/**
 * Names that must never reach the DB: compound or alternative entries.
 * @param {string} name
 * @returns {boolean}
 */
function isDirtyName(name) {
  return /,|\sили\s|\//.test(name);
}

module.exports = {
  FALLBACK_TYPE,
  parseAmount,
  normalizeUnit,
  canonicalName,
  resolveIngredient,
  mergeRecipeRows,
  resolveRecipeIngredients,
  classifyIngredient,
  hasType,
  isDirtyName
};
