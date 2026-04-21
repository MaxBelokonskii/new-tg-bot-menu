#!/usr/bin/env node
/**
 * Destructive full reset of the SQLite database: renames any existing
 * bot.db to a timestamped backup (no data is deleted from disk), then
 * runs migrate.js from scratch so the fresh DB receives the current
 * schema (UNIQUE constraints, FK pragma) and the current normalized
 * ingredient/unit aliases.
 *
 * Intended for developers after schema or alias-dictionary changes.
 * Not part of the bot startup path.
 *
 * Usage: node scripts/reset-db.js
 *        DATABASE_PATH=./custom.db node scripts/reset-db.js
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
require('dotenv').config();

const dbPath = path.resolve(process.env.DATABASE_PATH || './database/bot.db');
const migrateScript = path.join(__dirname, '..', 'src', 'database', 'migrate.js');

// [RU] Предупреждение: на Linux/macOS rename открытого файла проходит, но бот
// продолжит писать в переименованный handle — бэкап может оказаться непоследовательным.
// Останавливать бот до запуска db:reset — на ответственности разработчика.
// [EN] Warning: on Linux/macOS rename succeeds even with an open handle; a running
// bot keeps writing to the renamed inode, which may leave the backup in an
// inconsistent state. Stop the bot before running db:reset.
console.warn('[db:reset] If the bot process is running, stop it first — otherwise the backup may end up inconsistent.\n');

if (fs.existsSync(dbPath)) {
  const backup = `${dbPath}.bak.${Date.now()}`;
  fs.renameSync(dbPath, backup);
  console.log(`Backed up existing DB: ${backup}`);
} else {
  console.log(`No existing DB at ${dbPath} — creating from scratch.`);
}

const result = spawnSync('node', [migrateScript], { stdio: 'inherit' });
if (result.error) {
  console.error('Failed to spawn migrate.js:', result.error.message);
}
process.exit(result.status ?? 1);
