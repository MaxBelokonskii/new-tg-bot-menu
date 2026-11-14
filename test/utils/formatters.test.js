const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatNutrition } = require('../../src/utils/formatters');

test('formatNutrition renders the КБЖУ line', () => {
  assert.equal(
    formatNutrition({ calories: 350, protein: 20.5, fat: 10, carbs: 40 }),
    'КБЖУ: 350 / 20.5 / 10 / 40'
  );
});

test('formatQuantity rounds pieces up and switches to kg/l', () => {
  const { formatQuantity } = require('../../src/utils/formatters');
  assert.equal(formatQuantity(0.5, 'шт'), '1 шт');
  assert.equal(formatQuantity(3, 'шт'), '3 шт');
  assert.equal(formatQuantity(0.3, 'г'), '1 г');
  assert.equal(formatQuantity(249.6, 'г'), '250 г');
  assert.equal(formatQuantity(1250, 'г'), '1,3 кг');
  assert.equal(formatQuantity(1000, 'мл'), '1 л');
});

test('formatShoppingQuantity handles to-taste rows', () => {
  const { formatShoppingQuantity } = require('../../src/utils/formatters');
  assert.equal(formatShoppingQuantity({ total_amount: 0, unit: '', to_taste: true }), 'по вкусу');
  assert.equal(formatShoppingQuantity({ total_amount: 5, unit: 'г', to_taste: true }), '5 г + по вкусу');
  assert.equal(formatShoppingQuantity({ total_amount: 200, unit: 'мл', to_taste: false }), '200 мл');
});

test('formatShoppingList marks a list whose period is over', () => {
  const { formatShoppingList } = require('../../src/interface/shopping-list');
  const list = {
    items: [{ name: 'Соль', type: 'Специи и приправы', total_amount: 0, unit: '', to_taste: true }],
    periodStart: '2026-11-09',
    periodEnd: '2026-11-16'
  };
  assert.ok(!formatShoppingList(list, '2026-11-15').includes('⚠️'));
  assert.ok(formatShoppingList(list, '2026-11-16').includes('⚠️'));
  assert.ok(formatShoppingList(list, '2026-11-15').includes('• Соль: по вкусу'));
});
