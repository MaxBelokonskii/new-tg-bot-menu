const { Markup } = require('telegraf');
const texts = require('../bot/texts');
const { formatShoppingQuantity } = require('../utils/formatters');
const { formatLocalDate } = require('../utils/date-helpers');

/**
 * Derives 'day' or 'week' mode from the shopping list period bounds.
 * @param {string|null} periodStart YYYY-MM-DD
 * @param {string|null} periodEnd   YYYY-MM-DD (exclusive)
 * @returns {'day'|'week'|null}
 */
function deriveMode(periodStart, periodEnd) {
  if (!periodStart || !periodEnd) return null;
  // [RU] Разница ровно в 1 день ⇒ режим «сегодня», иначе считаем «неделей».
  // [EN] 1-day span means the user picked the daily mode.
  const start = new Date(periodStart);
  const end = new Date(periodEnd);
  const diffDays = Math.round((end - start) / (1000 * 60 * 60 * 24));
  // [RU] Строгое равенство: 0/отрицательные разницы — повреждённые данные, не маскируем их как «день».
  // [EN] Strict equality: 0/negative spans indicate corrupted data — do not silently label them 'day'.
  return diffDays === 1 ? 'day' : 'week';
}

/**
 * Groups list items by ingredient type in display order: the known types in
 * the order of texts.shoppingList.types, then unknown ones; items inside a
 * group are sorted by name. The text list and the checklist share this order.
 * @param {Array<{name: string, type: string}>} items
 * @returns {Array<{header: string, items: Array}>}
 */
function groupItemsByType(items) {
  const grouped = new Map();
  for (const item of items) {
    if (!grouped.has(item.type)) grouped.set(item.type, []);
    grouped.get(item.type).push(item);
  }
  const known = Object.keys(texts.shoppingList.types).filter(type => grouped.has(type));
  const unknown = [...grouped.keys()].filter(type => !(type in texts.shoppingList.types));
  return [...known, ...unknown].map(type => ({
    header: texts.shoppingList.types[type] || `📦 ${type}`,
    items: grouped.get(type).sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  }));
}

/**
 * Flattens list items into the display order of groupItemsByType.
 * @param {Array} items
 * @returns {Array}
 */
function orderItems(items) {
  return groupItemsByType(items).flatMap(group => group.items);
}

/**
 * Counter line: "Куплено: N из M", "Всё куплено" or '' when nothing is bought.
 * @param {Array<{is_bought: boolean}>} items
 * @returns {string}
 */
function formatBoughtCounter(items) {
  const bought = items.filter(item => item.is_bought).length;
  if (bought === 0) return '';
  if (bought === items.length) return texts.shoppingList.allBought;
  return texts.shoppingList.boughtCounter
    .replace('{bought}', bought)
    .replace('{total}', items.length);
}

/**
 * @param {string} header - group title
 * @param {Array} items
 * @returns {string} one type block: header + "• name: qty" lines, bought ones struck through
 */
function formatGroup(header, items) {
  const lines = items.map((item) => {
    const line = `${item.name}: ${formatShoppingQuantity(item)}`;
    return `• ${item.is_bought ? `<s>${line}</s>` : line}`;
  });
  return `<b>${header}</b>\n${lines.join('\n')}\n\n`;
}

/**
 * Builds the shopping list message (with period label and grouped items).
 * A list whose period has already ended gets a "rebuild me" note; bought
 * items are struck through and counted.
 * @param {{ items: Array, periodStart: string|null, periodEnd: string|null }} list
 * @param {string} [today] - YYYY-MM-DD local date, injectable for tests
 * @returns {string}
 */
function formatShoppingList(list, today = formatLocalDate(new Date())) {
  const { items, periodStart, periodEnd } = list;
  if (!items || items.length === 0) {
    return texts.shoppingList.empty;
  }

  const mode = deriveMode(periodStart, periodEnd);
  const suffix = mode ? ` (${texts.shoppingList.periodLabel[mode]})` : '';

  let message = `<b>${texts.shoppingList.title}</b>${suffix}\n\n`;
  if (periodEnd && today >= periodEnd) message += `${texts.shoppingList.stale}\n\n`;
  const counter = formatBoughtCounter(items);
  if (counter) message += `${counter}\n\n`;
  message += `${texts.shoppingList.itemsTitle}\n\n`;

  for (const group of groupItemsByType(items)) {
    message += formatGroup(group.header, group.items);
  }

  return message;
}

/**
 * Inline keyboard for the shopping list screen: checklist (when there is a
 * list), day/week generate, clear.
 * @param {number|null} [listId] - current list id; no checklist button without it
 * @returns {object} reply_markup payload
 */
function getShoppingListKeyboard(listId = null) {
  const checklistRow = listId
    ? [[Markup.button.callback(texts.shoppingList.checklist.openBtn, `sl_check_${listId}_0`)]]
    : [];
  return Markup.inlineKeyboard([
    ...checklistRow,
    [
      Markup.button.callback(texts.shoppingList.generateDay, 'generate_shopping_list_day'),
      Markup.button.callback(texts.shoppingList.generateWeek, 'generate_shopping_list_week')
    ],
    [Markup.button.callback(texts.shoppingList.clear, 'confirm_clear_shopping')]
  ]);
}

/**
 * Builds the Yes/No keyboard for the "clear shopping list" confirmation dialog.
 * @returns {object} reply_markup payload
 */
function buildClearShoppingConfirmKeyboard() {
  return {
    inline_keyboard: [[
      { text: texts.confirm.yes, callback_data: 'do_clear_shopping' },
      { text: texts.confirm.no, callback_data: 'cancel_clear_shopping' }
    ]]
  };
}

module.exports = {
  deriveMode,
  groupItemsByType,
  orderItems,
  formatBoughtCounter,
  formatShoppingList,
  getShoppingListKeyboard,
  buildClearShoppingConfirmKeyboard
};
