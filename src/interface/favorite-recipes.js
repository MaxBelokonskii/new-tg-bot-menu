const { Markup } = require('telegraf');
const texts = require('../bot/texts');
const { truncate } = require('./food-log');

const T = texts.favoriteRecipes;
const TOGGLE_PATTERN = /^fav_(add|rm)_(\d+)$/;

/**
 * Builds the "⭐ add to / remove from favorites" button for a recipe card.
 * @param {number} recipeId
 * @param {boolean} favorite - current state (true → the button removes)
 * @returns {object} inline keyboard button
 */
function favoriteButton(recipeId, favorite) {
  return favorite
    ? Markup.button.callback(T.removeBtn, `fav_rm_${recipeId}`)
    : Markup.button.callback(T.addBtn, `fav_add_${recipeId}`);
}

/**
 * Returns a copy of a card's inline keyboard with the recipe's favorite
 * button switched to the new state; every other button stays as is.
 * [RU] Карточки бывают разные (рандом, обратный поиск, из избранного), а
 * рандомную нельзя пересобрать — тот же рецепт не выпадет снова. Поэтому
 * меняем только кнопку в клавиатуре, пришедшей с сообщением.
 * [EN] Cards differ (random dish, reverse search, from favorites) and a random
 * card cannot be rebuilt — the same recipe would not come up again. So only
 * the button in the keyboard that came with the message is swapped.
 *
 * @param {{inline_keyboard?: Array<Array<{text: string, callback_data?: string}>>}|undefined} markup
 * @param {number} recipeId
 * @param {boolean} favorite - new state
 * @returns {{inline_keyboard: Array<Array<object>>}|null} null when the card has no such button
 */
function flipFavoriteButton(markup, recipeId, favorite) {
  const rows = markup && markup.inline_keyboard;
  if (!Array.isArray(rows)) return null;
  let found = false;
  const inlineKeyboard = rows.map(row => row.map(button => {
    const match = TOGGLE_PATTERN.exec(button.callback_data || '');
    if (!match || Number(match[2]) !== recipeId) return button;
    found = true;
    const { text, callback_data: data } = favoriteButton(recipeId, favorite);
    return { text, callback_data: data };
  }));
  return found ? { inline_keyboard: inlineKeyboard } : null;
}

/**
 * Builds the ◀️ / ▶️ paging row (empty on a single page).
 * @param {number} page - zero-based
 * @param {number} pages
 * @param {(page: number) => string} toCallback - callback_data of a page
 * @returns {Array<object>}
 */
function buildPageRow(page, pages, toCallback) {
  const row = [];
  if (page > 0) row.push(Markup.button.callback(T.prevPage, toCallback(page - 1)));
  if (page < pages - 1) row.push(Markup.button.callback(T.nextPage, toCallback(page + 1)));
  return row;
}

/**
 * Builds a "name · kcal" button for a recipe list.
 * @param {{name: string, calories: number}} recipe
 * @param {string} callback
 * @returns {object}
 */
function recipeButton(recipe, callback) {
  const label = T.item.replace('{name}', truncate(recipe.name)).replace('{kcal}', Math.round(recipe.calories));
  return Markup.button.callback(label, callback);
}

/**
 * Builds the favorites list screen opened from the category picker: one
 * button per recipe (opens its card), paging and "back to categories".
 * Empty favorites → a hint how to add recipes.
 *
 * @param {{recipes: Array<{id: number, name: string, calories: number}>,
 *   page: number, pages: number, total: number}} list
 * @returns {{text: string, extra: object}}
 */
function buildFavoritesList({ recipes, page, pages, total }) {
  const back = [Markup.button.callback(T.backToCategories, 'back_to_categories')];
  if (total === 0) {
    return { text: T.empty, extra: { parse_mode: 'HTML', ...Markup.inlineKeyboard([back]) } };
  }
  const lines = [T.title.replace('{count}', total)];
  if (pages > 1) lines.push(T.pageInfo.replace('{page}', page + 1).replace('{pages}', pages));
  lines.push('', T.chooseHint);
  const rows = recipes.map(recipe => [recipeButton(recipe, `fav_open_${recipe.id}_${page}`)]);
  const pageRow = buildPageRow(page, pages, p => `fav_list_${p}`);
  if (pageRow.length) rows.push(pageRow);
  rows.push(back);
  return { text: lines.join('\n'), extra: { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) } };
}

module.exports = {
  favoriteButton,
  flipFavoriteButton,
  buildPageRow,
  recipeButton,
  buildFavoritesList
};
