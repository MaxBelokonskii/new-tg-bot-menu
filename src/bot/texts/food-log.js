// [RU] Строки дневника питания (раздел вынесен из texts.js из-за лимита 300 строк).
// Подключается в texts.js как `texts.foodLog`; в коде — только через texts.js.
// [EN] Food-diary strings (split out of texts.js due to the 300-line limit).
// Mounted in texts.js as `texts.foodLog`; use only through texts.js.
module.exports = {
  title: '📝 <b>Дневник питания</b> — {day}',
  dayToday: 'сегодня, {date}',
  dayYesterday: 'вчера, {date}',
  empty: 'Пока ничего не отмечено. Добавьте блюдо кнопками ниже.',
  entry: '{n}. {name}{portion} — {kcal} ккал · Б {protein} · Ж {fat} · У {carbs}',
  portionSuffix: ' ×{portion}',
  totalsHeader: '<b>Итого за день</b>',
  eatenOnly: 'Съедено: {kcal} ккал · Б {protein} г · Ж {fat} г · У {carbs} г',
  noProfileHint: '<i>Заполните анкету в «⚙️ Настройки», чтобы видеть норму и остаток КБЖУ.</i>',
  nutrientLine: '{label}: {eaten} / {target} {unit} · {rest}',
  left: 'осталось {value}',
  over: 'сверх нормы +{value}',
  nutrients: {
    calories: 'Калории',
    protein: 'Белки',
    fat: 'Жиры',
    carbs: 'Углеводы'
  },
  units: {
    calories: 'ккал',
    protein: 'г',
    fat: 'г',
    carbs: 'г'
  },
  portions: { 1: '½', 2: '1', 3: '1½', 4: '2' },
  buttons: {
    fromPlanToday: '➕ Из плана на сегодня',
    fromPlanDay: '➕ Из плана на этот день',
    search: '🔍 Найти рецепт',
    entry: '✏️ {n}. {name}',
    deleteEntry: '🗑 Удалить',
    prevYesterday: '◀️ Вчера',
    prevDate: '◀️ {date}',
    nextToday: 'Сегодня ▶️',
    nextDate: '{date} ▶️',
    backToDay: '◀️ К дневнику',
    searchAgain: '🔍 Искать ещё'
  },
  ateBtn: '🍽 Съел',
  plan: {
    title: 'Что из плана на {day} вы съели? Отмеченные ✅ уже есть в дневнике.',
    loggedMark: '✅ ',
    item: '{slot}: {name}',
    empty: 'В плане на этот день нет блюд — найдите рецепт поиском.'
  },
  portion: {
    perServing: 'На 1 порцию: {kcal} ккал · Б {protein} · Ж {fat} · У {carbs}',
    ask: 'Сколько порций съели?'
  },
  edit: {
    current: 'Сейчас в дневнике: {portion} порц. — {kcal} ккал',
    ask: 'Выберите новую порцию или удалите запись:',
    currentMark: '✅ {portion}'
  },
  search: {
    ask: 'Введите часть названия блюда (например, «омлет» или «салат»).\nОтправьте /cancel для отмены.',
    tooShort: 'Нужно хотя бы 2 буквы. Попробуйте ещё раз или отправьте /cancel.',
    useText: 'Пришлите часть названия текстом или отправьте /cancel.',
    notFound: 'По запросу «{query}» ничего не нашлось. Попробуйте другое слово или отправьте /cancel.',
    results: '🔍 Нашлось: {count}. Выберите блюдо:',
    moreHint: '<i>Показаны первые {limit} — уточните запрос, если нужного нет.</i>',
    canceled: 'Поиск рецепта отменён.'
  },
  added: 'Записано в дневник ✅',
  deleted: 'Запись удалена ✨',
  portionUpdated: 'Порция изменена ✅',
  entryOutOfRange: 'Запись старше 7 дней — её уже нельзя изменить.',
  entryNotFound: 'Запись не найдена — возможно, уже удалена.',
  recipeNotFound: 'Рецепт не найден.',
  dateOutOfRange: 'Дневник доступен за последние 7 дней — показываю сегодня.',
  errorSave: 'Не удалось сохранить запись. Попробуйте позже.'
};
