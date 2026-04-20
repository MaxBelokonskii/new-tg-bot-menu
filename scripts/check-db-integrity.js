#!/usr/bin/env node
/**
 * Diagnostic script: verifies foreign-key integrity of the SQLite database.
 * Uses the same connection as the bot (src/database/db.js) so the reported
 * PRAGMA foreign_keys reflects what the application actually sees at runtime.
 * Prints the pragma value, any rows failing foreign_key_check, and total row
 * counts per table. Exits with code 1 if violations are found or FK is OFF —
 * useful for CI / pre-commit checks.
 */

require('dotenv').config();
const { db } = require('../src/database/db');

const all = (sql) => new Promise((resolve, reject) => {
  db.all(sql, (err, rows) => (err ? reject(err) : resolve(rows)));
});

const TABLES = [
  'users', 'meal_categories', 'recipes', 'ingredients',
  'recipe_ingredients', 'daily_menu', 'daily_menu_items',
  'weekly_menu', 'weekly_menu_days', 'user_preferences',
  'shopping_lists', 'shopping_list_items'
];

async function main() {
  const [pragma] = await all('PRAGMA foreign_keys');
  const fkOn = pragma.foreign_keys === 1;
  console.log(`PRAGMA foreign_keys = ${pragma.foreign_keys} ` +
    `(${fkOn ? 'ON' : 'OFF — должно быть ON'})\n`);

  const violations = await all('PRAGMA foreign_key_check');
  if (violations.length === 0) {
    console.log('Foreign key check: OK (0 violations)\n');
  } else {
    console.log(`Foreign key check: FAILED (${violations.length} violations)`);
    const summary = violations.reduce((acc, v) => {
      const key = `${v.table} → ${v.parent}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    Object.entries(summary).forEach(([k, n]) => console.log(`  ${k}: ${n}`));
    console.log();
  }

  console.log('Row counts:');
  for (const t of TABLES) {
    const [{ c }] = await all(`SELECT COUNT(*) AS c FROM ${t}`);
    console.log(`  ${t.padEnd(22)} ${c}`);
  }

  db.close();
  process.exit(fkOn && violations.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
