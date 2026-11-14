const { dbGet, dbAll, dbRun } = require('./db');
const { migrateLegacyExclusions } = require('./legacy-exclusions');

const TABLES = [
  // 1. users
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL UNIQUE,
    username TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  // 2. meal_categories
  `CREATE TABLE IF NOT EXISTS meal_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  )`,

  // 3. recipes
  `CREATE TABLE IF NOT EXISTS recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    category_id INTEGER NOT NULL,
    description TEXT,
    calories INTEGER NOT NULL,
    protein REAL NOT NULL,
    fat REAL NOT NULL,
    carbs REAL NOT NULL,
    servings INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (category_id) REFERENCES meal_categories(id)
  )`,

  // 4. ingredients
  `CREATE TABLE IF NOT EXISTS ingredients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL
  )`,

  // 5. recipe_ingredients
  `CREATE TABLE IF NOT EXISTS recipe_ingredients (
    recipe_id INTEGER NOT NULL,
    ingredient_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    unit TEXT NOT NULL,
    amount_base REAL,
    base_unit TEXT,
    PRIMARY KEY (recipe_id, ingredient_id),
    FOREIGN KEY (recipe_id) REFERENCES recipes(id),
    FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
  )`,

  // 6. daily_menu
  `CREATE TABLE IF NOT EXISTS daily_menu (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    date DATE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, date),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,

  // 7. daily_menu_items
  `CREATE TABLE IF NOT EXISTS daily_menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    daily_menu_id INTEGER NOT NULL,
    recipe_id INTEGER NOT NULL,
    slot INTEGER NOT NULL,
    UNIQUE (daily_menu_id, slot),
    FOREIGN KEY (daily_menu_id) REFERENCES daily_menu(id),
    FOREIGN KEY (recipe_id) REFERENCES recipes(id)
  )`,

  // 8. weekly_menu
  `CREATE TABLE IF NOT EXISTS weekly_menu (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    week_start DATE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, week_start),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,

  // 9. weekly_menu_days
  `CREATE TABLE IF NOT EXISTS weekly_menu_days (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    weekly_menu_id INTEGER NOT NULL,
    date DATE NOT NULL,
    daily_menu_id INTEGER NOT NULL,
    FOREIGN KEY (weekly_menu_id) REFERENCES weekly_menu(id),
    FOREIGN KEY (daily_menu_id) REFERENCES daily_menu(id)
  )`,

  // 10. user_preferences
  `CREATE TABLE IF NOT EXISTS user_preferences (
    user_id INTEGER PRIMARY KEY,
    target_calories INTEGER,
    weight REAL,
    height REAL,
    age INTEGER,
    sex TEXT,
    activity_level TEXT,
    goal TEXT,
    target_breakfast INTEGER,
    target_main1 INTEGER,
    target_main2 INTEGER,
    target_salad INTEGER,
    target_dessert INTEGER,
    target_protein INTEGER,
    target_fat INTEGER,
    target_carbs INTEGER,
    targets_manual INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,

  // 11. shopping_lists
  `CREATE TABLE IF NOT EXISTS shopping_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,

  // shopping_list_items — позиции списка; is_bought — отметка «куплено».
  `CREATE TABLE IF NOT EXISTS shopping_list_items (
    shopping_list_id INTEGER NOT NULL,
    ingredient_id INTEGER NOT NULL,
    total_amount REAL NOT NULL,
    unit TEXT NOT NULL,
    to_taste INTEGER NOT NULL DEFAULT 0,
    is_bought INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (shopping_list_id, ingredient_id),
    FOREIGN KEY (shopping_list_id) REFERENCES shopping_lists(id),
    FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
  )`,

  // 12. user_ingredient_prefs — исключённые (жёсткий фильтр) и любимые
  // (мягкий приоритет) продукты; продукт не может быть в обоих списках.
  `CREATE TABLE IF NOT EXISTS user_ingredient_prefs (
    user_id INTEGER NOT NULL,
    ingredient_id INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('excluded', 'favorite')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, ingredient_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
  )`,

  // 13. food_log — дневник питания: факт «что съел» (план — отдельно в daily_menu).
  // КБЖУ не копируется: считается JOIN-ом на recipes × portion. slot — только
  // для записей, сделанных из плана.
  `CREATE TABLE IF NOT EXISTS food_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    recipe_id INTEGER NOT NULL,
    portion REAL NOT NULL DEFAULT 1,
    slot INTEGER NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (recipe_id) REFERENCES recipes(id)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_food_log_user_date ON food_log(user_id, date)'
];

// [RU] Колонки, добавленные в user_preferences после первой версии схемы.
// [EN] Columns added to user_preferences after the initial schema version.
// [RU] Колонки Этапа 3.1 (базовые единицы и порции). Значения заполняет migrate.js
// (UPSERT связей), так что старой БД хватает повторного прогона миграции.
// [EN] Stage 3.1 columns (base units, servings). migrate.js fills them via
// link UPSERT, so an old DB only needs migrate.js to be re-run.
const CATALOG_ADDED_COLUMNS = {
  recipes: [['servings', 'INTEGER NOT NULL DEFAULT 1']],
  recipe_ingredients: [['amount_base', 'REAL'], ['base_unit', 'TEXT']],
  shopping_list_items: [
    ['to_taste', 'INTEGER NOT NULL DEFAULT 0'],
    // [RU] Отметка «куплено» в списке покупок (чек-лист).
    // [EN] "Bought" mark of the shopping list checklist.
    ['is_bought', 'INTEGER NOT NULL DEFAULT 0']
  ]
};

const USER_PREFERENCES_ADDED_COLUMNS = [
  ['weight', 'REAL'],
  ['height', 'REAL'],
  ['age', 'INTEGER'],
  ['sex', 'TEXT'],
  ['activity_level', 'TEXT'],
  ['goal', 'TEXT'],
  ['target_breakfast', 'INTEGER'],
  ['target_main1', 'INTEGER'],
  ['target_main2', 'INTEGER'],
  ['target_salad', 'INTEGER'],
  ['target_dessert', 'INTEGER'],
  ['target_protein', 'INTEGER'],
  ['target_fat', 'INTEGER'],
  ['target_carbs', 'INTEGER'],
  ['targets_manual', 'INTEGER DEFAULT 0']
];

/**
 * Adds columns missing from an existing table (ALTER TABLE ADD COLUMN).
 * Idempotent: columns already present according to PRAGMA table_info are skipped.
 * @param {string} table
 * @param {Array<[string, string]>} columns - [name, SQL type] pairs
 * @returns {Promise<void>}
 */
async function addMissingColumns(table, columns) {
  const rows = await dbAll(`PRAGMA table_info(${table})`);
  const existing = new Set(rows.map(r => r.name));
  for (const [name, type] of columns) {
    if (existing.has(name)) continue;
    await dbRun(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
}

/**
 * Throws if daily_menu_items lacks UNIQUE(daily_menu_id, slot): slot UPSERTs
 * depend on it and the constraint cannot be added via ALTER TABLE.
 * @returns {Promise<void>}
 */
async function assertDailyMenuItemsUnique() {
  const row = await dbGet(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='daily_menu_items'"
  );
  if (!row || !/UNIQUE\s*\(\s*daily_menu_id\s*,\s*slot\s*\)/i.test(row.sql)) {
    throw new Error(
      'daily_menu_items is missing UNIQUE(daily_menu_id, slot). ' +
      'Run `npm run db:reset` and restart the bot.'
    );
  }
}

/**
 * Creates all tables idempotently and retrofits schema changes on existing
 * databases.
 *
 * [RU] CREATE TABLE IF NOT EXISTS не обновляет схему существующей БД, поэтому
 * новые колонки досыпаются через ALTER TABLE, а отсутствие UNIQUE на
 * daily_menu_items (его через ALTER не добавить) — фатальная ошибка.
 * [EN] CREATE TABLE IF NOT EXISTS does not retrofit schema changes, so new
 * columns are added via ALTER TABLE, and a missing UNIQUE on daily_menu_items
 * (which ALTER cannot add) is a fatal error.
 *
 * @returns {Promise<void>}
 */
async function initDb() {
  for (const sql of TABLES) {
    await dbRun(sql);
  }
  await addMissingColumns('user_preferences', USER_PREFERENCES_ADDED_COLUMNS);
  for (const [table, columns] of Object.entries(CATALOG_ADDED_COLUMNS)) {
    await addMissingColumns(table, columns);
  }
  await migrateLegacyExclusions();
  await assertDailyMenuItemsUnique();
}

module.exports = { initDb };
