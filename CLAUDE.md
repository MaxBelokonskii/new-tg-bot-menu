# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Продуктовое видение

Бот собирает рацион питания в Telegram и превращает его в список покупок. Ядро — две сущности: **рацион** (на «сегодня» или на неделю, оба редактируемые поприёмно) и **коллекция рецептов** (117 рецептов в 4 категориях, загружены в SQLite из `database/recipes.json`). На эти сущности надстраиваются: список покупок, персонализация (анкета + целевая калорийность), обратный поиск «что приготовить из моих продуктов» и подписочные тарифы (последние два — поздние этапы).

**Полный roadmap со стадиями готовности, приоритетами и известными проблемами — в `/.claude/plans/product-roadmap.md`.** Сверяйтесь с ним перед любыми новыми фичами; при изменении статуса фичи обновляйте этот файл.

## Статус функциональности (короткая версия)

✅ работает, 🟡 частично, 🔴 не реализовано. Подробности — в roadmap (раздел 2).

- 🟡 Рандом блюда по категории → карточка рецепта → добавление в рацион на сегодня (`interface/dish-selection.js` + `features/weekly-planner/logic.js:saveSelectedDish`). `slot` вычисляется из категории (`breakfast`→1, `main`→2/3, `salads`→4, `desserts`→5). Повторное добавление в занятый слот молча перезаписывает предыдущий рецепт (UX-подтверждение — плановая доработка 2.5).
- 🟡 Просмотр текущего рациона (`bot.action('view_weekly_plan')` в `src/index.js`). Ограничен текущей календарной неделей Пн..Вс.
- 🟡 Список покупок с группировкой по типам (`features/shopping-list/logic.js`, `interface/shopping-list.js`). Берётся текущая неделя; все ингредиенты сейчас с `type='general'`.
- 🔴 Автогенерация недельного рациона — заглушка, `generateWeeklyPlan` пустая.
- 🔴 Редактирование конкретного приёма пищи — не реализовано.
- 🔴 Подтверждение при очистке (сейчас `clear_day_*` и `clear_shopping_list` чистят сразу).
- 🔴 Профиль пользователя (вес/рост/возраст/цель по ккал) — таблица `user_preferences` есть, UI и логика — нет.
- 🔴 Расчёт КБЖУ по формуле Миффлина-Сан Жеора — отложено.
- 🔴 Обратный поиск «что приготовить из моих продуктов» — отложено (нормализация ингредиентов уже на месте, осталась классификация по типам и матчинг user-inventory).
- 🔴 Уровни пользователей / подписки — отложено.

## Команды

- `npm start` — запуск бота (`node src/index.js`)
- `npm run dev` — запуск через nodemon с автоперезагрузкой
- `node src/database/migrate.js` — идемпотентная заливка/досыл рецептов из `database/recipes.json` в существующую SQLite. Не пересоздаёт схему.
- `npm run db:reset` — **destructive**: переименовывает текущую `bot.db` в `.bak.<timestamp>` и прогоняет migrate.js с нуля. Использовать после изменений схемы (`src/database/db.js`) или словарей нормализации (`database/*-aliases.json`).
- `npm run db:check` — диагностика (FK ON? 0 нарушений? row counts).
- `npm run db:cleanup` / `:dry` — удаление битых FK-ссылок (idempotent).
- `npm run db:cleanup:garbage` / `:dry` — удаление известного мусора (Test category/recipes, daily_menu 2020-01-01).
- Тесты в проекте пока не настроены, хотя `projectRules.mdc` их предписывает — при добавлении новой утилиты/логики уточняйте у пользователя, нужен ли тестовый каркас, прежде чем вводить фреймворк.

### Переменные окружения (`.env`)

- `BOT_TOKEN` — токен Telegram-бота. Если не задан или равен `your_telegram_bot_token`, бот логирует предупреждение и **не стартует** (см. `src/index.js:213`).
- `DATABASE_PATH` — путь к SQLite-файлу (по умолчанию `./database/bot.db`).
- `LOG_LEVEL` — уровень winston-логгера (по умолчанию `info`).

## Архитектура

Однопроцессный long-polling Telegraf-бот. Все апдейты от Telegram обрабатываются в `src/index.js` — это единственная точка маршрутизации, где `bot.hears` / `bot.action` вызывают функции из `interface/` и `features/`. Новые экраны добавляются именно здесь, а не в отдельных роутерах.

### Слои (обязательная структура из `projectRules.mdc`)

- `src/bot/` — константы/локализация (`texts.js`). **Все пользовательские строки на русском должны жить только здесь** — это жёсткое правило проекта.
- `src/interface/` — UI-слой: сборка клавиатур (`Markup.inlineKeyboard`, `Markup.keyboard`), форматирование HTML-сообщений. Один файл на экран: `main-menu.js`, `dish-selection.js`, `weekly-plan.js`, `shopping-list.js`.
- `src/features/<feature>/logic.js` — бизнес-логика и работа с БД. Фичи: `meal-suggestions/`, `weekly-planner/`, `shopping-list/`. Опционально рядом кладётся `api.js` (внешние интеграции).
- `src/database/` — подключение к sqlite3 (`db.js`) и скрипт миграции из JSON (`migrate.js`). Схема БД создаётся в `initDb()` идемпотентно через `CREATE TABLE IF NOT EXISTS` и вызывается из `src/index.js` при старте.
- `src/utils/` — общие утилиты: `logger.js` (winston: консоль + `logs/error.log` + `logs/combined.log`) и `date-helpers.js` (`getCurrentWeekBounds()` → `{ start, endExclusive }` для SQL-запросов «на этой неделе»).

### Поток данных для типового сценария «выбор блюда»

1. `bot.hears(texts.mainMenu.buttons.suggestions)` → `interface/dish-selection.js:sendCategorySelection` отрисовывает inline-клавиатуру категорий.
2. Callback `select_cat_<category>` → `showDishSuggestion` зовёт `features/meal-suggestions/logic.js:getRandomRecipeByCategory` + `getRecipeIngredients`.
3. Callback `confirm_dish_<recipeId>` → `features/weekly-planner/logic.js:saveSelectedDish` создаёт (или переиспользует) `daily_menu` на сегодня и UPSERT'ит `daily_menu_items` со слотом, вычисленным из категории рецепта (`CATEGORY_TO_SLOTS` в том же файле). При повторном добавлении в занятый слот возвращается `{ slot, replaced: true }`, хэндлер показывает соответствующее уведомление.

### Схема БД (11 таблиц)

Создаются в `src/database/db.js:initDb`. Ключевые связи:
- `users(id, telegram_id)` — внутренний `id` используется во всех FK, `telegram_id` — только для поиска пользователя.
- `recipes` ↔ `ingredients` через `recipe_ingredients(recipe_id, ingredient_id, amount, unit)`.
- План на день: `daily_menu(user_id, date)` 1:N `daily_menu_items(slot 1..5)`. Слот 1=завтрак, 2=основное_1, 3=основное_2, 4=салат, 5=десерт (из README).
- Недельный план: `weekly_menu(user_id, week_start)` 1:N `weekly_menu_days` → `daily_menu`.
- Список покупок: `shopping_lists(user_id, period_start, period_end)` 1:N `shopping_list_items(ingredient_id, total_amount, unit)`.

Полные определения и комментарии по каждой таблице — в `src/database/db.js:initDb`. Обоснования (зачем нужна, как связана с остальными) — в roadmap раздел 2.

## Конвенции (из `projectRules.mdc`)

- Имена файлов — **kebab-case**, максимум **300 строк** на файл. Если файл растёт — дроби по ответственности.
- Комментарии:
  - сложная логика — билингвальные `// [RU] ... / // [EN] ...`;
  - простые комментарии — русский;
  - JSDoc — **только на английском** (см. существующие `@param`/`@returns` в `features/*/logic.js`).
- Глобальные переменные запрещены, обработка ошибок обязательна, целевая цикломатическая сложность ≤10, следовать DRY.
- Любую пользовательскую строку добавлять в `src/bot/texts.js` и тянуть через `require('../bot/texts')` — не хардкодить в коде интерфейса.

## Неочевидные особенности кода

- **Авто-регистрация пользователя** происходит в глобальном middleware `src/index.js:24` через `getOrCreateUser(ctx.from.id, ctx.from.username)` — к моменту любого хэндлера пользователь уже есть в БД.
- **sqlite3 работает на колбэках**; весь код оборачивает его в `new Promise` вручную (см. `features/weekly-planner/logic.js`). При добавлении новых запросов держите этот стиль, не смешивайте с `await db.all` — такого API здесь нет. Кандидат на вынесение в `utils/db-helpers.js` (в `projectRules.mdc` этот файл предусмотрен, но пока не создан).
- **`confirm_dish`** всегда пишет в `daily_menu` за **сегодня** через `formatLocalDate(new Date())` из `utils/date-helpers.js` (локальная дата, не UTC — иначе у пользователей в UTC+N рядом с полуночью блюдо уезжало бы на следующие сутки и выпадало из окна `getWeeklyPlan`). Явного выбора даты нет — это намеренно для текущего MVP.
- **Нутриенты**: в JSON поля называются `proteins`/`fats`, в БД — `protein`/`fat`. `migrate.js` нормализует это при вставке (`nutrition.proteins || nutrition.protein || 0`). Не менять без сверки с JSON-источником.
- **Рассогласование ключей категорий**: в `recipes.json` `category` приходит как английский ключ (`breakfast`, `main`, `salads`, `desserts`), матчинг рецептов в `features/meal-suggestions/logic.js:getRandomRecipeByCategory` делается через `LOWER(mc.name) = LOWER(?)`. `src/index.js:94` содержит локальный `categoryMap` с русскими подписями — формально это дубликат, который должен уехать в `texts.js`/`utils/formatters.js` (см. roadmap 4.6).

## Известные проблемы (⚠️ читать перед правками)

Эти баги существуют в коде/данных прямо сейчас. Полный разбор, цифры по текущей БД и варианты решения — в roadmap раздел 4. Часть пунктов подтверждена аудитом БД от 2026-04-20.

### Блок А — целостность БД и пайплайн миграции

**Этап 0 стабилизации БД закрыт.** После прогона `npm run db:reset` на чистом старте: 117 рецептов, 170 ингредиентов (2 записи «лука» вместо 5), 20 unit-вариантов (вместо 37), FK ON, 0 нарушений, UNIQUE(name) на `recipes`.

- **✅ FK включены (roadmap 4.9).** `PRAGMA foreign_keys = ON` выставляется в `src/database/db.js` при каждом открытии соединения. Для проверки: `npm run db:check`. Для восстановления после исторических битых ссылок: `npm run db:cleanup`.
- **✅ Мусорные данные удалены (roadmap 4.10).** Категория `Test` и 3 `Test Recipe` удалены через `scripts/delete-test-garbage.js`. На чистой БД сид из JSON их не содержит.
- **✅ `migrate.js` идемпотентен (roadmap 4.11).** Переписан на async/await, `SELECT id WHERE name=?` перед INSERT, `INSERT OR IGNORE` на связи, assert количества до `COMMIT` (ROLLBACK при расхождении).
- **✅ `parseAmount` держит диапазоны (roadmap 4.12).** `"2-3 шт"` → `{amount: 2, unit: "шт"}`. Покрыт smoke-тестом (13 кейсов, включая `–`, `—`, `1/2`, скобки).
- **✅ Хаос в `unit` — нормализован словарём (roadmap 4.13).** `database/unit-aliases.json` + `normalizeUnit` в `migrate.js` сворачивают `ст.л.`/`ст. л.`, `стакан`/`стаканов`/`чашка`, срезают суффикс `(150 г)` и т.п.
- **✅ Задвоение ингредиентов в справочнике — нормализовано словарём (roadmap 4.1).** `database/ingredient-aliases.json` + `normalizeIngredient` (13 канонических групп).
- **⚠️ Типы ингредиентов = `'general'` (roadmap 4.5).** После реимпорта все 170 ингредиентов имеют `type='general'` — классификация по типам (Овощи, Молочные и т.д.) ещё не решена. Нужен отдельный словарь/эвристика. Пока `interface/shopping-list.js:formatShoppingList` грузит их под рубрикой `📦 general`.

### Блок Б — логика приложения

- **✅ SQL-окна дат исправлены (roadmap 4.3 + 4.4).** `getIngredientsFromPlan` и `getWeeklyPlan` принимают границы Пн..Вс текущей недели из `utils/date-helpers.js:getCurrentWeekBounds()`. Семантика недели: ISO (понедельник — начало, воскресенье — конец).
- **✅ `slot` теперь вычисляется из категории (roadmap 4.2).** `saveSelectedDish` JOIN'ит `meal_categories`, мапит имя категории на slots (`breakfast`→[1], `main`→[2,3], `salads`→[4], `desserts`→[5]) и делает UPSERT через `ON CONFLICT(daily_menu_id, slot) DO UPDATE SET recipe_id=excluded.recipe_id`. В схеме `daily_menu_items` добавлен `UNIQUE(daily_menu_id, slot)` — требует `npm run db:reset` для существующих БД.
- **`BOT_TOKEN` placeholder-check не ловит значение из `.env.example` (roadmap 4.7).** `src/index.js:213` сравнивает с `'your_telegram_bot_token'`, а в `.env.example` строка `your_telegram_bot_token_here` — бот попытается стартовать с заглушкой.
- **Генерация недельного плана не реализована.** `bot.action('generate_weekly_plan')` отвечает заглушкой, `features/weekly-planner/logic.js:generateWeeklyPlan` — пустая функция. Это **не баг, а запланированная фича** (roadmap 2.2) — не «чините» до обсуждения подхода.
- **Очистка рациона и списка покупок — без подтверждения.** Поведение `clear_day_*` и `clear_shopping_list` удаляет сразу. Двухшаговое подтверждение — плановая доработка (roadmap 2.5), а не ошибка реализации.

## Рабочие принципы для агента

- Перед крупной фичей — сверяться с `/.claude/plans/product-roadmap.md` (приоритеты там расставлены, зависимости между фичами учтены).
- Если правка закрывает или обновляет статус пункта из roadmap — **обновить сам roadmap** (статус, пометка «сделано», актуализация зависимостей) в том же PR. То же для секции «Статус функциональности» в этом файле.
- Не создавать утилитарные файлы из `projectRules.mdc` заранее (только `calculations.js`/`date-helpers.js`/`formatters.js`/`db-helpers.js` когда они действительно нужны первой функции).
- Не заводить бэкап-совместимость для только что переименованных/удалённых вещей (см. общие правила: feature flag shims и `// removed` комментарии запрещены).

## Технологический стек

Telegraf 4, sqlite3, dotenv, winston. Перед работой со сторонними API/библиотеками `projectRules.mdc` рекомендует использовать MCP `context7` для актуальной документации.
