#!/usr/bin/env node
/**
 * One-off cleanup of known garbage seeded during early development:
 *   - meal_categories row "Test" (id arbitrary) and its three recipes "Test Recipe"
 *   - daily_menu rows dated 2020-01-01 (clearly historic test fixtures)
 *
 * Idempotent: re-running on a clean DB does nothing. Runs inside a single
 * transaction with --dry-run support so it can be previewed on production.
 *
 * Usage: node scripts/delete-test-garbage.js [--dry-run]
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const DRY_RUN = process.argv.includes('--dry-run');
const dbPath = path.resolve(process.env.DATABASE_PATH || './database/bot.db');
const db = new sqlite3.Database(dbPath);

const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) {
    if (err) reject(err);
    else resolve(this.changes);
  });
});
const get = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
});

// [RU] Дети удаляются до родителей — FK=ON блокировал бы обратное.
// [EN] Children before parents — FK=ON would reject the inverse order.
const STEPS = [
  {
    label: 'daily_menu_items referencing Test recipes',
    count:  `SELECT COUNT(*) AS c FROM daily_menu_items
             WHERE recipe_id IN (SELECT id FROM recipes WHERE name = 'Test Recipe')`,
    delete: `DELETE FROM daily_menu_items
             WHERE recipe_id IN (SELECT id FROM recipes WHERE name = 'Test Recipe')`
  },
  {
    label: 'recipe_ingredients for Test recipes',
    count:  `SELECT COUNT(*) AS c FROM recipe_ingredients
             WHERE recipe_id IN (SELECT id FROM recipes WHERE name = 'Test Recipe')`,
    delete: `DELETE FROM recipe_ingredients
             WHERE recipe_id IN (SELECT id FROM recipes WHERE name = 'Test Recipe')`
  },
  {
    label: 'recipes named "Test Recipe"',
    count:  `SELECT COUNT(*) AS c FROM recipes WHERE name = 'Test Recipe'`,
    delete: `DELETE FROM recipes WHERE name = 'Test Recipe'`
  },
  {
    label: 'meal_categories "Test"',
    count:  `SELECT COUNT(*) AS c FROM meal_categories WHERE name = 'Test'`,
    delete: `DELETE FROM meal_categories WHERE name = 'Test'`
  },
  {
    label: 'daily_menu_items under historic daily_menu (date < 2023-01-01)',
    count:  `SELECT COUNT(*) AS c FROM daily_menu_items
             WHERE daily_menu_id IN (SELECT id FROM daily_menu WHERE date < '2023-01-01')`,
    delete: `DELETE FROM daily_menu_items
             WHERE daily_menu_id IN (SELECT id FROM daily_menu WHERE date < '2023-01-01')`
  },
  {
    label: 'daily_menu with date < 2023-01-01 (stale test fixtures)',
    count:  `SELECT COUNT(*) AS c FROM daily_menu WHERE date < '2023-01-01'`,
    delete: `DELETE FROM daily_menu WHERE date < '2023-01-01'`
  }
];

async function main() {
  console.log(`DB: ${dbPath}`);
  console.log(DRY_RUN ? 'Mode: DRY RUN (no changes)\n' : 'Mode: APPLY\n');

  await run('PRAGMA foreign_keys = ON');
  await run('BEGIN TRANSACTION');

  try {
    let total = 0;
    for (const step of STEPS) {
      const { c } = await get(step.count);
      if (c === 0) {
        console.log(`  OK  ${step.label}: 0`);
        continue;
      }
      if (DRY_RUN) {
        console.log(`  WOULD DELETE ${c} rows — ${step.label}`);
      } else {
        const changes = await run(step.delete);
        console.log(`  DELETED ${changes} rows — ${step.label}`);
      }
      total += c;
    }

    if (DRY_RUN) {
      await run('ROLLBACK');
      console.log(`\nDry run done. Would delete ${total} rows.`);
    } else {
      await run('COMMIT');
      console.log(`\nCleanup done. Deleted ${total} rows.`);
    }
  } catch (err) {
    await run('ROLLBACK').catch(() => {});
    throw err;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.close());
