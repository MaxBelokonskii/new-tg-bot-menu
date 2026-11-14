const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatNutrition } = require('../../src/utils/formatters');

test('formatNutrition renders the КБЖУ line', () => {
  assert.equal(
    formatNutrition({ calories: 350, protein: 20.5, fat: 10, carbs: 40 }),
    'КБЖУ: 350 / 20.5 / 10 / 40'
  );
});
