// [RU] Подключать ПЕРВЫМ require в test-файле: переключает приложение на
// in-memory SQLite до того, как src/database/db.js откроет соединение.
// node --test запускает каждый файл отдельным процессом — БД у файлов не общая.
// [EN] Must be the FIRST require in a test file: switches the app to an
// in-memory SQLite before src/database/db.js opens its connection.
// node --test runs each file in its own process, so files never share a DB.
process.env.DATABASE_PATH = ':memory:';

const { migrate } = require('../../src/database/migrate');

require('../../src/utils/logger').silent = true;

/**
 * Creates the schema and seeds recipes from database/recipes.json into the
 * in-memory DB, muting migrate's progress output.
 * @returns {Promise<void>}
 */
async function seedDb() {
  const originalLog = console.log;
  console.log = () => {};
  try {
    await migrate();
  } finally {
    console.log = originalLog;
  }
}

module.exports = { seedDb };
