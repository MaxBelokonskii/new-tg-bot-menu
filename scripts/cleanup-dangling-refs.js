#!/usr/bin/env node
/**
 * Idempotent cleanup of rows that violate foreign keys. Needed because the
 * database was historically opened without `PRAGMA foreign_keys = ON`, so
 * dangling references were allowed to accumulate. The script removes:
 *   - daily_menu rows pointing to non-existent users (and their items)
 *   - daily_menu rows with no items (orphaned skeletons)
 *   - shopping_list_items pointing to non-existent shopping_lists
 *   - shopping_lists pointing to non-existent users (and their items)
 *   - weekly_menu_days pointing to non-existent weekly_menu or daily_menu
 *   - weekly_menu rows pointing to non-existent users
 *   - recipe_ingredients pointing to missing recipes or ingredients
 *   - daily_menu_items pointing to missing recipes
 *
 * Usage: node scripts/cleanup-dangling-refs.js [--dry-run]
 * --dry-run prints counts that would be deleted without touching the DB.
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

const STEPS = [
  {
    label: 'daily_menu_items under daily_menu with missing user',
    count:  `SELECT COUNT(*) AS c FROM daily_menu_items WHERE daily_menu_id IN
             (SELECT id FROM daily_menu WHERE user_id NOT IN (SELECT id FROM users))`,
    delete: `DELETE FROM daily_menu_items WHERE daily_menu_id IN
             (SELECT id FROM daily_menu WHERE user_id NOT IN (SELECT id FROM users))`
  },
  {
    label: 'daily_menu with missing user',
    count:  `SELECT COUNT(*) AS c FROM daily_menu
             WHERE user_id NOT IN (SELECT id FROM users)`,
    delete: `DELETE FROM daily_menu WHERE user_id NOT IN (SELECT id FROM users)`
  },
  {
    label: 'empty daily_menu (no items)',
    count:  `SELECT COUNT(*) AS c FROM daily_menu
             WHERE id NOT IN (SELECT DISTINCT daily_menu_id FROM daily_menu_items)`,
    delete: `DELETE FROM daily_menu
             WHERE id NOT IN (SELECT DISTINCT daily_menu_id FROM daily_menu_items)`
  },
  {
    label: 'daily_menu_items with missing recipe',
    count:  `SELECT COUNT(*) AS c FROM daily_menu_items
             WHERE recipe_id NOT IN (SELECT id FROM recipes)`,
    delete: `DELETE FROM daily_menu_items
             WHERE recipe_id NOT IN (SELECT id FROM recipes)`
  },
  {
    label: 'shopping_list_items with missing shopping_list',
    count:  `SELECT COUNT(*) AS c FROM shopping_list_items
             WHERE shopping_list_id NOT IN (SELECT id FROM shopping_lists)`,
    delete: `DELETE FROM shopping_list_items
             WHERE shopping_list_id NOT IN (SELECT id FROM shopping_lists)`
  },
  {
    label: 'shopping_list_items with missing ingredient',
    count:  `SELECT COUNT(*) AS c FROM shopping_list_items
             WHERE ingredient_id NOT IN (SELECT id FROM ingredients)`,
    delete: `DELETE FROM shopping_list_items
             WHERE ingredient_id NOT IN (SELECT id FROM ingredients)`
  },
  {
    label: 'shopping_lists with missing user',
    count:  `SELECT COUNT(*) AS c FROM shopping_lists
             WHERE user_id NOT IN (SELECT id FROM users)`,
    delete: `DELETE FROM shopping_lists WHERE user_id NOT IN (SELECT id FROM users)`
  },
  {
    label: 'weekly_menu_days with missing weekly_menu',
    count:  `SELECT COUNT(*) AS c FROM weekly_menu_days
             WHERE weekly_menu_id NOT IN (SELECT id FROM weekly_menu)`,
    delete: `DELETE FROM weekly_menu_days
             WHERE weekly_menu_id NOT IN (SELECT id FROM weekly_menu)`
  },
  {
    label: 'weekly_menu_days with missing daily_menu',
    count:  `SELECT COUNT(*) AS c FROM weekly_menu_days
             WHERE daily_menu_id NOT IN (SELECT id FROM daily_menu)`,
    delete: `DELETE FROM weekly_menu_days
             WHERE daily_menu_id NOT IN (SELECT id FROM daily_menu)`
  },
  {
    label: 'weekly_menu with missing user',
    count:  `SELECT COUNT(*) AS c FROM weekly_menu
             WHERE user_id NOT IN (SELECT id FROM users)`,
    delete: `DELETE FROM weekly_menu WHERE user_id NOT IN (SELECT id FROM users)`
  },
  {
    label: 'recipe_ingredients with missing recipe',
    count:  `SELECT COUNT(*) AS c FROM recipe_ingredients
             WHERE recipe_id NOT IN (SELECT id FROM recipes)`,
    delete: `DELETE FROM recipe_ingredients
             WHERE recipe_id NOT IN (SELECT id FROM recipes)`
  },
  {
    label: 'recipe_ingredients with missing ingredient',
    count:  `SELECT COUNT(*) AS c FROM recipe_ingredients
             WHERE ingredient_id NOT IN (SELECT id FROM ingredients)`,
    delete: `DELETE FROM recipe_ingredients
             WHERE ingredient_id NOT IN (SELECT id FROM ingredients)`
  },
  {
    label: 'user_preferences with missing user',
    count:  `SELECT COUNT(*) AS c FROM user_preferences
             WHERE user_id NOT IN (SELECT id FROM users)`,
    delete: `DELETE FROM user_preferences WHERE user_id NOT IN (SELECT id FROM users)`
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

  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
