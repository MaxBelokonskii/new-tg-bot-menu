const { Markup } = require('telegraf');
const texts = require('../bot/texts');

/**
 * Генерирует сообщение со списком покупок
 * @param {Array} items - Список ингредиентов
 * @returns {string} Форматированный текст
 */
function formatShoppingList(items) {
  if (!items || items.length === 0) {
    return texts.shoppingList.empty;
  }

  // Группировка по типу
  const grouped = items.reduce((acc, item) => {
    if (!acc[item.type]) acc[item.type] = [];
    acc[item.type].push(item);
    return acc;
  }, {});

  let message = `<b>${texts.shoppingList.title}</b>\n\n`;
  message += `${texts.shoppingList.itemsTitle}\n\n`;

  // Сначала выводим категории, которые есть в texts.shoppingList.types
  const handledTypes = new Set();
  for (const type in texts.shoppingList.types) {
    if (grouped[type]) {
      message += `<b>${texts.shoppingList.types[type]}</b>\n`;
      grouped[type].forEach(item => {
        message += `• ${item.name}: ${item.total_amount} ${item.unit}\n`;
      });
      message += '\n';
      handledTypes.add(type);
    }
  }

  // Затем выводим все остальные категории, если они вдруг появились в БД
  for (const type in grouped) {
    if (!handledTypes.has(type)) {
      message += `<b>📦 ${type}</b>\n`;
      grouped[type].forEach(item => {
        message += `• ${item.name}: ${item.total_amount} ${item.unit}\n`;
      });
      message += '\n';
    }
  }

  return message;
}

/**
 * Клавиатура для управления списком покупок
 * @returns {object} Inline keyboard markup
 */
function getShoppingListKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback(texts.shoppingList.generate, 'generate_shopping_list')],
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
