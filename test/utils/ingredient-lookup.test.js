const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveIngredientName,
  suggestIngredients,
  parseIngredientList
} = require('../../src/utils/ingredient-lookup');

test('resolves canonical names, aliases and the "*" unit rule case-insensitively', () => {
  assert.equal(resolveIngredientName('Сыр'), 'Сыр');
  assert.equal(resolveIngredientName('сыр 9%'), 'Сыр');
  assert.equal(resolveIngredientName('МОЦАРЕЛЛА'), 'Сыр моцарелла');
  assert.equal(resolveIngredientName('лук'), 'Лук репчатый');
  assert.equal(resolveIngredientName('перец'), 'Перец черный');
  assert.equal(resolveIngredientName('  творог '), 'Творог');
});

test('resolves plural / ё spellings by an unambiguous stem', () => {
  assert.equal(resolveIngredientName('помидоры'), 'Помидор');
  assert.equal(resolveIngredientName('яйца'), 'Яйцо');
  assert.equal(resolveIngredientName('перец чёрный'), 'Перец черный');
  assert.equal(resolveIngredientName('абракадабра'), null);
  assert.equal(resolveIngredientName(''), null);
});

test('suggests canonical names by word prefix for unknown input', () => {
  assert.deepEqual(suggestIngredients('курица'), ['Куриное филе', 'Куриные бедра', 'Куриный фарш']);
  assert.deepEqual(suggestIngredients('огурцы'), ['Огурец']);
  assert.deepEqual(suggestIngredients('ж'), []);
});

test('parseIngredientList dedupes, keeps order and returns unknown tokens', () => {
  assert.deepEqual(
    parseIngredientList('помидоры, Сыр 20%; сыр\nкурица, , лук'),
    { canonical: ['Помидор', 'Сыр', 'Лук репчатый'], unknown: ['курица'] }
  );
  assert.deepEqual(parseIngredientList(''), { canonical: [], unknown: [] });
});
