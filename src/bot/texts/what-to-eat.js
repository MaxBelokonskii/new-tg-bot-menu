// [RU] Строки экрана «🤔 Что ещё съесть?» (Stage 3.5). Подключаются в
// src/bot/texts.js как texts.whatToEat.
// [EN] Strings of the "what else to eat" screen (Stage 3.5), exposed as
// texts.whatToEat via src/bot/texts.js.
module.exports = {
  openBtn: '🤔 Что ещё съесть?',
  title: '🤔 <b>Что ещё съесть сегодня</b>',
  remaining: 'Осталось до нормы: {kcal} ккал · Б {protein} · Ж {fat} · У {carbs}',
  singlesHeader: '<b>🍽 На ближайший приём пищи</b>',
  combosHeader: '<b>🍱 Чтобы закрыть остаток дня</b>',
  option: '{n}. {name} — {kcal} ккал · Б {protein} · Ж {fat} · У {carbs}',
  comboJoin: ' + ',
  after: '    <i>останется: {kcal} ккал · Б {protein} · Ж {fat} · У {carbs}</i>',
  favoriteMark: ' ❤️',
  hint: '<i>Порции подобраны под остаток. «В план» добавляет блюдо в план на сегодня (без порции).</i>',
  done: '✅ Норма на сегодня почти выполнена: осталось меньше {kcal} ккал. Больше ничего не нужно 🙂',
  over: '⚠️ Норма калорий на сегодня уже превышена на {kcal} ккал — новые блюда не предлагаю.',
  noTargets: 'Заполните анкету в «⚙️ Настройки»: без нормы КБЖУ не из чего считать остаток.',
  noCandidates: 'Подходящих блюд не нашлось — возможно, все рецепты содержат исключённые продукты.',
  buttons: {
    eat: '🍽 Съел {n}',
    plan: '➕ В план {n}',
    more: '🔄 Другие варианты',
    back: '◀️ К дневнику'
  },
  eaten: 'Записано в дневник ✅',
  comboEaten: 'Записано в дневник блюд: {count} ✅',
  comboPlanned: 'Добавлено в план на сегодня блюд: {count} ✅',
  errorSave: 'Не удалось сохранить. Попробуйте позже.'
};
