// summarizePlanWeek живёт рядом с запросами к БД — держим модуль на in-memory SQLite.
require('../helpers/memory-db');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const texts = require('../../src/bot/texts');
const { summarizePlanWeek } = require('../../src/features/weekly-planner/week-totals');
const {
  formatShoppingListExport,
  formatPlanExport,
  shoppingListFilename,
  planFilename
} = require('../../src/interface/export');

const E = texts.export;

const item = (name, type, extra = {}) => ({
  name, type, total_amount: 100, unit: 'г', to_taste: false, is_bought: false, ...extra
});

const LIST = {
  periodStart: '2026-11-09',
  periodEnd: '2026-11-16',
  items: [
    item('Молоко', 'Молочные продукты', { is_bought: true, unit: 'мл', total_amount: 1000 }),
    item('Огурец', 'Овощи'),
    item('Соль', 'Специи и приправы', { total_amount: 0, unit: '', to_taste: true }),
    item('Сыр', 'Молочные продукты', { total_amount: 200, to_taste: true }),
    item('Манго', 'Экзотика')
  ]
};

test('shopping list export: plain text, screen group order, marks, to-taste, footer', () => {
  assert.equal(formatShoppingListExport(LIST, '2026-11-14'), [
    '🛒 Список покупок (на эту неделю, 9–15 нояб.)',
    '',
    '🥦 Овощи',
    '☐ Огурец — 100 г',
    '',
    '🥛 Молочные продукты',
    '☑ Молоко — 1 л',
    '☐ Сыр — 200 г + по вкусу',
    '',
    '🧂 Специи',
    '☐ Соль — по вкусу',
    '',
    '📦 Экзотика',
    '☐ Манго — 100 г',
    '',
    'Куплено: 1 из 5',
    ''
  ].join('\n'));
});

test('shopping list export: past period gets a note, a list without period a bare title', () => {
  const stale = formatShoppingListExport(LIST, '2026-11-20').split('\n');
  assert.equal(stale[0], '🛒 Список покупок (на 9–15 нояб.)');
  assert.equal(stale[1], E.shoppingList.stale);

  const family = formatShoppingListExport({ ...LIST, householdSize: 3 }, '2026-11-14');
  assert.ok(family.startsWith('🛒 Список покупок (на эту неделю, 9–15 нояб. · на 3 чел.)\n'));

  const bare = formatShoppingListExport({ ...LIST, periodStart: null, periodEnd: null }, '2026-11-14');
  assert.ok(bare.startsWith(`${E.shoppingList.titleNoPeriod}\n\n`));
  assert.ok(!/<\/?[a-z]+>/.test(bare), 'no HTML tags');
});

const ROWS = [
  { date: '2026-11-16', slot: 1, name: 'Омлет', calories: 300, protein: 20, fat: 15, carbs: 20 },
  { date: '2026-11-16', slot: 2, name: 'Борщ', calories: 400, protein: 20, fat: 10, carbs: 50 },
  { date: '2026-11-18', slot: 5, name: 'Сырники', calories: 250, protein: 15, fat: 10, carbs: 25 }
];

const planText = (targets) => formatPlanExport({
  kind: 'next', monday: '2026-11-16', rows: ROWS, summary: summarizePlanWeek(ROWS), targets
});

test('plan export: title, seven days with dishes or "empty", day and week totals', () => {
  const targets = { calories: 2000, protein: 100, fat: 70, carbs: 250 };
  assert.equal(planText(targets), [
    '📅 План питания на следующую неделю, 16–22 нояб.',
    '',
    'Понедельник, 16 нояб.',
    '• Завтрак: Омлет — 300 ккал',
    '• Основное №1: Борщ — 400 ккал',
    'Итого за день: 700 ккал · Б 40 г · Ж 25 г · У 70 г',
    '',
    'Вторник, 17 нояб.',
    '— пусто',
    '',
    'Среда, 18 нояб.',
    '• Десерт: Сырники — 250 ккал',
    'Итого за день: 250 ккал · Б 15 г · Ж 10 г · У 25 г',
    '',
    'Четверг, 19 нояб.',
    '— пусто',
    '',
    'Пятница, 20 нояб.',
    '— пусто',
    '',
    'Суббота, 21 нояб.',
    '— пусто',
    '',
    'Воскресенье, 22 нояб.',
    '— пусто',
    '',
    'Итого за неделю (дней с блюдами: 2 из 7)',
    'Всего: 950 ккал · Б 55 г · Ж 35 г · У 95 г',
    'В среднем в день: 475 ккал (24%) · Б 28 г (28%) · Ж 18 г (25%) · У 48 г (19%)',
    ''
  ].join('\n'));
});

test('plan export without targets: average without percentages; this-week title', () => {
  const lines = planText(null).split('\n');
  assert.equal(lines.at(-2), 'В среднем в день: 475 ккал · Б 28 г · Ж 18 г · У 48 г');
  const current = formatPlanExport({
    kind: 'current', monday: '2026-11-09', rows: [], summary: summarizePlanWeek([]), targets: null
  });
  assert.ok(current.startsWith('📅 План питания на эту неделю, 9–15 нояб.\n'));
  assert.ok(!/<\/?[a-z]+>/.test(current), 'no HTML tags');
});

test('export file names', () => {
  assert.equal(shoppingListFilename('2026-11-09'), 'shopping-list-2026-11-09.txt');
  assert.equal(shoppingListFilename(null), 'shopping-list.txt');
  assert.equal(planFilename('2026-11-16'), 'meal-plan-2026-11-16.txt');
});
