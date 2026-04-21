// [RU] Чистые функции КБЖУ. Сюда не должны приходить DB/Telegraf-ctx —
// только численные входы. Это позволяет тестировать и переиспользовать
// калькулятор из любой фичи (профиль, недельный план, UI-превью).
// [EN] Pure nutrition math. No DB or Telegraf ctx — numbers in, numbers out —
// so the calculator can be tested and reused from any feature (profile,
// weekly planner, UI preview).

const ACTIVITY_MULTIPLIER = Object.freeze({
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9
});

// [RU] Коэффициенты цели — середина диапазонов из README (loss −15..−20 %,
// gain +10..+15 %).
// [EN] Mid-range coefficients from README (loss −15..−20 %, gain +10..+15 %).
const GOAL_COEFFICIENT = Object.freeze({
  loss: 0.82,
  maintain: 1.0,
  gain: 1.125
});

// [RU] Пропорции распределения дневной нормы по слотам (25/30/25/10/10).
// Пользователь сможет подправить вручную, если появится такой UI.
// [EN] Default per-slot proportions (25/30/25/10/10) — user can edit later.
const SLOT_PROPORTIONS = Object.freeze({
  breakfast: 0.25,
  main1: 0.30,
  main2: 0.25,
  salad: 0.10,
  dessert: 0.10
});

/**
 * Mifflin-St Jeor BMR (kcal/day).
 * @param {{weight: number, height: number, age: number, sex: 'male'|'female'}} profile
 * @returns {number}
 */
function calculateBMR({ weight, height, age, sex }) {
  const base = 10 * weight + 6.25 * height - 5 * age;
  return sex === 'male' ? base + 5 : base - 161;
}

/**
 * Total Daily Energy Expenditure — BMR multiplied by activity factor.
 * @param {number} bmr
 * @param {keyof typeof ACTIVITY_MULTIPLIER} activityLevel
 * @returns {number}
 */
function calculateTDEE(bmr, activityLevel) {
  const factor = ACTIVITY_MULTIPLIER[activityLevel];
  if (!factor) throw new Error(`Unknown activity level: ${activityLevel}`);
  return bmr * factor;
}

/**
 * Applies the goal coefficient (loss/maintain/gain) to TDEE.
 * @param {number} tdee
 * @param {keyof typeof GOAL_COEFFICIENT} goal
 * @returns {number}
 */
function applyGoal(tdee, goal) {
  const coef = GOAL_COEFFICIENT[goal];
  if (coef === undefined) throw new Error(`Unknown goal: ${goal}`);
  return tdee * coef;
}

/**
 * Composes BMR → TDEE → goal adjustment into a single rounded target.
 * @param {object} profile
 * @param {number} profile.weight
 * @param {number} profile.height
 * @param {number} profile.age
 * @param {'male'|'female'} profile.sex
 * @param {keyof typeof ACTIVITY_MULTIPLIER} profile.activity_level
 * @param {keyof typeof GOAL_COEFFICIENT} profile.goal
 * @returns {{bmr: number, tdee: number, target: number}} integers, kcal
 */
function calculateTargetCalories(profile) {
  const bmr = calculateBMR(profile);
  const tdee = calculateTDEE(bmr, profile.activity_level);
  const target = applyGoal(tdee, profile.goal);
  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    target: Math.round(target)
  };
}

/**
 * Splits the daily target across slots by fixed 25/30/25/10/10 proportions.
 * Integer rounding may leave the sum off by ±1 from the input; callers should
 * treat slot numbers as budgets, not exact equalities.
 *
 * @param {number} totalCalories
 * @returns {{breakfast: number, main1: number, main2: number, salad: number, dessert: number}}
 */
function splitCaloriesBySlots(totalCalories) {
  return {
    breakfast: Math.round(totalCalories * SLOT_PROPORTIONS.breakfast),
    main1: Math.round(totalCalories * SLOT_PROPORTIONS.main1),
    main2: Math.round(totalCalories * SLOT_PROPORTIONS.main2),
    salad: Math.round(totalCalories * SLOT_PROPORTIONS.salad),
    dessert: Math.round(totalCalories * SLOT_PROPORTIONS.dessert)
  };
}

module.exports = {
  calculateBMR,
  calculateTDEE,
  applyGoal,
  calculateTargetCalories,
  splitCaloriesBySlots,
  ACTIVITY_MULTIPLIER,
  GOAL_COEFFICIENT,
  SLOT_PROPORTIONS
};
