// [RU] Строки экранов «🚫 Исключённые / ❤️ Любимые продукты» (Stage 3.2).
// Подключаются в src/bot/texts.js как texts.ingredientPrefs.
// [EN] Strings for the excluded / favorite products screens (Stage 3.2),
// exposed as texts.ingredientPrefs via src/bot/texts.js.
module.exports = {
  listBtn: {
    excluded: '🚫 Исключённые продукты',
    favorite: '❤️ Любимые продукты'
  },
  favoriteBadge: '❤️',
  title: {
    excluded: '🚫 <b>Исключённые продукты</b>',
    favorite: '❤️ <b>Любимые продукты</b>'
  },
  explain: {
    excluded: 'Рецепты с этими продуктами бот не предлагает: ни в выборе блюда, ни при генерации недели, ни в поиске «что приготовить».',
    favorite: 'Рецепты с этими продуктами бот предлагает чаще.'
  },
  empty: 'Список пока пуст.',
  removeHint: 'Нажмите на продукт, чтобы убрать его из списка.',
  addBtn: '➕ Добавить',
  removePrefix: '✖️',
  backBtn: '◀️ Назад',
  askAdd: {
    excluded: 'Напишите продукты, которые нужно исключить, через запятую.\nНапример: <i>грибы, креветки, молоко</i>\n\n/cancel — отмена',
    favorite: 'Напишите любимые продукты через запятую.\nНапример: <i>куриное филе, авокадо, творог</i>\n\n/cancel — отмена'
  },
  cancelBtn: '↩️ Отмена',
  canceled: 'Добавление отменено.',
  invalidInput: 'Пришлите продукты текстом через запятую или нажмите «↩️ Отмена».',
  nothingRecognized: 'Не удалось распознать ни одного продукта. Попробуйте другие названия или нажмите «↩️ Отмена».',
  result: {
    added: '✅ Добавлено: {list}',
    moved: {
      excluded: '🔄 Убрано из любимых и исключено: {list}',
      favorite: '🔄 Убрано из исключённых и добавлено в любимые: {list}'
    },
    already: 'Уже в списке: {list}',
    unknown: '❓ Не распознано: {list}',
    suggestion: '«{token}» (может быть, {list}?)'
  },
  removed: 'Убрано из списка.',
  notFound: 'Этого продукта уже нет в списке.',
  errorSave: 'Не удалось сохранить список. Попробуйте позже.'
};
