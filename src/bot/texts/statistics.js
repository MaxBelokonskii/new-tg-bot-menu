// [RU] Строки экрана «📊 Статистика» (недельная сводка дневника питания).
// Подключается в texts.js как `texts.statistics`; в коде — только через texts.js.
// [EN] "📊 Statistics" screen strings (weekly food-diary summary).
// Mounted in texts.js as `texts.statistics`; use only through texts.js.
module.exports = {
  openBtn: '📊 Статистика',
  title: '📊 <b>Статистика: {week}</b>',
  // [RU] Подпись недели в заголовке: текущая, прошлая или просто диапазон дат.
  // [EN] Week label in the title: current, previous or just the date range.
  week: {
    current: 'эта неделя, {range}',
    previous: 'прошлая неделя, {range}',
    other: '{range}'
  },
  empty: 'За эту неделю в дневнике нет записей.',
  daysHeader: '<b>По дням</b>',
  dayLine: '{day} {date} — {value}',
  dayKcal: '{kcal} ккал',
  dayBar: '{kcal} ккал · {bar}',
  dayEmpty: '—',
  dayFuture: '·',
  summaryHeader: '<b>Итого</b> · дней с записями: {days} из 7',
  average: 'В среднем в день: {values}',
  sharesHeader: '<b>Баланс БЖУ</b> (доля калорий)',
  sharesFact: 'Факт: {values}',
  sharesTarget: 'Норма: {values}',
  shares: 'Б {protein}% · Ж {fat}% · У {carbs}%',
  planHeader: '<b>План и факт</b> · дней с планом: {days}',
  planLine: 'По плану: {planned} ккал · съедено: {eaten} ккал',
  planDiff: '{sign}{value} ккал к плану',
  planExact: 'Ровно по плану',
  minus: '−',
  plus: '+',
  varietyHeader: '<b>Разнообразие за 30 дней</b>',
  varietyDistinct: 'Разных блюд: {count}',
  varietyTop: 'Чаще всего:',
  varietyItem: '{n}. {name} ×{count}',
  outOfRange: 'Эта неделя недоступна — показываю текущую.',
  buttons: {
    prev: '◀️ Пред. неделя',
    next: 'След. неделя ▶️',
    back: '◀️ К дневнику'
  }
};
