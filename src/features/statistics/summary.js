// [RU] Чистая агрегация статистики питания за ISO-неделю: КБЖУ по дням,
// среднее на день с записями, доли энергии Б/Ж/У, план против факта и
// разнообразие за 30 дней. Без БД и часов — данные и «сегодня» передаются
// параметрами (их загружает features/statistics/logic.js).
// [EN] Pure aggregation of weekly nutrition stats: per-day kcal/P/F/C, the
// average per day with entries, P/F/C energy shares, plan vs fact and the
// 30-day variety. No DB, no clock — rows and "today" come as parameters
// (loaded by features/statistics/logic.js).
const { addDays } = require('../../utils/date-helpers');
const { NUTRIENTS, sumNutrition } = require('../../utils/nutrition-totals');

const VARIETY_DAYS = 30;
const TOP_DISHES = 3;
// ккал на грамм: Б×4, Ж×9, У×4
const ENERGY_PER_GRAM = Object.freeze({ protein: 4, fat: 9, carbs: 4 });
const MACROS = Object.keys(ENERGY_PER_GRAM);

/**
 * Rounds shares to whole percents that add up to exactly 100 (largest
 * remainder method); null when the total is not positive.
 * @param {{protein: number, fat: number, carbs: number}} values - kcal per macro
 * @returns {{protein: number, fat: number, carbs: number}|null}
 */
function roundShares(values) {
  const total = MACROS.reduce((sum, key) => sum + values[key], 0);
  if (!(total > 0)) return null;
  const exact = MACROS.map(key => ({ key, value: (values[key] / total) * 100 }));
  const result = {};
  for (const { key, value } of exact) result[key] = Math.floor(value);
  let rest = 100 - MACROS.reduce((sum, key) => sum + result[key], 0);
  // [RU] Остаток процентов — макросам с наибольшей дробной частью; при
  // равенстве — в порядке Б/Ж/У, чтобы результат был детерминирован.
  // [EN] Leftover percents go to the largest fractional parts; ties keep the
  // P/F/C order so the result is deterministic.
  const byFraction = [...exact].sort((a, b) => (b.value % 1) - (a.value % 1));
  for (const { key } of byFraction) {
    if (rest <= 0) break;
    result[key] += 1;
    rest -= 1;
  }
  return result;
}

/**
 * Share of energy from protein, fat and carbs (P×4, F×9, C×4 over their sum).
 * @param {{protein?: number|null, fat?: number|null, carbs?: number|null}} grams
 * @returns {{protein: number, fat: number, carbs: number}|null} whole percents, null without energy
 */
function energyShares(grams) {
  const kcal = {};
  for (const key of MACROS) kcal[key] = (Number(grams[key]) || 0) * ENERGY_PER_GRAM[key];
  return roundShares(kcal);
}

/**
 * Per-day eaten nutrition of the week Mon..Sun; days after today are
 * marked as future.
 * @param {string} monday - YYYY-MM-DD
 * @param {string} today - YYYY-MM-DD
 * @param {Array<{date: string}>} eaten - scaled diary rows of the week
 * @returns {Array<{date: string, future: boolean, entries: number,
 *   totals: {calories: number, protein: number, fat: number, carbs: number}}>}
 */
function summarizeDays(monday, today, eaten) {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    const rows = eaten.filter(row => row.date === date);
    return { date, future: date > today, entries: rows.length, totals: sumNutrition(rows) };
  });
}

/**
 * Planned vs eaten kcal over the week's days up to today.
 * @param {Array<{date: string, calories: number}>} planned - per-serving planned dishes
 * @param {Array<{date: string, calories: number}>} eaten - scaled diary rows, already ≤ today
 * @param {string} today - YYYY-MM-DD
 * @returns {{plannedDays: number, planned: number, eaten: number, diff: number}|null}
 *   diff = eaten − planned; null when nothing is planned up to today
 */
function summarizePlanVsFact(planned, eaten, today) {
  const rows = planned.filter(row => row.date <= today);
  const plannedDays = new Set(rows.map(row => row.date)).size;
  if (plannedDays === 0) return null;
  const plannedKcal = sumNutrition(rows).calories;
  const eatenKcal = sumNutrition(eaten).calories;
  return { plannedDays, planned: plannedKcal, eaten: eatenKcal, diff: eatenKcal - plannedKcal };
}

/**
 * Distinct recipes eaten in the window and the most frequent ones.
 *
 * [RU] Частота — число записей дневника (порция не важна). Ничьи
 * разрешаются по названию, затем по id — порядок детерминирован.
 * [EN] Frequency is the number of diary entries (portion ignored). Ties are
 * broken by name, then by id, so the order is deterministic.
 *
 * @param {Array<{recipeId: number, name: string}>} rows - diary rows of the last VARIETY_DAYS days
 * @param {number} [limit=TOP_DISHES]
 * @returns {{distinct: number, top: Array<{recipeId: number, name: string, count: number}>}}
 */
function summarizeVariety(rows, limit = TOP_DISHES) {
  const counts = new Map();
  for (const { recipeId, name } of rows) {
    const item = counts.get(recipeId) || { recipeId, name, count: 0 };
    item.count += 1;
    counts.set(recipeId, item);
  }
  const top = [...counts.values()]
    .sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name, 'ru') || (a.recipeId - b.recipeId))
    .slice(0, limit);
  return { distinct: counts.size, top };
}

/**
 * Builds the statistics of one ISO week.
 *
 * [RU] Учитываются только дни ≤ сегодня: будущие дни текущей недели не
 * портят среднее и сравнение с планом. Среднее — на день с записями, а не
 * на 7 (как в сводке плана).
 * [EN] Only days up to today count: future days of the current week do not
 * skew the average or the plan comparison. The average is per day with
 * entries, not per 7 days (like the plan summary).
 *
 * @param {{monday: string, today: string,
 *   eaten: Array<{date: string, recipeId: number, name: string,
 *     calories: number, protein: number, fat: number, carbs: number}>,
 *   planned: Array<{date: string, calories: number}>,
 *   recent: Array<{recipeId: number, name: string}>,
 *   targets: {calories: number, protein: number, fat: number, carbs: number}|null}} input
 *   eaten — the week's diary rows scaled by portion; planned — getWeekPlanNutrition rows;
 *   recent — diary rows of the last VARIETY_DAYS days ending today
 * @returns {{monday: string, today: string, days: Array<object>, daysWithEntries: number,
 *   totals: object, average: object|null, shares: object|null, targetShares: object|null,
 *   planVsFact: object|null, variety: {distinct: number, top: Array<object>},
 *   targets: object|null}}
 */
function buildWeekStats({ monday, today, eaten, planned, recent, targets }) {
  const past = eaten.filter(row => row.date <= today);
  const days = summarizeDays(monday, today, past);
  const daysWithEntries = days.filter(day => day.entries > 0).length;
  const totals = sumNutrition(past);
  let average = null;
  if (daysWithEntries > 0) {
    average = {};
    for (const key of NUTRIENTS) average[key] = totals[key] / daysWithEntries;
  }
  return {
    monday,
    today,
    days,
    daysWithEntries,
    totals,
    average,
    shares: energyShares(totals),
    targetShares: targets ? energyShares(targets) : null,
    planVsFact: summarizePlanVsFact(planned, past, today),
    variety: summarizeVariety(recent),
    targets
  };
}

module.exports = {
  VARIETY_DAYS,
  TOP_DISHES,
  roundShares,
  energyShares,
  summarizeDays,
  summarizePlanVsFact,
  summarizeVariety,
  buildWeekStats
};
