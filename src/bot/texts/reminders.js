// [RU] Строки напоминаний: экран настроек «🔔 Напоминания» и сами сообщения
// (утро / вечер / раз в неделю). Подключаются в texts.js как `texts.reminders`.
// [EN] Reminder strings: the "🔔 Reminders" settings screen and the reminder
// messages (morning / evening / weekly). Mounted in texts.js as `texts.reminders`.
module.exports = {
  openBtn: '🔔 Напоминания',
  title: '🔔 <b>Напоминания</b>',
  zoneLine: '🌍 Часовой пояс: {zone}',
  intro: 'Включите нужные напоминания — бот пришлёт их в выбранное время по вашему часовому поясу.',
  types: {
    morning: '🌅 Утром — план на день',
    evening: '🌙 Вечером — дневник питания',
    weekly: '🗓 Раз в неделю — план и покупки'
  },
  // Короткие подписи для кнопок-переключателей
  short: {
    morning: '🌅 Утро',
    evening: '🌙 Вечер',
    weekly: '🗓 Неделя'
  },
  stateLine: '{label}: {state}',
  on: '✅ {when}',
  off: '❌ выкл ({when})',
  weeklyWhen: '{day}, {time}',
  toggleOn: '{label}: вкл ✅',
  toggleOff: '{label}: выкл',
  timeBtn: '🕗 {when}',
  zoneBtn: '🌍 {zone}',
  backBtn: '◀️ Назад',
  toBackBtn: '◀️ К напоминаниям',
  toasts: {
    enabled: 'Напоминание включено 🔔',
    disabled: 'Напоминание выключено 🔕',
    timeSaved: 'Время сохранено ✅',
    daySaved: 'День недели сохранён ✅',
    invalid: 'Такой вариант недоступен.'
  },
  timePrompt: {
    morning: 'Во сколько присылать утренний план на день?',
    evening: 'Во сколько напоминать про дневник питания?',
    weekly: 'В какой день и во сколько напоминать собрать план на неделю и список покупок?'
  },
  dayHeader: '<b>День недели:</b> {day}',
  timeHeader: '<b>Время:</b> {time}',
  selectedMark: '✅ {label}',
  messages: {
    morningTitle: '🌅 <b>Доброе утро!</b> План на сегодня, {date}:',
    morningEmpty: '🌅 <b>Доброе утро!</b> На сегодня, {date}, в плане пока пусто.\nВыберите блюда или соберите план на всю неделю.',
    morningTotal: 'Итого: {kcal} ккал',
    morningTotalTarget: 'Итого: {kcal} из {target} ккал',
    eveningTitle: '🌙 <b>Как прошёл день?</b> Отметьте в дневнике, что съели сегодня.',
    eveningEmpty: 'В дневнике за сегодня пока пусто.',
    eaten: 'Съедено: {values}',
    target: 'Норма: {values}',
    remaining: 'Осталось: {values}',
    over: '⚠️ Норма калорий превышена на {kcal} ккал.',
    noTargets: '<i>Заполните анкету в «⚙️ Настройки», чтобы видеть, сколько осталось до нормы.</i>',
    weeklyTitle: '🗓 <b>Пора спланировать неделю!</b>',
    weeklyBody: 'Соберите план питания на неделю, а потом — список покупок под него.'
  },
  buttons: {
    pickDishes: '🎲 Выбрать блюда',
    generateWeek: '🗓 Собрать план на неделю',
    openPlan: '📅 Открыть план',
    diary: '📝 Дневник',
    whatToEat: '🤔 Что ещё съесть?',
    shoppingWeek: '🛒 Список покупок на неделю'
  }
};
