const { seedDb } = require('../helpers/memory-db');
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { dbAll } = require('../../src/database/db');
const {
  PAGE_SIZE, paginate, isFavorite, setFavorite, listFavorites
} = require('../../src/features/favorite-recipes/logic');
const { flipFavoriteButton, favoriteButton } = require('../../src/interface/favorite-recipes');

const USER = 7101;
const OTHER = 7102;
let ids;

before(async () => {
  await seedDb();
  ids = (await dbAll('SELECT id FROM recipes ORDER BY id LIMIT 12')).map(r => r.id);
});

test('paginate clamps the page and always has at least one page', () => {
  assert.deepEqual(paginate(0, 0), { page: 0, pages: 1, offset: 0 });
  assert.deepEqual(paginate(8, 1), { page: 0, pages: 1, offset: 0 });
  assert.deepEqual(paginate(9, 1), { page: 1, pages: 2, offset: PAGE_SIZE });
  assert.deepEqual(paginate(9, 5), { page: 1, pages: 2, offset: PAGE_SIZE });
  assert.deepEqual(paginate(9, -3), { page: 0, pages: 2, offset: 0 });
  assert.deepEqual(paginate(9, NaN), { page: 0, pages: 2, offset: 0 });
});

test('add and remove are idempotent; unknown recipe returns null', async () => {
  const [a] = ids;
  assert.equal(await isFavorite(USER, a), false);
  assert.equal(await setFavorite(USER, a, true), true);
  assert.equal(await setFavorite(USER, a, true), true);
  assert.equal((await listFavorites(USER)).total, 1, 'second add keeps one row');
  assert.equal(await isFavorite(USER, a), true);
  assert.equal(await isFavorite(OTHER, a), false, 'favorites are per user');

  assert.equal(await setFavorite(USER, a, false), false);
  assert.equal(await setFavorite(USER, a, false), false);
  assert.equal(await isFavorite(USER, a), false);
  assert.equal((await listFavorites(USER)).total, 0);

  assert.equal(await setFavorite(USER, 999999, true), null);
  assert.equal((await listFavorites(USER)).total, 0);
});

test('list is newest first; a re-added recipe moves to the top', async () => {
  const [a, b, c] = ids;
  for (const id of [a, b, c]) await setFavorite(OTHER, id, true);
  let list = await listFavorites(OTHER);
  assert.deepEqual(list.recipes.map(r => r.id), [c, b, a]);
  assert.ok(list.recipes.every(r => typeof r.name === 'string' && typeof r.calories === 'number'));

  await setFavorite(OTHER, a, false);
  await setFavorite(OTHER, a, true);
  list = await listFavorites(OTHER);
  assert.deepEqual(list.recipes.map(r => r.id), [a, c, b]);
  for (const id of [a, b, c]) await setFavorite(OTHER, id, false);
});

test('list pages hold PAGE_SIZE recipes; out-of-range page is clamped', async () => {
  const nine = ids.slice(0, 9);
  for (const id of nine) await setFavorite(USER, id, true);
  const first = await listFavorites(USER, 0);
  assert.equal(first.total, 9);
  assert.equal(first.pages, 2);
  assert.equal(first.recipes.length, PAGE_SIZE);
  assert.deepEqual(first.recipes.map(r => r.id), nine.slice(1).reverse());

  const second = await listFavorites(USER, 1);
  assert.deepEqual(second.recipes.map(r => r.id), [nine[0]]);
  assert.equal((await listFavorites(USER, 7)).page, 1);
  for (const id of nine) await setFavorite(USER, id, false);
});

test('flipFavoriteButton swaps only the matching recipe button', () => {
  const markup = {
    inline_keyboard: [
      [{ text: 'next', callback_data: 'select_cat_main' }],
      [{ text: 'ate', callback_data: 'fl_eat_5' }, favoriteButton(5, false)],
      [favoriteButton(6, false)]
    ]
  };
  const flipped = flipFavoriteButton(markup, 5, true);
  assert.deepEqual(flipped.inline_keyboard[0], markup.inline_keyboard[0]);
  assert.equal(flipped.inline_keyboard[1][1].callback_data, 'fav_rm_5');
  assert.equal(flipped.inline_keyboard[2][0].callback_data, 'fav_add_6');
  assert.equal(markup.inline_keyboard[1][1].callback_data, 'fav_add_5', 'input is not mutated');

  assert.equal(flipFavoriteButton(markup, 7, true), null);
  assert.equal(flipFavoriteButton(undefined, 5, true), null);
});
