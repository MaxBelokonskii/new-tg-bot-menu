const { seedDb } = require('../helpers/memory-db');
const { test, before, beforeEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const texts = require('../../src/bot/texts');
const { dbGet } = require('../../src/database/db');
const { saveSelectedDish } = require('../../src/features/weekly-planner/logic');
const { addEntry } = require('../../src/features/food-log/logic');
const { saveUserProfile } = require('../../src/features/profile/logic');
const {
  STATS_WEEKS_BACK, isStatsMonday, statsNav
} = require('../../src/features/statistics/logic');
const { formatKcal } = require('../../src/interface/statistics');
const { createFakeBot } = require('../helpers/fake-bot');

const TELEGRAM_ID = 9701;
const T = texts.statistics;
// [RU] Пользователь в поясе по умолчанию (Москва, UTC+3): чт 12.11 12:00 МСК.
// [EN] User in the default zone (Moscow, UTC+3): Thu 12 Nov 12:00 MSK.
const NOW = Date.parse('2026-11-12T09:00:00Z');
const TODAY = '2026-11-12';
const MONDAY = '2026-11-09';
const PREV_MONDAY = '2026-11-02';
const OLDEST_MONDAY = '2026-08-17'; // 12 недель назад

const { calls, sendText, sendCallback, reset } = createFakeBot(TELEGRAM_ID);

const buttons = (payload) => (payload.reply_markup?.inline_keyboard || []).flat();
const callbackData = (payload) => buttons(payload).map(b => b.callback_data);
const lastEdit = () => calls.filter(c => c.method === 'editMessageText').at(-1).payload;
const answer = () => calls.find(c => c.method === 'answerCallbackQuery').payload;
const recipe = (name) => dbGet('SELECT id, calories FROM recipes WHERE name = ?', [name]);

before(async () => {
  await seedDb();
  mock.timers.enable({ apis: ['Date'], now: NOW });
});
after(() => mock.timers.reset());
beforeEach(reset);

test('stats range: Mondays from 12 weeks back to the current week', () => {
  assert.equal(STATS_WEEKS_BACK, 12);
  assert.ok(isStatsMonday(MONDAY, TODAY));
  assert.ok(isStatsMonday(OLDEST_MONDAY, TODAY));
  assert.ok(!isStatsMonday('2026-08-10', TODAY), 'older than 12 weeks');
  assert.ok(!isStatsMonday('2026-11-16', TODAY), 'next week');
  assert.ok(!isStatsMonday('2026-11-10', TODAY), 'not a Monday');
  assert.ok(!isStatsMonday('2026-02-30', TODAY), 'not a date');
  assert.deepEqual(statsNav(MONDAY, TODAY), { prev: PREV_MONDAY, next: null });
  assert.deepEqual(statsNav(OLDEST_MONDAY, TODAY), { prev: null, next: '2026-08-24' });
});

test('diary → 📊 opens the current week; an empty week is a short notice', async () => {
  await sendText(texts.mainMenu.buttons.foodLog);
  const statsBtn = buttons(calls[0].payload).find(b => b.text === T.openBtn);
  assert.equal(statsBtn.callback_data, `st_week_${MONDAY}`);

  reset();
  await sendCallback(statsBtn.callback_data);
  assert.deepEqual(calls.map(c => c.method), ['answerCallbackQuery', 'editMessageText']);
  assert.equal(answer().text, undefined);
  const { text } = lastEdit();
  assert.ok(text.startsWith(T.title.replace('{week}', 'эта неделя, 9–15 нояб.')));
  assert.ok(text.includes(T.empty));
  assert.ok(!text.includes(texts.foodLog.noProfileHint));
  assert.deepEqual(callbackData(lastEdit()), [`st_week_${PREV_MONDAY}`, `fl_day_${TODAY}`]);
});

test('week without a profile: per-day kcal, averages, shares, plan vs fact, variety', async () => {
  const omelet = await recipe('Омлет с сыром');
  const tvorog = await recipe('Творожный омлет');
  await addEntry(TELEGRAM_ID, { recipeId: omelet.id, date: MONDAY });
  await addEntry(TELEGRAM_ID, { recipeId: omelet.id, date: '2026-11-11', portion: 2 });
  await addEntry(TELEGRAM_ID, { recipeId: tvorog.id, date: '2026-10-20' }); // прошлый месяц — в разнообразие
  await saveSelectedDish(TELEGRAM_ID, tvorog.id, MONDAY);
  await saveSelectedDish(TELEGRAM_ID, tvorog.id, '2026-11-14'); // будущее — не в «план и факт»

  await sendCallback(`st_week_${MONDAY}`);
  const { text } = lastEdit();
  const lines = text.split('\n');
  assert.ok(lines.includes(`Пн 09.11 — ${formatKcal(omelet.calories)} ккал`));
  assert.ok(lines.includes('Вт 10.11 — —'));
  assert.ok(lines.includes(`Ср 11.11 — ${formatKcal(omelet.calories * 2)} ккал`));
  assert.ok(lines.includes('Пт 13.11 — ·') && lines.includes('Вс 15.11 — ·'));
  assert.ok(text.includes(T.summaryHeader.replace('{days}', 2)));
  assert.ok(lines.some(l => l.startsWith(T.average.replace('{values}', `${Math.round(omelet.calories * 1.5)} ккал · Б`))));
  assert.ok(!text.includes('%)'), 'no target percents without a profile');
  assert.ok(lines.some(l => l.startsWith(T.sharesFact.split('{')[0])));
  assert.ok(!lines.some(l => l.startsWith(T.sharesTarget.split('{')[0])));

  const diff = Math.round(omelet.calories * 3 - tvorog.calories);
  assert.ok(text.includes(T.planHeader.replace('{days}', 1)));
  assert.ok(text.includes(T.planDiff
    .replace('{sign}', diff < 0 ? T.minus : T.plus).replace('{value}', formatKcal(Math.abs(diff)))));

  assert.ok(text.includes(T.varietyDistinct.replace('{count}', 2)));
  assert.ok(lines.includes(T.varietyItem.replace('{n}', 1).replace('{name}', 'Омлет с сыром').replace('{count}', 2)));
  assert.ok(lines.includes(T.varietyItem.replace('{n}', 2).replace('{name}', 'Творожный омлет').replace('{count}', 1)));
  assert.ok(text.includes(texts.foodLog.noProfileHint));
});

test('navigation: previous week, oldest week has no ◀️, back to the diary', async () => {
  await sendCallback(`st_week_${PREV_MONDAY}`);
  assert.ok(lastEdit().text.includes('прошлая неделя, 2–8 нояб.'));
  assert.deepEqual(callbackData(lastEdit()), [`st_week_2026-10-26`, `st_week_${MONDAY}`, `fl_day_${TODAY}`]);

  reset();
  await sendCallback(`st_week_${OLDEST_MONDAY}`);
  assert.ok(lastEdit().text.startsWith(T.title.replace('{week}', '17–23 авг.')));
  assert.deepEqual(callbackData(lastEdit()), ['st_week_2026-08-24', `fl_day_${TODAY}`]);

  reset();
  await sendCallback(`fl_day_${TODAY}`);
  assert.ok(lastEdit().text.startsWith(texts.foodLog.title.split(' — ')[0]));
});

test('out-of-range, future or non-Monday weeks show the current week with a toast', async () => {
  for (const monday of ['2026-08-10', '2026-11-16', '2026-11-10']) {
    reset();
    await sendCallback(`st_week_${monday}`);
    assert.equal(answer().text, T.outOfRange, monday);
    assert.ok(lastEdit().text.includes('эта неделя, 9–15 нояб.'), monday);
  }
});

test('with a profile: day bars with % of the kcal target and target shares', async () => {
  await saveUserProfile(TELEGRAM_ID, {
    weight: 80, height: 180, age: 30, sex: 'male', activity_level: 'moderate', goal: 'maintain'
  });
  await sendCallback(`st_week_${MONDAY}`);
  const { text } = lastEdit();
  const lines = text.split('\n');
  const monday = lines.find(l => l.startsWith('Пн 09.11'));
  assert.match(monday, /ккал · [🟩⬜🟥]+ \d+%$/u);
  assert.ok(lines.includes('Вт 10.11 — —'));
  assert.ok(text.includes('%)'), 'average vs targets');
  assert.ok(lines.some(l => l.startsWith(T.sharesTarget.split('{')[0])));
  assert.ok(!text.includes(texts.foodLog.noProfileHint));
});
