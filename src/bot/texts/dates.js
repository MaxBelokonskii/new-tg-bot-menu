// [RU] Подписи дат: «14 нояб.», «17–23 нояб.», «29 дек. – 4 янв.».
// Подключаются в texts.js как `texts.dates`.
// [EN] Date labels: "14 Nov", "17–23 Nov", "29 Dec – 4 Jan" (in Russian).
// Mounted in texts.js as `texts.dates`.
module.exports = {
  // [RU] Индекс — номер месяца с нуля, родительный падеж.
  // [EN] Index is the zero-based month, genitive case.
  monthsShort: ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июня', 'июля', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'],
  dayMonth: '{day} {month}',
  rangeSameMonth: '{from}–{to} {month}',
  rangeTwoMonths: '{from} – {to}'
};
