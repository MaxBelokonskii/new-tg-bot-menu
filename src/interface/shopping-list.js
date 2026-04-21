const { Markup } = require('telegraf');
const texts = require('../bot/texts');

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
 * Builds the shopping list message (with period label and grouped items).
 * @param {{ items: Array, periodStart: string|null, periodEnd: string|null }} list
 * @returns {string}
 */
function formatShoppingList(list) {
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
  message += `${texts.shoppingList.itemsTitle}\n\n`;

  const handledTypes = new Set();
  for (const type in texts.shoppingList.types) {
    if (grouped[type]) {
      message += `<b>${texts.shoppingList.types[type]}</b>\n`;
      grouped[type].forEach(item => {
        // [RU] Если amount = 0, значит несколько единиц слиты в unit (см. saveShoppingList).
        // [EN] amount = 0 signals "unit already contains full breakdown" (see saveShoppingList).
        const qty = item.total_amount > 0 ? `${item.total_amount} ${item.unit}` : item.unit;
        message += `• ${item.name}: ${qty}\n`;
      });
      message += '\n';
      handledTypes.add(type);
    }
  }

  for (const type in grouped) {
    if (!handledTypes.has(type)) {
      message += `<b>📦 ${type}</b>\n`;
      grouped[type].forEach(item => {
        const qty = item.total_amount > 0 ? `${item.total_amount} ${item.unit}` : item.unit;
        message += `• ${item.name}: ${qty}\n`;
      });
      message += '\n';
    }
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
