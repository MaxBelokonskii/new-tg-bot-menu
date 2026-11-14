# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Продуктовое видение

Бот собирает рацион питания в Telegram и превращает его в список покупок. Ядро — две сущности: **рацион** (на «сегодня» или на неделю, оба редактируемые поприёмно) и **коллекция рецептов** (117 рецептов в 4 категориях, загружены в SQLite из `database/recipes.json`). На эти сущности надстраиваются: список покупок, персонализация (анкета + целевая калорийность), обратный поиск «что приготовить из моих продуктов» и подписочные тарифы (последние два — поздние этапы).

**Полный roadmap со стадиями готовности, приоритетами и известными проблемами — в `/.claude/plans/product-roadmap.md`.** Сверяйтесь с ним перед любыми новыми фичами; при изменении статуса фичи обновляйте этот файл.

## Статус функциональности (короткая версия)

✅ работает, 🟡 частично, 🔴 не реализовано. Подробности — в roadmap (раздел 2).

- ✅ Рандом блюда по категории → карточка рецепта → добавление в рацион на сегодня (`interface/dish-selection.js`, `handlers/dish-selection.js`, `features/weekly-planner/logic.js:saveSelectedDish`). `slot` вычисляется из категории (`breakfast`→1, `main`→2/3, `salads`→4, `desserts`→5). Запись идёт через `features/weekly-planner/day-plan.js:placeDishToday` (проверка `checkDishPlacement` + `saveSelectedDish` в одной транзакции): свободный слот → `saveSelectedDish`; рецепт уже в плане → «уже в плане»; все слоты категории заняты → вопрос «Заменить «X» на «Y»?» (`dish_swap_<date>_<slot>_<id>` → `replaceInSlot`, `dish_keep`; для основного — кнопка на каждый слот; вопрос со вчерашней датой не применяется). После добавления — сводка плана на сегодня (`buildTodaySummary`). Карточки рецептов показывают «КБЖУ на порцию» и «Ингредиенты (на N порций)» (`utils/formatters.js:formatIngredientsHeader`) — количества в карточке на всё блюдо.
- ✅ Просмотр текущего рациона: один день текущей ISO-недели на экран (`interface/plan-day.js:buildPlanDayScreen`, `handlers/plan-view.js:showPlanDay`). `view_weekly_plan` открывает сегодня, `wp_day_<date>` — навигация ◀️/▶️ в пределах Пн..Вс (дата вне недели → сегодня), `wp_menu` — назад в меню плана. День недели вместо даты, ккал у блюд, итоги КБЖУ за день против норм (`getUserProfile` + `pickTargets`; без профиля — суммы и подсказка). Замена/удаление/очистка дня (`handlers/plan-edit.js`, регистрируется из `weekly-plan.js`) возвращают на тот же день.
- ✅ Список покупок с группировкой по типам (`features/shopping-list/logic.js`, `interface/shopping-list.js`). Количества суммируются в базовой единице ингредиента (`recipe_ingredients.amount_base`/`base_unit`: г, мл или шт по `database/unit-conversions.json`) и делятся на `recipes.servings`; «по вкусу» — флаг `shopping_list_items.to_taste`, выводится «Соль: по вкусу» / «Сыр: 200 г + по вкусу». Формат количеств — `utils/formatters.js:formatQuantity` (шт вверх, от 1000 г/мл — кг/л). Пересборка удаляет прежние списки пользователя; список с прошедшим периодом помечается «⚠️ период прошёл». Переключатель «📅 На сегодня / 🗓 На неделю» в экране списка; границы периода — из `utils/date-helpers.js` (`getCurrentDayBounds`/`getCurrentWeekBounds`), сохраняются в `shopping_lists.period_start/period_end`. Ингредиенты классифицированы по 11 типам через `database/ingredient-types.json`.
- ✅ Автогенерация недельного рациона: `generateWeeklyPlan` в `features/weekly-planner/generator.js` собирает Пн..Вс текущей ISO-недели: на слот — случайный рецепт из `TOP_K`=4 ближайших к `user_preferences.target_<slot>` (без цели — из всего пула), без повторов в категории за неделю, пока пул не исчерпан; рецепты с исключёнными продуктами отфильтрованы, любимые дают бонус (см. пункт про предпочтения), main1≠main2; вся запись — одна транзакция. Режимы `overwrite` / `fill` (только пустые слоты, ручные блюда не повторяются). Если в неделе уже есть блюда, хэндлер `generate_weekly_plan` спрашивает «перезаписать / заполнить пустые». CRUD плана (добавление, замена, удаление, просмотр) — в `features/weekly-planner/logic.js`.
- ✅ Редактирование конкретного приёма пищи: 🔄 замена (`edit_slot_*` → случайный рецепт той же категории) и 🗑️ удаление с подтверждением в экране дня плана.
- ✅ Подтверждение при очистке: кнопки очистки ведут на `confirm_clear_day_*` / `confirm_clear_shopping` с Yes/No-диалогом; отмена восстанавливает предыдущий экран.
- ✅ Профиль пользователя: анкета (вес/рост/возраст/пол/активность/цель) через `Scenes.WizardScene`, ккал считаются по Миффлину-Сан Жеору (`utils/calculations.js`), разбивка по слотам 25/30/25/10/10 сохраняется в `user_preferences.target_*`.
- ✅ Целевые КБЖУ с ручной правкой (Stage 3.3): `calculateMacroTargets` (белок г/кг по цели, жиры 30% ккал но ≥0.8 г/кг, углеводы — остаток) пишет `user_preferences.target_protein/fat/carbs` при сохранении анкеты; старые профили добиваются в `getUserProfile`. Настройки → «🎯 Мои нормы КБЖУ» (`handlers/macro-targets.js`, `interface/macro-targets.js`): правка ккал/Б/Ж/У через `features/profile/targets-scene.js` (одна сцена, поле — в initial state), ставит `targets_manual = 1`; правка ккал пересчитывает слоты; расхождение `Б×4+Ж×9+У×4` с ккал >10% — предупреждение. «↩️ Пересчитать по анкете» сбрасывает флаг. При повторной анкете с ручными нормами wizard спрашивает «перезаписать?» (нет → тело обновляется, нормы остаются).
- ✅ Расчёт КБЖУ: `calculateTargetCalories` + `splitCaloriesBySlots` + `calculateMacroTargets` в `src/utils/calculations.js`. BMR/TDEE не хранятся — пересчитываются в `getUserProfile` при чтении.
- ✅ Обратный поиск «что приготовить из моих продуктов» (`src/features/reverse-search/` + `src/interface/reverse-search.js`): `Scenes.WizardScene` принимает ингредиенты через запятую, нормализует через `utils/ingredient-lookup.js:parseIngredientList`, ищет рецепты с ≤3 недостающими без исключённых продуктов, сортирует: недостающие → число любимых продуктов (❤️ в списке) → близость к target-калорийности слота. Инвентарь хранится в `ctx.session.reverseInventory`.
- ✅ Исключённые и любимые продукты (Stage 3.2): таблица `user_ingredient_prefs(user_id, ingredient_id, kind 'excluded'|'favorite')`, продукт только в одном списке (добавление в другой — перенос). Настройки → «🚫 Исключённые продукты» / «❤️ Любимые продукты» (`handlers/ingredient-prefs.js`, `interface/ingredient-prefs.js`): список с кнопками «✖️ продукт», «➕ Добавить» — сцена `features/ingredient-prefs/scene.js` (ввод через запятую, нераспознанное — с подсказками «может быть, …?»). Ввод распознаёт `utils/ingredient-lookup.js` (канон + алиасы + «*» из `_byUnit`, свёртка регистра и ё, однозначная основа слова: «помидоры» → Помидор). Применение — чистые функции `features/ingredient-prefs/scoring.js`: исключённые — жёсткий фильтр (`filterByPrefs`) в генераторе недели, рандоме блюда, замене слота и обратном поиске; любимые — вес `1 + 0.5 × min(любимых, 2)` (`favoriteWeight`) в розыгрыше и делитель расстояния до цели при отборе TOP_K. Старое текстовое поле `user_preferences.exclude_ingredients` переносится в таблицу и удаляется при `initDb` (`database/legacy-exclusions.js`).
- ✅ Дневник питания (Stage 3.4): кнопка «📝 Дневник» → экран дня (`handlers/food-log.js`, `interface/food-log.js` + `food-log-pickers.js`): съеденное с КБЖУ, «съедено / норма / осталось» по ккал/Б/Ж/У с эмодзи-прогресс-баром (без анкеты — только съеденное и подсказка). Добавление: «➕ Из плана» (блюда `daily_menu` этого дня, пишет `slot`) и «🔍 Найти рецепт» (`features/food-log/search-scene.js`, поиск в JS через `toLowerCase`, ё≡е, до 10 кнопок) → порция ½/1/1½/2; «✖️» удаляет (только свои записи); навигация по дням — до 7 дней назад (`HISTORY_DAYS`), добавлять/удалять можно и в прошлые дни. «🍽 Съел» в карточке рандома и обратного поиска (`fl_eat_<id>`) → порция → запись на сегодня. Логика — `features/food-log/logic.js`, чистые подсчёты (`scaleNutrition`/`sumNutrition`/`calculateRemaining`) — `utils/nutrition-totals.js` (их же возьмёт 3.5).
- ✅ «🤔 Что ещё съесть?» (Stage 3.5): кнопка на экране дневника за сегодня (при заданных нормах) → `wte_show_<page>` (`handlers/what-to-eat.js`, `interface/what-to-eat.js`). Остаток = нормы (3.3) − съеденное по `food_log`; < 100 ккал — «норма выполнена», < 0 — «превышено», без предложений. `features/what-to-eat/logic.js:getSuggestions` берёт рецепты без исключённых продуктов и без съеденных сегодня; чистый алгоритм — `features/what-to-eat/scoring.js`: взвешенное расстояние КБЖУ до цели, нормированное на дневную норму (веса ккал 1.5 / Б 1.2 / Ж 0.6 / У 0.4, превышение ×2), ÷ `favoriteWeight`, мягкие правила времени (после 12:00 завтрак ×2, основное ×0.85, пока его не было). 3 одиночных блюда (порция ½/1) целятся в остаток, ужатый до 700 ккал (`mealTarget`); 2 комбинации из 2–3 блюд (порции ½/1/1½, пул — топ-30, не-main категории не повторяются) — во весь остаток. Кнопки «🍽 Съел N» (`wte_eat_<id>_<halves>` / `wte_eatc_<id>x<h>-…` → `food_log` на сегодня, экран пересчитывается), «➕ В план N» (`wte_plan_<id>` / `wte_planc_<id>-…` → `day-plan.js:placeDishToday`: свободный слот — запись, блюдо уже в плане — тост, занятый слот — отдельным сообщением вопрос «Заменить?» из выбора блюда; комбинация раскладывается по блюдам последовательно, итог одним тостом), «🔄 Другие варианты» (следующая страница, по кругу).
- 🔴 Уровни пользователей / подписки — отложено.

## Команды

- `npm start` — запуск бота (`node src/index.js`)
- `npm run dev` — запуск через nodemon с автоперезагрузкой
- `node src/database/migrate.js` — идемпотентная заливка/досыл рецептов из `database/recipes.json` в существующую SQLite. Не пересоздаёт схему.
- `npm run db:reset` — **destructive**: переименовывает текущую `bot.db` в `.bak.<timestamp>` и прогоняет migrate.js с нуля. Использовать после изменений схемы (`src/database/schema.js`) или словарей нормализации (`database/*-aliases.json`).
- `npm run db:check` — диагностика (FK ON? 0 нарушений? row counts).
- `npm run audit:ingredients` — dry-run аудит каталога без БД: тот же пайплайн нормализации, что в migrate; отчёт по составным/нетипизированным именам, коллизиям, битому КБЖУ и кандидатам на слияние. Exit 1, пока есть жёсткие проблемы.
- `npm run db:cleanup` / `:dry` — удаление битых FK-ссылок (idempotent).
- `npm run db:cleanup:garbage` / `:dry` — удаление известного мусора (Test category/recipes, daily_menu 2020-01-01).
- `npm test` — тесты на встроенном `node:test` (`test/**/*.test.js`). Интеграционные тесты работают на in-memory SQLite: первым `require` в файле идёт `test/helpers/memory-db.js` (ставит `DATABASE_PATH=:memory:`, `seedDb()` прогоняет схему + `migrate()`). Каждый файл — отдельный процесс со своей БД. Новая логика — с тестами.

### Переменные окружения (`.env`)

- `BOT_TOKEN` — токен Telegram-бота. Проверяется по формату BotFather (`src/bot/create-bot.js:isUsableBotToken`); пустой или заглушка вроде `your_telegram_bot_token_here` → бот логирует предупреждение и **не стартует**.
- `DATABASE_PATH` — путь к SQLite-файлу (по умолчанию `./database/bot.db`).
- `LOG_LEVEL` — уровень winston-логгера (по умолчанию `info`).

## Архитектура

Однопроцессный long-polling Telegraf-бот. `src/index.js` — только старт (`initDb` → `bot.launch`). Бот собирается в `src/bot/create-bot.js:createBot` (session → Stage → хэндлеры, без запуска — так его гоняют `test/bot/*.test.js` через `test/helpers/fake-bot.js:createFakeBot`, перехватывающий Bot API). Хэндлеры (`bot.hears` / `bot.action`) живут по фичам в `src/bot/handlers/<feature>.js`, каждый файл экспортирует `register(bot)` и вызывает функции из `interface/` и `features/`. Новый экран — новый файл в `handlers/` + строка в списке `createBot`; `common.js` (middleware авто-регистрации, `/start`, `/help`) всегда первым. `handlers/helpers.js:safeEdit` — `editMessageText` с игнором «message is not modified».

### Слои (обязательная структура из `projectRules.mdc`)

- `src/bot/` — константы/локализация (`texts.js`). **Все пользовательские строки на русском должны жить только здесь** — это жёсткое правило проекта. Чтобы `texts.js` не перерос 300 строк, новые крупные разделы выносятся в `src/bot/texts/<раздел>.js` и подключаются в `texts.js` одной строкой (`ingredientPrefs: require('./texts/ingredient-prefs')`, `foodLog: require('./texts/food-log')`); в коде строки всё равно берутся через `require('../bot/texts')`.
- `src/interface/` — UI-слой: сборка клавиатур (`Markup.inlineKeyboard`, `Markup.keyboard`), форматирование HTML-сообщений. Один файл на экран: `main-menu.js`, `dish-selection.js`, `weekly-plan.js` (меню плана, диалоги), `plan-day.js` (экран дня плана), `shopping-list.js`.
- `src/features/<feature>/logic.js` — бизнес-логика и работа с БД. Фичи: `meal-suggestions/`, `weekly-planner/`, `shopping-list/`. Опционально рядом кладётся `api.js` (внешние интеграции).
- `src/database/` — соединение sqlite3 + привязанные к нему хелперы (`db.js`), схема (`schema.js`: async `initDb()`, идемпотентно через `CREATE TABLE IF NOT EXISTS`, вызывается из `src/index.js:start` до `bot.launch`) и миграция из JSON (`migrate.js`).
- `src/utils/` — общие утилиты: `logger.js` (winston: консоль + `logs/error.log` + `logs/combined.log`) и `date-helpers.js` (`getCurrentWeekBounds()` → `{ start, endExclusive }` для SQL-запросов «на этой неделе»).

### Поток данных для типового сценария «выбор блюда»

1. `bot.hears(texts.mainMenu.buttons.suggestions)` → `interface/dish-selection.js:sendCategorySelection` отрисовывает inline-клавиатуру категорий.
2. Callback `select_cat_<category>` → `showDishSuggestion` зовёт `features/meal-suggestions/logic.js:getRandomRecipeByCategory` + `getRecipeIngredients`.
3. Callback `confirm_dish_<recipeId>` → `features/weekly-planner/day-plan.js:checkDishPlacement` (без записи). Свободный слот → `features/weekly-planner/logic.js:saveSelectedDish` создаёт (или переиспользует) `daily_menu` на сегодня и UPSERT'ит `daily_menu_items` со слотом из категории (`CATEGORY_TO_SLOTS`), возвращает `{ slot, status }`; хэндлер показывает тост и сводку дня. Все слоты категории заняты → вопрос «заменить?» (`dish_swap_*` → `replaceInSlot`).

### Схема БД (13 таблиц)

Создаются в `src/database/schema.js:initDb`. Ключевые связи:
- `users(id, telegram_id)` — внутренний `id` используется во всех FK, `telegram_id` — только для поиска пользователя.
- `recipes` ↔ `ingredients` через `recipe_ingredients(recipe_id, ingredient_id, amount, unit)`.
- План на день: `daily_menu(user_id, date)` 1:N `daily_menu_items(slot 1..5)`. Слот 1=завтрак, 2=основное_1, 3=основное_2, 4=салат, 5=десерт (из README).
- Недельный план: `weekly_menu(user_id, week_start)` 1:N `weekly_menu_days` → `daily_menu`.
- Список покупок: `shopping_lists(user_id, period_start, period_end)` 1:N `shopping_list_items(ingredient_id, total_amount, unit)`.
- Предпочтения по продуктам: `user_ingredient_prefs(user_id, ingredient_id, kind)`, PK `(user_id, ingredient_id)`.
- Дневник питания: `food_log(user_id, date, recipe_id, portion, slot NULL)`, индекс `(user_id, date)`. Факт «что съел» — отдельно от плана (`daily_menu`). КБЖУ не копируется: `recipes.*` (на порцию) × `portion`. `slot` — только у записей из плана. Новая таблица создаётся `CREATE TABLE IF NOT EXISTS` — `db:reset` не нужен.

Полные определения и комментарии по каждой таблице — в `src/database/schema.js`. Обоснования (зачем нужна, как связана с остальными) — в roadmap раздел 2.

## Конвенции (из `projectRules.mdc`)

- Имена файлов — **kebab-case**, максимум **300 строк** на файл. Если файл растёт — дроби по ответственности.
- Комментарии:
  - сложная логика — билингвальные `// [RU] ... / // [EN] ...`;
  - простые комментарии — русский;
  - JSDoc — **только на английском** (см. существующие `@param`/`@returns` в `features/*/logic.js`).
- Глобальные переменные запрещены, обработка ошибок обязательна, целевая цикломатическая сложность ≤10, следовать DRY.
- Любую пользовательскую строку добавлять в `src/bot/texts.js` и тянуть через `require('../bot/texts')` — не хардкодить в коде интерфейса.

## Неочевидные особенности кода

- **Авто-регистрация пользователя** происходит в глобальном middleware `src/bot/handlers/common.js` через `getOrCreateUser(ctx.from.id, ctx.from.username)` — к моменту любого хэндлера пользователь уже есть в БД.
- **Доступ к БД — только через хелперы** `const { dbGet, dbAll, dbRun, withTransaction } = require('../../database/db')` (фабрика — `utils/db-helpers.js`). Не вызывать `db.get/all/run` с колбэками и не писать `BEGIN/COMMIT` руками. Все записи идут через одну очередь процесса: node-sqlite3 — одно соединение, и без очереди чужая запись попала бы в открытую транзакцию и пропала на ROLLBACK. Многошаговые записи (read-then-write, несколько INSERT) — в `withTransaction(async () => …)`; вложенные вызовы реентерабельны (AsyncLocalStorage), вложенная транзакция присоединяется к внешней. Чтения не ставятся в очередь — не держите долгие чтения внутри транзакции.
- **`confirm_dish`** всегда пишет в `daily_menu` за **сегодня** через `formatLocalDate(new Date())` из `utils/date-helpers.js` (локальная дата, не UTC — иначе у пользователей в UTC+N рядом с полуночью блюдо уезжало бы на следующие сутки и выпадало из окна `getWeeklyPlan`). Явного выбора даты нет — это намеренно для текущего MVP.
- **КБЖУ и порции рецептов считаются, а не берутся из JSON.** Поля `nutrition*` в `recipes.json` не используются: у ~80 рецептов там значения на 100 г при ингредиентах на всё блюдо. `src/database/nutrition-calculator.js:computeRecipeNutrition` суммирует КБЖУ из `database/ingredient-nutrition.json` (на 100 г/мл, сырой продукт) и делит на порции: `servings` = максимум из значения в JSON, «вес сырья / стандартная порция категории» и «ккал / потолок порции» (`PORTIONS`: завтрак 250 г/450 ккал, основное 350/600, салат 250/400, десерт 150/350). `recipes.calories/protein/fat/carbs` в БД — на одну порцию. Новый ингредиент без записи в `ingredient-nutrition.json` — ошибка миграции.
- **Рассогласование ключей категорий**: в `recipes.json` `category` приходит как английский ключ (`breakfast`, `main`, `salads`, `desserts`), матчинг рецептов в `features/meal-suggestions/logic.js:getRandomRecipeByCategory` делается через `LOWER(mc.name) = LOWER(?)`. `CATEGORY_LABEL` в `src/bot/handlers/weekly-plan.js` и подписи в `interface/dish-selection.js` собирают русские названия категорий локально — формально это дубликат, который должен уехать в `texts.js`/`utils/formatters.js` (см. roadmap 4.6).
- **Сессия и Scenes**: `src/bot/create-bot.js` регистрирует `session()` (in-memory) + `Scenes.Stage([profileScene, reverseSearchScene, macroTargetScene, ingredientPrefsScene, foodLogSearchScene])` — нужно для многошаговых WizardScene. Стор памяти достаточно: состояние анкеты короткоживущее, при рестарте пользователь просто начнёт заново. Если понадобится персистентность — адаптеры из `@telegraf/session` (см. roadmap 2.6).
- **Выход из сцен по навигации**: все шаги ввода (кроме шага 0) оборачиваются в `src/bot/scene-escape.js:escapable(step, { ownCallback })`. Кнопка главного меню, любая команда (кроме `/cancel` — его ловит `scene.command`) и inline-кнопка, не подходящая под `ownCallback`, делают `scene.leave()` + `next()` — апдейт уходит обычным хэндлерам. Свои кнопки: анкета — `profile_(sex|act|goal|overwrite)_*`, правка норм — `macro_edit_*` (переключает поле), продукты — `prefs_add_cancel`; у поиска дневника и обратного поиска своих нет. Новую сцену ввода оборачивайте так же; шаг 0 не оборачивать — при входе сцена прогоняет через него входящий апдейт.
- **Миграция схемы через ALTER TABLE**: `CREATE TABLE IF NOT EXISTS` не ретрофитит изменения. В `src/database/schema.js` (`addMissingColumns`) для новых колонок `user_preferences` используется `PRAGMA table_info` + `ALTER TABLE ADD COLUMN` — идемпотентно, без нужды в `npm run db:reset`. При добавлении новых столбцов в существующие таблицы держите этот паттерн.

## Известные проблемы (⚠️ читать перед правками)

Эти баги существуют в коде/данных прямо сейчас. Полный разбор, цифры по текущей БД и варианты решения — в roadmap раздел 4. Часть пунктов подтверждена аудитом БД от 2026-04-20.

### Блок А — целостность БД и пайплайн миграции

**Этап 0 стабилизации БД закрыт.** После прогона `npm run db:reset` на чистом старте: 117 рецептов, 170 ингредиентов (2 записи «лука» вместо 5), 20 unit-вариантов (вместо 37), FK ON, 0 нарушений, UNIQUE(name) на `recipes`.

- **✅ FK включены (roadmap 4.9).** `PRAGMA foreign_keys = ON` выставляется в `src/database/db.js` при каждом открытии соединения. Для проверки: `npm run db:check`. Для восстановления после исторических битых ссылок: `npm run db:cleanup`.
- **✅ Мусорные данные удалены (roadmap 4.10).** Категория `Test` и 3 `Test Recipe` удалены через `scripts/delete-test-garbage.js`. На чистой БД сид из JSON их не содержит.
- **✅ `migrate.js` идемпотентен (roadmap 4.11).** Переписан на async/await, `SELECT id WHERE name=?` перед INSERT, `INSERT OR IGNORE` на связи, assert количества до `COMMIT` (ROLLBACK при расхождении).
- **✅ `parseAmount` держит диапазоны (roadmap 4.12).** `"2-3 шт"` → `{amount: 2, unit: "шт"}`. Покрыт smoke-тестом (13 кейсов, включая `–`, `—`, `1/2`, скобки).
- **✅ Хаос в `unit` — нормализован словарём (roadmap 4.13).** `database/unit-aliases.json` + `normalizeUnit` в `src/database/ingredient-normalizer.js` сворачивают `ст.л.`/`ст. л.`, `стакан`/`стаканов`/`чашка`, срезают суффикс `(150 г)` и т.п.
- **✅ Справочник ингредиентов санитизирован (roadmap 4.1, 2.10 п.1–3).** Вся нормализация — в `src/database/ingredient-normalizer.js` (её же использует `scripts/audit-ingredients.js`). `database/ingredient-aliases.json`: `_split` разбивает составные записи («Соль, перец» → Соль + Перец черный, числовое количество делится поровну), «X или Y» / «X/Y» → первый вариант, `_byUnit` выбирает канон по единице («Перец» в `шт` → Болгарский перец, иначе → Перец черный), дальше алиасы. Совпавшие в одном рецепте строки суммируются (`mergeRecipeRows`), а не теряются на PK. `migrate.js` падает, если осталось имя с `,`/` или `/`/` или его нет в `ingredient-types.json`. Итого 135 ингредиентов (было 170). Количества переводятся в базовую единицу (`src/database/unit-converter.js` + `database/unit-conversions.json`: дефолтные коэффициенты, переопределения и вес штуки по ингредиенту, подсказка «(150 г)» из рецепта как общий вес); `migrate.js` падает на единице без коэффициента.
- **✅ Типы ингредиентов классифицированы (roadmap 4.5).** Все канонические ингредиенты размечены в `database/ingredient-types.json` по 11 типам из `texts.shoppingList.types` (Овощи, Молочные продукты, Мясо и птица, …, Другое). `migrate.js` пишет тип в `ingredients.type` с `ON CONFLICT(name) DO UPDATE SET type = excluded.type` — можно добавлять записи в JSON и перезапускать `migrate.js` без `db:reset`. Имя без типа — ошибка миграции.

### Блок Б — логика приложения

- **✅ SQL-окна дат исправлены (roadmap 4.3 + 4.4).** `getIngredientsFromPlan` и `getWeeklyPlan` принимают границы Пн..Вс текущей недели из `utils/date-helpers.js:getCurrentWeekBounds()`. Семантика недели: ISO (понедельник — начало, воскресенье — конец).
- **✅ `slot` теперь вычисляется из категории (roadmap 4.2).** `saveSelectedDish` JOIN'ит `meal_categories`, мапит имя категории на slots (`breakfast`→[1], `main`→[2,3], `salads`→[4], `desserts`→[5]) и делает UPSERT через `ON CONFLICT(daily_menu_id, slot) DO UPDATE SET recipe_id=excluded.recipe_id`. В схеме `daily_menu_items` добавлен `UNIQUE(daily_menu_id, slot)` — требует `npm run db:reset` для существующих БД.
- **✅ `BOT_TOKEN` placeholder-check (roadmap 4.7).** Вместо сравнения с одной строкой — проверка формата токена.
- **✅ Двухшаговое подтверждение очистки реализовано (roadmap 2.5).** Кнопки в планe/списке ведут на `confirm_clear_day_<date>` / `confirm_clear_shopping`; эти хэндлеры меняют сообщение на Yes/No-диалог (`do_clear_*` / `cancel_clear_*`). Отмена восстанавливает предыдущий экран из БД.

## Рабочие принципы для агента

- Перед крупной фичей — сверяться с `/.claude/plans/product-roadmap.md` (приоритеты там расставлены, зависимости между фичами учтены).
- Если правка закрывает или обновляет статус пункта из roadmap — **обновить сам roadmap** (статус, пометка «сделано», актуализация зависимостей) в том же PR. То же для секции «Статус функциональности» в этом файле.
- Не создавать утилитарные файлы из `projectRules.mdc` заранее (только `calculations.js`/`date-helpers.js`/`formatters.js`/`db-helpers.js` когда они действительно нужны первой функции).
- Не заводить бэкап-совместимость для только что переименованных/удалённых вещей (см. общие правила: feature flag shims и `// removed` комментарии запрещены).

## Технологический стек

Telegraf 4, sqlite3, dotenv, winston. Перед работой со сторонними API/библиотеками `projectRules.mdc` рекомендует использовать MCP `context7` для актуальной документации.
