// [RU] Строки экрана «📅 План на неделю» (вынесены из texts.js из-за лимита
// 300 строк). Подключаются в texts.js как `texts.weeklyPlan`.
// [EN] Weekly-plan screen strings (split out of texts.js due to the 300-line
// limit). Mounted in texts.js as `texts.weeklyPlan`.
module.exports = {
  title: '📅 План на неделю',
  generate: '🎲 Сгенерировать новый план',
  view: '👀 Посмотреть текущий план',
  empty: 'План на эту неделю еще не составлен.',
  clearDay: '🗑️ Очистить день',
  cleared: 'План на {date} очищен! ✨',
  errorClear: 'Ошибка при очистке плана.',
  confirmClear: '🗑️ Очистить план на {date}?\nЭто действие нельзя отменить.',
  generating: 'Собираю план на неделю… 🎲',
  generated: 'Готово! План на неделю собран. ✨',
  errorGenerate: 'Не удалось собрать план. Попробуйте позже.',
  noRecipesForCategory: 'В категории «{category}» нет подходящих рецептов — уберите что-нибудь из исключённых продуктов (⚙️ Настройки → 🚫 Исключённые продукты).',
  confirmRegenerate: 'На этой неделе уже запланировано блюд: {count}.\nПерезаписать весь план или заполнить только пустые приёмы пищи?',
  overwriteBtn: '🔄 Перезаписать всё',
  fillEmptyBtn: '➕ Заполнить пустые',
  nothingToFill: 'Все приёмы пищи на неделе уже заполнены — заполнять нечего.',
  // [RU] Индекс — смещение от понедельника (ISO-неделя: 0 = Пн … 6 = Вс).
  // [EN] Index is the offset from Monday (ISO week: 0 = Mon … 6 = Sun).
  days: ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'],
  daysShort: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
  shortDate: '{day} {date}',
  day: {
    header: '<b>{day}, {date}</b>{today}',
    todayMark: ' · сегодня',
    empty: 'На этот день блюд нет.',
    item: '{slot}: {name} — {kcal} ккал',
    totalsHeader: '<b>Итого за день</b>',
    plannedOnly: '{kcal} ккал · Б {protein} г · Ж {fat} г · У {carbs} г',
    noProfileHint: '<i>Заполните анкету в «⚙️ Настройки», чтобы сравнивать план с нормой КБЖУ.</i>',
    nutrientLine: '{label}: {value} / {target} {unit} · {percent}%',
    weekHeader: '<b>За неделю</b> · дней с блюдами: {days} из 7',
    weekTotal: 'Всего: {values}',
    weekAverage: 'В среднем в день: {values}',
    nutrientShort: { calories: '{value} ккал', protein: 'Б {value} г', fat: 'Ж {value} г', carbs: 'У {value} г' },
    percentOfTarget: ' ({percent}%)',
    units: { calories: 'ккал', protein: 'г', fat: 'г', carbs: 'г' },
    prevBtn: '◀️ {day}',
    nextBtn: '{day} ▶️',
    menuBtn: '⬅️ К меню плана'
  }
};
