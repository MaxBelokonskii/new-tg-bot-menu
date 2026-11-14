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
    resolveIngredient({ item: 'Орехи, сухофрукты', amount: '10 г' })
      .map(({ name, amount, unit, amountBase }) => ({ name, amount, unit, amountBase })),
    [
      { name: 'Орехи', amount: 5, unit: 'г', amountBase: 5 },
      { name: 'Сухофрукты', amount: 5, unit: 'г', amountBase: 5 }
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

const row = (item, amount) => resolveIngredient({ item, amount })[0];

test('amounts convert to the ingredient base unit', () => {
  assert.deepEqual(
    [row('Яйцо', '2 шт').amountBase, row('Яйцо', '2 шт').baseUnit], [2, 'шт']
  );
  assert.equal(row('Мед', '1 ст. л.').amountBase, 25);
  assert.equal(row('Молоко', '1 стакан').baseUnit, 'мл');
  assert.equal(row('Сыр', '0,2 кг').amountBase, 200);
  assert.equal(row('Помидор', '300 г').amountBase, 2);
  assert.equal(row('Соль', 'по вкусу').baseUnit, null);
  assert.equal(row('Соль', 'щепотка').baseUnit, null, 'amount 0 means to taste');
});

test('a "(N г)" hint is the total weight for gram-based ingredients', () => {
  assert.equal(row('Рыба', '2 шт (~500 г)').amountBase, 500);
  assert.equal(row('Рыба', '2 шт').amountBase, 800);
});

test('collisions inside a recipe are summed in base units, not dropped', () => {
  const { rows, conflicts } = mergeRecipeRows([
    row('Соль', 'по вкусу'),
    row('Молоко', '200 мл'),
    row('Молоко', '2 ст. л.'),
    row('Соль', '1 ч. л.'),
    row('Сыр', '50 г'),
    row('Сыр', '30 г')
  ]);
  const byName = Object.fromEntries(rows.map(r => [r.name, r]));
  assert.equal(byName['Соль'].amountBase, 7);
  assert.equal(byName['Молоко'].amountBase, 230);
  assert.equal(byName['Молоко'].unit, 'мл');
  assert.equal(byName['Сыр'].amount, 80);
  assert.equal(byName['Сыр'].unit, 'г');
  assert.deepEqual(conflicts, []);
});

test('units without a factor are reported', () => {
  const { conflicts } = mergeRecipeRows([row('Сыр', '1 горсть')]);
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
  for (const title of ['Compound', 'Missing in ingredient-types', 'Units without a conversion factor']) {
    assert.match(report, new RegExp(`## ${title}[^\\n]*\\(0\\)`), title);
  }
});
