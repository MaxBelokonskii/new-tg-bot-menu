const { AsyncLocalStorage } = require('async_hooks');

/**
 * Builds promise-based helpers around a node-sqlite3 connection.
 *
 * node-sqlite3 runs everything on a single connection, so a transaction opened
 * by one async flow would silently swallow writes issued by another flow while
 * it is open (and lose them on ROLLBACK). To keep transactions isolated, every
 * write goes through one process-wide queue:
 *   - `serializeWrite(fn)` runs `fn` exclusively;
 *   - `withTransaction(fn)` runs `fn` exclusively inside BEGIN/COMMIT/ROLLBACK;
 *   - `dbRun` outside of those blocks is queued as a single-statement write.
 * Reads (`dbGet`/`dbAll`) are never queued.
 *
 * Nested calls are re-entrant: AsyncLocalStorage marks the async context that
 * already holds the queue, so `dbRun` / `serializeWrite` / `withTransaction`
 * called from inside run inline instead of deadlocking. A nested
 * `withTransaction` joins the outer transaction.
 *
 * @param {import('sqlite3').Database} conn
 * @returns {{
 *   dbGet: (sql: string, params?: Array) => Promise<object|undefined>,
 *   dbAll: (sql: string, params?: Array) => Promise<Array<object>>,
 *   dbRun: (sql: string, params?: Array) => Promise<{lastID: number, changes: number}>,
 *   serializeWrite: <T>(fn: () => Promise<T>) => Promise<T>,
 *   withTransaction: <T>(fn: () => Promise<T>) => Promise<T>
 * }}
 */
function createDbHelpers(conn) {
  const writeContext = new AsyncLocalStorage();
  let queue = Promise.resolve();

  const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    conn.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });

  const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    conn.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });

  const rawRun = (sql, params = []) => new Promise((resolve, reject) => {
    conn.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });

  function serializeWrite(fn) {
    const state = writeContext.getStore();
    if (state) return Promise.resolve().then(fn);

    const prev = queue;
    let release;
    queue = new Promise(resolve => { release = resolve; });
    return (async () => {
      try {
        // [RU] Падение предыдущей операции не должно блокировать очередь.
        // [EN] A failure of the previous holder must not block the queue.
        await prev.catch(() => {});
        return await writeContext.run({ inTransaction: false }, fn);
      } finally {
        release();
      }
    })();
  }

  const dbRun = (sql, params = []) => serializeWrite(() => rawRun(sql, params));

  function withTransaction(fn) {
    const state = writeContext.getStore();
    if (state && state.inTransaction) return Promise.resolve().then(fn);

    return serializeWrite(async () => {
      writeContext.getStore().inTransaction = true;
      await rawRun('BEGIN IMMEDIATE');
      try {
        const result = await fn();
        await rawRun('COMMIT');
        return result;
      } catch (err) {
        await rawRun('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        writeContext.getStore().inTransaction = false;
      }
    });
  }

  return { dbGet, dbAll, dbRun, serializeWrite, withTransaction };
}

module.exports = { createDbHelpers };
