// [RU] Строки настройки «Готовлю на N человек»: кнопка в «⚙️ Настройки», выбор
// числа и подпись в заголовке списка покупок. Влияет только на список покупок.
// Подключаются в texts.js как `texts.household`.
// [EN] "Cooking for N people" strings: the Settings button, the picker and the
// shopping list header suffix. Affects the shopping list only.
// Mounted in texts.js as `texts.household`.
module.exports = {
  settingsBtn: '👨‍👩‍👧 Готовлю на: {n} чел.',
  prompt: 'На сколько человек вы готовите? Количества в списке покупок умножатся на это число.\n\nКалорийность, нормы КБЖУ, план и дневник остаются на одного человека.',
  option: '{n} чел.',
  selectedMark: '✅ {label}',
  saved: 'Сохранено ✅',
  savedRebuild: 'Сохранено ✅ Пересоберите список покупок, чтобы пересчитать количества.',
  invalid: 'Такой вариант недоступен.',
  backToSettings: '◀️ К настройкам',
  // [RU] Добавляется к периоду в заголовке списка, только если людей больше одного.
  // [EN] Appended to the list period label only when cooking for more than one.
  listSuffix: ' · на {n} чел.'
};
