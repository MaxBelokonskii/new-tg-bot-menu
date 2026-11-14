const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();
const { createDbHelpers } = require('../utils/db-helpers');

// [RU] ':memory:' передаём как есть — path.resolve превратил бы его в файл.
// Используется тестами (каждый test-файл — отдельный процесс со своей БД).
// [EN] ':memory:' is passed through untouched — path.resolve would turn it
// into a file path. Used by tests (each test file runs in its own process).
const rawPath = process.env.DATABASE_PATH || './database/bot.db';
const dbPath = rawPath === ':memory:' ? rawPath : path.resolve(rawPath);

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('Error connecting to the database:', err.message);
});

// SQLite отключает проверку внешних ключей по умолчанию — включаем явно
// в каждом соединении, чтобы CASCADE и foreign_key_check работали корректно.
db.run('PRAGMA foreign_keys = ON', (err) => {
  if (err) console.error('Error enabling foreign keys:', err.message);
});

module.exports = {
  db,
  ...createDbHelpers(db)
};
