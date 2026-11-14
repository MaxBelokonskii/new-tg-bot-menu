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
 * @param {string} header - group title
 * @param {Array} items
 * @returns {string} one type block: header + "• name: qty" lines
 */
function formatGroup(header, items) {
  const lines = items.map(item => `• ${item.name}: ${formatShoppingQuantity(item)}`);
  return `<b>${header}</b>\n${lines.join('\n')}\n\n`;
}

/**
 * Builds the shopping list message (with period label and grouped items).
 * A list whose period has already ended gets a "rebuild me" note.
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

  const grouped = items.reduce((acc, item) => {
    if (!acc[item.type]) acc[item.type] = [];
    acc[item.type].push(item);
    return acc;
  }, {});

  let message = `<b>${texts.shoppingList.title}</b>${suffix}\n\n`;
  if (periodEnd && today >= periodEnd) message += `${texts.shoppingList.stale}\n\n`;
  message += `${texts.shoppingList.itemsTitle}\n\n`;

  for (const type in texts.shoppingList.types) {
    if (grouped[type]) message += formatGroup(texts.shoppingList.types[type], grouped[type]);
  }
  for (const type in grouped) {
    if (!(type in texts.shoppingList.types)) message += formatGroup(`📦 ${type}`, grouped[type]);
  }

  return message;
}

/**
 * Inline keyboard for the shopping list screen: day/week generate + clear.
 * @returns {object} reply_markup payload
 */
function getShoppingListKeyboard() {
  return Markup.inlineKeyboard([
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
  formatShoppingList,
  getShoppingListKeyboard,
  buildClearShoppingConfirmKeyboard
};
