// [RU] Строки избранных рецептов (⭐). Не путать с любимыми продуктами (❤️,
// texts.ingredientPrefs). Подключается в texts.js как `texts.favoriteRecipes`.
// [EN] Favorite-recipe strings (⭐). Not to be confused with favorite products
// (❤️, texts.ingredientPrefs). Mounted in texts.js as `texts.favoriteRecipes`.
module.exports = {
  addBtn: '⭐ В избранное',
  removeBtn: '⭐ Убрать из избранного',
  added: 'Рецепт добавлен в избранное ⭐',
  removed: 'Рецепт убран из избранного',
  recipeNotFound: 'Рецепт не найден.',
  errorSave: 'Не удалось обновить избранное. Попробуйте позже.',
  openBtn: '⭐ Избранное',
  title: '⭐ <b>Избранные рецепты</b> ({count})',
  pageInfo: 'Страница {page} из {pages}.',
  chooseHint: 'Выберите рецепт, чтобы открыть карточку:',
  empty:
    '⭐ <b>Избранные рецепты</b>\n\n' +
    'Здесь пока пусто. Откройте любой рецепт и нажмите «⭐ В избранное» под карточкой — ' +
    'он появится в этом списке.',
  item: '{name} · {kcal} ккал',
  prevPage: '◀️',
  nextPage: '▶️',
  backToCategories: '◀️ К категориям',
  backToList: '◀️ К избранному'
};
