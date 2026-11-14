const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const { createDbHelpers } = require('../../src/utils/db-helpers');

let h;

beforeEach(async () => {
  h = createDbHelpers(new sqlite3.Database(':memory:'));
  await h.dbRun('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)');
});

const values = async () => (await h.dbAll('SELECT v FROM t ORDER BY id')).map(r => r.v);
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

test('dbRun returns lastID and changes; dbGet/dbAll read rows', async () => {
  const first = await h.dbRun('INSERT INTO t (v) VALUES (?)', ['a']);
  const second = await h.dbRun('INSERT INTO t (v) VALUES (?)', ['b']);
  assert.equal(first.lastID, 1);
  assert.equal(second.lastID, 2);
  const upd = await h.dbRun('UPDATE t SET v = ?', ['x']);
  assert.equal(upd.changes, 2);
  assert.deepEqual(await h.dbGet('SELECT v FROM t WHERE id = ?', [1]), { v: 'x' });
  assert.equal(await h.dbGet('SELECT v FROM t WHERE id = ?', [99]), undefined);
});

test('query errors reject', async () => {
  await assert.rejects(h.dbAll('SELECT * FROM missing'), /no such table/);
  await assert.rejects(h.dbRun('INSERT INTO missing VALUES (1)'), /no such table/);
});

test('withTransaction commits and returns the callback result', async () => {
  const result = await h.withTransaction(async () => {
    await h.dbRun("INSERT INTO t (v) VALUES ('a')");
    return 42;
  });
  assert.equal(result, 42);
  assert.deepEqual(await values(), ['a']);
});

test('withTransaction rolls back on error and rethrows', async () => {
  await assert.rejects(h.withTransaction(async () => {
    await h.dbRun("INSERT INTO t (v) VALUES ('a')");
    throw new Error('boom');
  }), /boom/);
  assert.deepEqual(await values(), []);
});

test('writes issued during a transaction wait and survive its rollback', async () => {
  const tx = h.withTransaction(async () => {
    await h.dbRun("INSERT INTO t (v) VALUES ('in-tx')");
    await delay(20);
    throw new Error('rollback');
  });
  // [RU] Стартует, пока транзакция открыта: не должна попасть в неё.
  // [EN] Issued while the transaction is open: must not join it.
  const outside = h.dbRun("INSERT INTO t (v) VALUES ('outside')");
  await assert.rejects(tx, /rollback/);
  await outside;
  assert.deepEqual(await values(), ['outside']);
});

test('nested serializeWrite/withTransaction run inline without deadlock', async () => {
  await h.withTransaction(async () => {
    await h.serializeWrite(() => h.dbRun("INSERT INTO t (v) VALUES ('a')"));
    await h.withTransaction(() => h.dbRun("INSERT INTO t (v) VALUES ('b')"));
  });
  await h.serializeWrite(() => h.withTransaction(() => h.dbRun("INSERT INTO t (v) VALUES ('c')")));
  assert.deepEqual(await values(), ['a', 'b', 'c']);
});

test('nested transaction failure rolls back the outer transaction', async () => {
  await assert.rejects(h.withTransaction(async () => {
    await h.dbRun("INSERT INTO t (v) VALUES ('a')");
    await h.withTransaction(async () => { throw new Error('inner'); });
  }), /inner/);
  assert.deepEqual(await values(), []);
});

test('concurrent transactions are serialized', async () => {
  const order = [];
  const run = (name) => h.withTransaction(async () => {
    order.push(`${name}:start`);
    await delay(5);
    await h.dbRun('INSERT INTO t (v) VALUES (?)', [name]);
    order.push(`${name}:end`);
  });
  await Promise.all([run('a'), run('b')]);
  assert.deepEqual(order, ['a:start', 'a:end', 'b:start', 'b:end']);
});

test('queue keeps working after a failed write', async () => {
  await assert.rejects(h.serializeWrite(async () => { throw new Error('fail'); }));
  await h.dbRun("INSERT INTO t (v) VALUES ('after')");
  assert.deepEqual(await values(), ['after']);
});
