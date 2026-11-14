const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveIngredient,
  mergeRecipeRows,
  canonicalName,
  isDirtyName
} = require('../../src/database/ingredient-normalizer');
const { buildReport } = require('../../scripts/audit-ingredients');
const { recipes } = require('../../database/recipes.json');

test('compound entries split into canonical parts', () => {
  assert.deepEqual(
    resolveIngredient({ item: 'Соль, перец', amount: 'по вкусу' }).map(r => r.name),
    ['Соль', 'Перец черный']
  );
  assert.deepEqual(
    resolveIngredient({ item: 'Орехи, сухофрукты', amount: '10 г' }),
    [
      { name: 'Орехи', amount: 5, unit: 'г' },
      { name: 'Сухофрукты', amount: 5, unit: 'г' }
    ]
  );
});

test('alternatives take the first option, then aliases apply', () => {
  assert.equal(canonicalName('Йогурт или сметана', 'г'), 'Йогурт');
  assert.equal(canonicalName('Миндаль/фундук', 'шт'), 'Миндаль');
  assert.equal(canonicalName('Перец черный/красный', 'по вкусу'), 'Перец черный');
});

test('ambiguous "Перец" resolves by unit', () => {
  assert.equal(canonicalName('Перец', 'по вкусу'), 'Перец черный');
  assert.equal(canonicalName('Перец', 'шт'), 'Болгарский перец');
});

test('cheese variants fold into "Сыр", kinds stay separate', () => {
  for (const name of ['Сыр 9%', 'Сыр 45%', 'Сыр нежирный', 'Сыр тертый']) {
    assert.equal(canonicalName(name, 'г'), 'Сыр');
  }
  assert.equal(canonicalName('Сыр филадельфия', 'г'), 'Творожный сыр');
  assert.equal(canonicalName('Сыр фета', 'г'), 'Сыр фета');
});

test('collisions inside a recipe are summed, not dropped', () => {
  const { rows, conflicts } = mergeRecipeRows([
    { name: 'Соль', amount: 0, unit: 'по вкусу' },
    { name: 'Сыр', amount: 50, unit: 'г' },
    { name: 'Сыр', amount: 30, unit: 'г' },
    { name: 'Соль', amount: 5, unit: 'г' }
  ]);
  assert.deepEqual(rows, [
    { name: 'Соль', amount: 5, unit: 'г' },
    { name: 'Сыр', amount: 80, unit: 'г' }
  ]);
  assert.deepEqual(conflicts, []);
});

test('unmergeable units are reported', () => {
  const { rows, conflicts } = mergeRecipeRows([
    { name: 'Молоко', amount: 200, unit: 'мл' },
    { name: 'Молоко', amount: 2, unit: 'ст. л.' }
  ]);
  assert.equal(rows.length, 1);
  assert.equal(conflicts.length, 1);
});

test('isDirtyName flags compound and alternative names', () => {
  assert.ok(isDirtyName('Соль, перец'));
  assert.ok(isDirtyName('Яблоко или груша'));
  assert.ok(isDirtyName('Миндаль/фундук'));
  assert.ok(!isDirtyName('Сыр моцарелла'));
});

test('audit on the real catalog: no compound, untyped or colliding names', () => {
  const { lines } = buildReport(recipes);
  const report = lines.join('\n');
  for (const title of ['Compound', 'Missing in ingredient-types', 'Unmergeable collisions']) {
    assert.match(report, new RegExp(`## ${title}[^\\n]*\\(0\\)`), title);
  }
});
