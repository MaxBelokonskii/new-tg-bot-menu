// [RU] Строки экспорта плана и списка покупок в .txt (обычный текст, без HTML).
// Подключаются в src/bot/texts.js как texts.export.
// [EN] Strings of the plan / shopping list .txt export (plain text, no HTML),
// exposed as texts.export via src/bot/texts.js.
module.exports = {
  shoppingListBtn: '📤 Скачать .txt',
  planWeekBtn: '📤 Неделя в .txt',
  sent: 'Файл готов 📤',
  noList: 'Списка покупок пока нет — сначала соберите его.',
  // [RU] {weekIn} — предложный падеж («этой неделе»), {range} — «17–23 нояб.».
  // [EN] {weekIn} is prepositional ("этой неделе"), {range} is "17–23 нояб.".
  emptyWeek: 'На {weekIn} ({range}) в плане нет блюд — выгружать нечего.',
  staleWeek: 'Кнопка устарела — откройте план заново.',
  error: 'Не удалось подготовить файл. Попробуйте позже.',
  shoppingList: {
    // [RU] {label} — период списка: «на эту неделю, 9–15 нояб.».
    // [EN] {label} is the list period: "на эту неделю, 9–15 нояб.".
    title: '🛒 Список покупок ({label})',
    titleNoPeriod: '🛒 Список покупок',
    stale: '⚠️ Период этого списка уже прошёл.',
    item: '{mark} {name} — {qty}',
    unchecked: '☐',
    checked: '☑',
    bought: 'Куплено: {bought} из {total}'
  },
  plan: {
    // [RU] {week} — винительный падеж («эту неделю»), {range} — «17–23 нояб.».
    // [EN] {week} is accusative ("эту неделю"), {range} is "17–23 нояб.".
    title: '📅 План питания на {week}, {range}',
    dayHeader: '{day}, {date}',
    empty: '— пусто',
    dayTotal: 'Итого за день: {values}',
    weekHeader: 'Итого за неделю (дней с блюдами: {days} из 7)',
    weekTotal: 'Всего: {values}',
    weekAverage: 'В среднем в день: {values}'
  }
};
