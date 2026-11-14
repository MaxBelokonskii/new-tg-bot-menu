const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateMacroTargets,
  calculateAutoTargets,
  macrosToCalories,
  isMacroMismatch
} = require('../../src/utils/calculations');

test('calculateMacroTargets: protein by goal, fat 30 % of kcal, carbs take the rest', () => {
  assert.deepEqual(
    calculateMacroTargets({ weight: 70, goal: 'maintain', targetCalories: 2000 }),
    { protein: 98, fat: 67, carbs: 251 }
  );
  assert.equal(calculateMacroTargets({ weight: 70, goal: 'loss', targetCalories: 2000 }).protein, 126);
  assert.equal(calculateMacroTargets({ weight: 70, goal: 'gain', targetCalories: 2000 }).protein, 126);
});

test('calculateMacroTargets: fat never drops below 0.8 g/kg', () => {
  // 30 % от 1500 ккал = 50 г, но 0.8 × 100 кг = 80 г
  assert.deepEqual(
    calculateMacroTargets({ weight: 100, goal: 'loss', targetCalories: 1500 }),
    { protein: 180, fat: 80, carbs: 15 }
  );
});

test('calculateMacroTargets: carbs are clamped to 0 when protein+fat exceed the budget', () => {
  const macros = calculateMacroTargets({ weight: 150, goal: 'gain', targetCalories: 1200 });
  assert.equal(macros.carbs, 0);
  assert.equal(macros.protein, 270);
  assert.equal(macros.fat, 120);
});

test('calculateMacroTargets: unknown goal throws', () => {
  assert.throws(() => calculateMacroTargets({ weight: 70, goal: 'bulk', targetCalories: 2000 }));
});

test('calculateAutoTargets returns calories, slot split and macros consistently', () => {
  const auto = calculateAutoTargets({
    weight: 80, height: 180, age: 30, sex: 'male', activity_level: 'moderate', goal: 'maintain'
  });
  assert.equal(auto.target, 2759);
  assert.equal(auto.slots.main1, Math.round(auto.target * 0.3));
  assert.deepEqual(
    auto.macros,
    calculateMacroTargets({ weight: 80, goal: 'maintain', targetCalories: auto.target })
  );
});

test('macrosToCalories and isMacroMismatch use the 4/9/4 rule and a 10 % threshold', () => {
  assert.equal(macrosToCalories({ protein: 100, fat: 50, carbs: 200 }), 1650);
  assert.equal(isMacroMismatch({ calories: 1650, protein: 100, fat: 50, carbs: 200 }), false);
  assert.equal(isMacroMismatch({ calories: 1800, protein: 100, fat: 50, carbs: 200 }), false);
  assert.equal(isMacroMismatch({ calories: 1900, protein: 100, fat: 50, carbs: 200 }), true);
  assert.equal(isMacroMismatch({ calories: 1400, protein: 100, fat: 50, carbs: 200 }), true);
  assert.equal(isMacroMismatch({ calories: 2000, protein: null, fat: 50, carbs: 200 }), false);
});
