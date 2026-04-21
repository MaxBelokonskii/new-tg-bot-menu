const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const dbPath = path.resolve(process.env.DATABASE_PATH || './database/bot.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error connecting to the database:', err.message);
  } else {
    console.log('Connected to the SQLite database.');
  }
});

// SQLite отключает проверку внешних ключей по умолчанию — включаем явно
// в каждом соединении, чтобы CASCADE и foreign_key_check работали корректно.
db.run('PRAGMA foreign_keys = ON', (err) => {
  if (err) console.error('Error enabling foreign keys:', err.message);
});

const initDb = () => {
  db.serialize(() => {
    // 1. users
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER NOT NULL UNIQUE,
      username TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 2. meal_categories
    db.run(`CREATE TABLE IF NOT EXISTS meal_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    )`);

    // 3. recipes
    db.run(`CREATE TABLE IF NOT EXISTS recipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      category_id INTEGER NOT NULL,
      description TEXT,
      calories INTEGER NOT NULL,
      protein REAL NOT NULL,
      fat REAL NOT NULL,
      carbs REAL NOT NULL,
      FOREIGN KEY (category_id) REFERENCES meal_categories(id)
    )`);

    // 4. ingredients
    db.run(`CREATE TABLE IF NOT EXISTS ingredients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL
    )`);

    // 5. recipe_ingredients
    db.run(`CREATE TABLE IF NOT EXISTS recipe_ingredients (
      recipe_id INTEGER NOT NULL,
      ingredient_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      unit TEXT NOT NULL,
      PRIMARY KEY (recipe_id, ingredient_id),
      FOREIGN KEY (recipe_id) REFERENCES recipes(id),
      FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
    )`);

    // 6. daily_menu
    db.run(`CREATE TABLE IF NOT EXISTS daily_menu (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      date DATE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, date),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // 7. daily_menu_items
    db.run(`CREATE TABLE IF NOT EXISTS daily_menu_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      daily_menu_id INTEGER NOT NULL,
      recipe_id INTEGER NOT NULL,
      slot INTEGER NOT NULL,
      UNIQUE (daily_menu_id, slot),
      FOREIGN KEY (daily_menu_id) REFERENCES daily_menu(id),
      FOREIGN KEY (recipe_id) REFERENCES recipes(id)
    )`);

    // 8. weekly_menu
    db.run(`CREATE TABLE IF NOT EXISTS weekly_menu (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      week_start DATE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, week_start),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // 9. weekly_menu_days
    db.run(`CREATE TABLE IF NOT EXISTS weekly_menu_days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      weekly_menu_id INTEGER NOT NULL,
      date DATE NOT NULL,
      daily_menu_id INTEGER NOT NULL,
      FOREIGN KEY (weekly_menu_id) REFERENCES weekly_menu(id),
      FOREIGN KEY (daily_menu_id) REFERENCES daily_menu(id)
    )`);

    // 10. user_preferences
    db.run(`CREATE TABLE IF NOT EXISTS user_preferences (
      user_id INTEGER PRIMARY KEY,
      exclude_ingredients TEXT,
      target_calories INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // 11. shopping_lists
    db.run(`CREATE TABLE IF NOT EXISTS shopping_lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS shopping_list_items (
      shopping_list_id INTEGER NOT NULL,
      ingredient_id INTEGER NOT NULL,
      total_amount REAL NOT NULL,
      unit TEXT NOT NULL,
      PRIMARY KEY (shopping_list_id, ingredient_id),
      FOREIGN KEY (shopping_list_id) REFERENCES shopping_lists(id),
      FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
    )`);
  });
};

module.exports = {
  db,
  initDb
};
