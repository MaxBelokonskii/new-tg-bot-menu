// [RU] Строки часового пояса: кнопка в «⚙️ Настройки», выбор пояса и подписи
// городов. Пояс общий для всего бота (сегодня, неделя, напоминания).
// Подключаются в texts.js как `texts.timeZone`.
// [EN] Time zone strings: the Settings button, the zone picker and city
// labels. The zone applies to the whole bot (today, week, reminders).
// Mounted in texts.js as `texts.timeZone`.
module.exports = {
  settingsBtn: '🌍 Часовой пояс: {zone}',
  prompt: 'Выберите часовой пояс — по нему бот считает «сегодня», неделю плана, дневник и время напоминаний.',
  selectedMark: '✅ {label}',
  saved: 'Часовой пояс сохранён ✅',
  invalid: 'Такой вариант недоступен.',
  backToSettings: '◀️ К настройкам',
  backToReminders: '◀️ К напоминаниям',
  label: '{city} (UTC+{hours})',
  short: '{city} +{hours}',
  // [RU] Российские/СНГ пояса без перехода на летнее время: смещение от UTC в минутах → город.
  // [EN] Russian/CIS zones without DST: UTC offset in minutes → city.
  zones: {
    120: 'Калининград',
    180: 'Москва',
    240: 'Самара',
    300: 'Екатеринбург',
    360: 'Омск',
    420: 'Новосибирск / Красноярск',
    480: 'Иркутск',
    540: 'Якутск',
    600: 'Владивосток',
    660: 'Магадан',
    720: 'Камчатка'
  }
};
