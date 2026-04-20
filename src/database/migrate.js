const fs = require('fs');
const path = require('path');
const { db, initDb } = require('./db');

/**
 * Парсит строку количества ингредиента (например, "100 г", "3 шт", "по вкусу")
 * @param {string} amountStr
 * @returns {{amount: number, unit: string}}
 */
function parseAmount(amountStr) {
  if (!amountStr) return { amount: 0, unit: 'не указано' };

  // Обработка "по вкусу" и подобных строк без цифр
  const match = amountStr.match(/^([\d.,/]+)\s*(.*)$/);
  if (!match) {
    return { amount: 0, unit: amountStr };
  }

  let amount = parseFloat(match[1].replace(',', '.'));
  // Обработка дробей типа "1/2"
  if (match[1].includes('/')) {
    const parts = match[1].split('/');
    if (parts.length === 2) {
      amount = parseFloat(parts[0]) / parseFloat(parts[1]);
    }
  }

  const unit = match[2].trim() || 'шт';
  return { amount: isNaN(amount) ? 0 : amount, unit };
}

async function migrate() {
  console.log('Starting migration...');

  // Инициализируем БД (создаем таблицы, если их нет)
  initDb();

  const jsonPath = path.resolve(__dirname, '../../database/recipes.json');
  const rawData = fs.readFileSync(jsonPath, 'utf8');
  const { recipes } = JSON.parse(rawData);

  console.log(`Loaded ${recipes.length} recipes from JSON.`);

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    try {
      // 1. Собираем уникальные категории
      const categories = [...new Set(recipes.map(r => r.category))];
      const categoryStmt = db.prepare('INSERT OR IGNORE INTO meal_categories (name) VALUES (?)');
      categories.forEach(cat => categoryStmt.run(cat));
      categoryStmt.finalize();
      console.log(`Processed ${categories.length} categories.`);

      // 2. Собираем уникальные ингредиенты
      const ingredientMap = new Map(); // name -> id (will be filled after insert)
      const allIngredients = new Set();
      recipes.forEach(r => {
        r.ingredients.forEach(i => allIngredients.add(i.item));
      });

      const ingStmt = db.prepare('INSERT OR IGNORE INTO ingredients (name, type) VALUES (?, ?)');
      allIngredients.forEach(ing => ingStmt.run(ing, 'general'));
      ingStmt.finalize();
      console.log(`Processed ${allIngredients.size} unique ingredients.`);

      // 3. Вставляем рецепты и связи
      recipes.forEach((recipe, index) => {
        // Получаем category_id
        db.get('SELECT id FROM meal_categories WHERE name = ?', [recipe.category], (err, catRow) => {
          if (err || !catRow) {
            console.error(`Category not found: ${recipe.category}`);
            return;
          }

          const nutrition = recipe.nutrition_per_serving || recipe.nutrition;

          db.run(
            `INSERT INTO recipes (name, category_id, description, calories, protein, fat, carbs) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              recipe.name,
              catRow.id,
              recipe.description,
              nutrition.calories || 0,
              nutrition.proteins || nutrition.protein || 0, // в JSON proteins, в БД protein
              nutrition.fats || nutrition.fat || 0,         // в JSON fats, в БД fat
              nutrition.carbs || 0
            ],
            function(err) {
              if (err) {
                console.error(`Error inserting recipe ${recipe.name}:`, err.message);
                return;
              }
              const recipeId = this.lastID;

              // Вставляем ингредиенты для этого рецепта
              recipe.ingredients.forEach(ing => {
                db.get('SELECT id FROM ingredients WHERE name = ?', [ing.item], (err, ingRow) => {
                  if (err || !ingRow) {
                    console.error(`Ingredient not found: ${ing.item}`);
                    return;
                  }

                  const { amount, unit } = parseAmount(ing.amount);
                  db.run(
                    'INSERT INTO recipe_ingredients (recipe_id, ingredient_id, amount, unit) VALUES (?, ?, ?, ?)',
                    [recipeId, ingRow.id, amount, unit],
                    (err) => {
                      if (err) {
                        console.error(`Error linking ingredient ${ing.item} to recipe ${recipe.name}:`, err.message);
                      }
                    }
                  );
                });
              });
            }
          );
        });

        if ((index + 1) % 50 === 0) {
          console.log(`Processed ${index + 1} recipes...`);
        }
      });

      db.run('COMMIT', (err) => {
        if (err) {
          console.error('Error committing transaction:', err.message);
        } else {
          console.log('Migration completed successfully!');
        }
      });

    } catch (error) {
      db.run('ROLLBACK');
      console.error('Migration failed, transaction rolled back:', error);
    }
  });
}

// Запуск миграции
// Даем немного времени на открытие БД, если это необходимо,
// хотя sqlite3 открывает её синхронно/через колбэк.
migrate();
