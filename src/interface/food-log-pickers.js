const { Markup } = require('telegraf');
const texts = require('../bot/texts');
const { formatDayLabel, formatPortion, fillNutrition, truncate } = require('./food-log');
const { scaleNutrition } = require('../utils/nutrition-totals');
const { buildPageRow, recipeButton } = require('./favorite-recipes');

const T = texts.foodLog;
const PORTION_HALVES = [1, 2, 3, 4];
// [RU] Номер слота плана → ключ подписи в texts.profile.calories.slots.
// [EN] Plan slot number → label key in texts.profile.calories.slots.
const SLOT_KEYS = { 1: 'breakfast', 2: 'main1', 3: 'main2', 4: 'salad', 5: 'dessert' };

const backToDay = (date) => Markup.button.callback(T.buttons.backToDay, `fl_day_${date}`);

/**
 * Builds the "what did you eat from the plan" picker: one button per planned
 * dish (✅ when already in the diary). Callback carries the plan slot.
 *
 * @param {string} date - YYYY-MM-DD
 * @param {string} today - YYYY-MM-DD
 * @param {Array<{slot: number, recipeId: number, name: string, logged: boolean}>} dishes - non-empty
 * @returns {{text: string, extra: object}}
 */
function buildPlanPicker(date, today, dishes) {
  const rows = dishes.map(dish => [Markup.button.callback(
    (dish.logged ? T.plan.loggedMark : '') + T.plan.item
      .replace('{slot}', texts.profile.calories.slots[SLOT_KEYS[dish.slot]])
      .replace('{name}', truncate(dish.name)),
    `fl_pick_${date}_${dish.recipeId}_${dish.slot}`
  )]);
  rows.push([backToDay(date)]);
  const text = T.plan.title.replace('{day}', formatDayLabel(date, today));
  return { text, extra: Markup.inlineKeyboard(rows) };
}

/**
 * Builds the recipe search results: up to SEARCH_LIMIT recipe buttons plus
 * "search again" and "back to diary".
 *
 * @param {string} date - diary date the picked recipe will be logged to
 * @param {Array<{id: number, name: string, calories: number}>} recipes - non-empty
 * @param {number} total - total number of matches (may exceed recipes.length)
 * @returns {{text: string, extra: object}}
 */
function buildSearchResults(date, recipes, total) {
  const lines = [T.search.results.replace('{count}', total)];
  if (total > recipes.length) lines.push(T.search.moreHint.replace('{limit}', recipes.length));
  const rows = recipes.map(recipe => [Markup.button.callback(
    `${truncate(recipe.name)} · ${recipe.calories} ${T.units.calories}`,
    `fl_pick_${date}_${recipe.id}_0`
  )]);
  rows.push([Markup.button.callback(T.buttons.searchAgain, `fl_search_${date}`), backToDay(date)]);
  return { text: lines.join('\n'), extra: { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) } };
}

/**
 * Builds the "eaten from favorites" picker: one button per favorite recipe
 * (leads to the portion picker, no plan slot), paging and "back to diary".
 *
 * @param {string} date - diary date the picked recipe will be logged to
 * @param {string} today - YYYY-MM-DD
 * @param {{recipes: Array<{id: number, name: string, calories: number}>,
 *   page: number, pages: number}} list - recipes non-empty
 * @returns {{text: string, extra: object}}
 */
function buildFavoritesPicker(date, today, { recipes, page, pages }) {
  const lines = [T.favorites.title.replace('{day}', formatDayLabel(date, today))];
  if (pages > 1) lines.push(T.favorites.pageInfo.replace('{page}', page + 1).replace('{pages}', pages));
  const rows = recipes.map(recipe => [recipeButton(recipe, `fl_pick_${date}_${recipe.id}_0`)]);
  const pageRow = buildPageRow(page, pages, p => `fl_fav_${date}_${p}`);
  if (pageRow.length) rows.push(pageRow);
  rows.push([backToDay(date)]);
  return { text: lines.join('\n'), extra: Markup.inlineKeyboard(rows) };
}

/**
 * Builds the portion picker (½ / 1 / 1½ / 2) for a recipe. Buttons carry the
 * portion as a number of halves; slot 0 means "not from the plan".
 *
 * @param {string} date - YYYY-MM-DD
 * @param {{id: number, name: string, calories: number, protein: number, fat: number, carbs: number}} recipe
 * @param {number} slot - plan slot 1..5 or 0
 * @returns {{text: string, extra: object}}
 */
function buildPortionPicker(date, recipe, slot) {
  const text = [
    `<b>${recipe.name}</b>`,
    fillNutrition(T.portion.perServing, recipe),
    '',
    T.portion.ask
  ].join('\n');
  const keyboard = Markup.inlineKeyboard([
    PORTION_HALVES.map(halves => Markup.button.callback(
      T.portions[halves], `fl_add_${date}_${recipe.id}_${slot}_${halves}`
    )),
    [backToDay(date)]
  ]);
  return { text, extra: { parse_mode: 'HTML', ...keyboard } };
}

/**
 * Builds the editor of an existing diary entry: the portion picker with the
 * current portion marked ✅, plus "delete" and "back to diary" buttons.
 * [RU] Выбор той же порции не запрещён — просто сохранит то же значение.
 * [EN] Picking the same portion is allowed — it just saves the same value.
 *
 * @param {{id: number, date: string, portion: number, name: string,
 *   calories: number, protein: number, fat: number, carbs: number}} entry - nutrition per serving
 * @returns {{text: string, extra: object}}
 */
function buildEntryEditor(entry) {
  const current = scaleNutrition(entry, entry.portion);
  const text = [
    `<b>${entry.name}</b>`,
    fillNutrition(T.portion.perServing, entry),
    fillNutrition(T.edit.current.replace('{portion}', formatPortion(entry.portion)), current),
    '',
    T.edit.ask
  ].join('\n');
  const currentHalves = Math.round(entry.portion * 2);
  const keyboard = Markup.inlineKeyboard([
    PORTION_HALVES.map(halves => Markup.button.callback(
      halves === currentHalves ? T.edit.currentMark.replace('{portion}', T.portions[halves]) : T.portions[halves],
      `fl_port_${entry.id}_${halves}`
    )),
    [Markup.button.callback(T.buttons.deleteEntry, `fl_del_${entry.id}`), backToDay(entry.date)]
  ]);
  return { text, extra: { parse_mode: 'HTML', ...keyboard } };
}

module.exports = {
  buildPlanPicker,
  buildSearchResults,
  buildFavoritesPicker,
  buildPortionPicker,
  buildEntryEditor
};
