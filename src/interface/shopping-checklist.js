const texts = require('../bot/texts');
const { formatShoppingQuantity } = require('../utils/formatters');
const { orderItems, formatBoughtCounter, deriveMode } = require('./shopping-list');

const T = texts.shoppingList.checklist;

// [RU] Продуктов на странице чек-листа: 10 кнопок + навигация, сброс и «назад»
// укладываются в ~13 строк клавиатуры.
// [EN] Items per checklist page: 10 buttons + nav, reset and back rows fit ~13 keyboard rows.
const PAGE_SIZE = 10;

/**
 * Clamps a requested page to the available range.
 * @param {number} page
 * @param {number} itemCount
 * @returns {{page: number, pages: number}}
 */
function clampPage(page, itemCount) {
  const pages = Math.max(1, Math.ceil(itemCount / PAGE_SIZE));
  const safe = Number.isInteger(page) ? page : 0;
  return { page: Math.min(Math.max(safe, 0), pages - 1), pages };
}

/**
 * Item button label: "⬜ Молоко — 1 л" / "✅ Молоко — 1 л".
 * @param {{name: string, is_bought: boolean}} item
 * @returns {string}
 */
function itemLabel(item) {
  return T.item
    .replace('{mark}', item.is_bought ? T.checked : T.unchecked)
    .replace('{name}', item.name)
    .replace('{qty}', formatShoppingQuantity(item));
}

/**
 * Builds the checklist screen: one toggle button per item of the page, page
 * navigation, "clear all marks" (when something is bought) and "back to list".
 *
 * [RU] В callback_data зашит id списка: кнопка старого (пересобранного)
 * списка распознаётся хэндлером как устаревшая и ничего не меняет.
 * [EN] callback_data carries the list id so a button of an old (rebuilt)
 * list is recognised as stale by the handler and changes nothing.
 *
 * @param {{ listId: number, items: Array, periodStart: string|null, periodEnd: string|null }} list
 * @param {number} requestedPage - 0-based
 * @returns {{text: string, extra: object}} message text and editMessageText options
 */
function buildChecklistScreen(list, requestedPage) {
  const { listId, items } = list;
  const ordered = orderItems(items);
  const { page, pages } = clampPage(requestedPage, ordered.length);
  const pageItems = ordered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const mode = deriveMode(list.periodStart, list.periodEnd);
  const suffix = mode ? ` (${texts.shoppingList.periodLabel[mode]})` : '';
  const lines = [`${T.title}${suffix}`, '', T.hint];
  const counter = formatBoughtCounter(items);
  if (counter) lines.push(counter);
  if (pages > 1) lines.push(T.page.replace('{page}', page + 1).replace('{pages}', pages));

  const rows = pageItems.map(item => [{
    text: itemLabel(item),
    callback_data: `sl_tgl_${listId}_${item.ingredientId}_${page}`
  }]);
  const nav = [];
  if (page > 0) nav.push({ text: T.prevBtn, callback_data: `sl_check_${listId}_${page - 1}` });
  if (page < pages - 1) nav.push({ text: T.nextBtn, callback_data: `sl_check_${listId}_${page + 1}` });
  if (nav.length > 0) rows.push(nav);
  if (items.some(item => item.is_bought)) {
    rows.push([{ text: T.resetBtn, callback_data: `sl_reset_${listId}_${page}` }]);
  }
  rows.push([{ text: T.backBtn, callback_data: 'sl_list' }]);

  return {
    text: lines.join('\n'),
    extra: { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } }
  };
}

module.exports = { PAGE_SIZE, clampPage, buildChecklistScreen };
