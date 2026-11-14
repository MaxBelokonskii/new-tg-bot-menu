require('../helpers/memory-db');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { dbAll, dbRun } = require('../../src/database/db');
const { initDb } = require('../../src/database/schema');

const columnsOf = async (table) => (await dbAll(`PRAGMA table_info(${table})`)).map(c => c.name);

test('initDb adds household_size to users and shopping_lists of an old database', async () => {
  // [RU] Таблицы в виде до фичи «готовлю на N человек» — без household_size.
  // [EN] Tables as they were before the household feature — no household_size.
  await dbRun(`CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL UNIQUE,
    username TEXT,
    utc_offset_minutes INTEGER NOT NULL DEFAULT 180,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await dbRun(`CREATE TABLE shopping_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
  await dbRun('INSERT INTO users (telegram_id) VALUES (1)');
  await dbRun("INSERT INTO shopping_lists (user_id, period_start, period_end) VALUES (1, '2026-11-09', '2026-11-16')");

  await initDb();
  await initDb();

  assert.ok((await columnsOf('users')).includes('household_size'));
  assert.ok((await columnsOf('shopping_lists')).includes('household_size'));
  assert.deepEqual(await dbAll('SELECT household_size FROM users'), [{ household_size: 1 }]);
  assert.deepEqual(await dbAll('SELECT household_size FROM shopping_lists'), [{ household_size: 1 }]);
});
