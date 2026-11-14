const { seedDb } = require('../helpers/memory-db');
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const texts = require('../../src/bot/texts');
const { dbGet } = require('../../src/database/db');
const { formatLocalDate, addDays, getCurrentWeekBounds } = require('../../src/utils/date-helpers');
const { getDayPlan } = require('../../src/features/weekly-planner/day-plan');
const { saveUserProfile } = require('../../src/features/profile/logic');
const { resolvePlanDate } = require('../../src/bot/handlers/plan-view');
const { buildPlanDayScreen, formatPlanDate, weekdayIndex } = require('../../src/interface/plan-day');
const { createFakeBot } = require('../helpers/fake-bot');

const TELEGRAM_ID = 9201;
const T = texts.weeklyPlan;
const TODAY = formatLocalDate(new Date());
const { start: MONDAY } = getCurrentWeekBounds();
const SUNDAY = addDays(MONDAY, 6);
const { calls, sendCallback, methods, reset } = createFakeBot(TELEGRAM_ID);

const callbackData = (payload) => (payload.reply_markup?.inline_keyboard || [])
  .flat().map(b => b.callback_data);
const lastEdit = () => calls.filter(c => c.method === 'editMessageText').at(-1).payload;

before(seedDb);
beforeEach(reset);

test('weekdayIndex / formatPlanDate / resolvePlanDate', () => {
  assert.equal(weekdayIndex('2026-11-09'), 0, 'Monday');
  assert.equal(weekdayIndex('2026-11-15'), 6, 'Sunday');
  assert.equal(formatPlanDate('2026-11-11'), 'Ср 11.11');
  const now = new Date(2026, 10, 12);
  assert.equal(resolvePlanDate('2026-11-15', now), '2026-11-15');
  assert.equal(resolvePlanDate('2026-11-16', now), '2026-11-12', 'next week → today');
  assert.equal(resolvePlanDate('2026-11-08', now), '2026-11-12', 'last week → today');
  assert.equal(resolvePlanDate('2026-02-31', now), '2026-11-12', 'invalid date → today');
});

test('empty week keeps the "no plan" text', async () => {
  await sendCallback('view_weekly_plan');
  assert.deepEqual(methods(), ['answerCallbackQuery', 'sendMessage']);
  assert.equal(calls[1].payload.text, T.empty);
});

test('view shows today with weekday name, kcal per dish, totals and day navigation', async () => {
  await sendCallback('generate_weekly_plan');
  reset();
  await sendCallback('view_weekly_plan');
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText']);
  const { text } = calls[1].payload;
  assert.ok(text.includes(T.days[weekdayIndex(TODAY)]), 'weekday name');
  assert.ok(text.includes(T.day.todayMark.trim()));
  assert.ok(!text.includes(TODAY), 'no raw YYYY-MM-DD');
  assert.ok(text.includes(T.day.totalsHeader));
  assert.ok(text.includes(T.day.noProfileHint), 'no profile → bare totals + hint');

  const items = await getDayPlan(TELEGRAM_ID, TODAY);
  const kcal = Math.round(items.reduce((s, i) => s + i.calories, 0));
  assert.ok(text.includes(`${kcal} ккал`), 'day total kcal');
  assert.ok(text.includes(T.day.weekHeader.replace('{days}', 7)), 'week summary: all 7 days planned');

  const data = callbackData(calls[1].payload);
  assert.equal(data.filter(d => d.startsWith('edit_slot_')).length, 5);
  assert.ok(data.includes(`confirm_clear_day_${TODAY}`));
  assert.ok(data.includes('wp_menu'));
  assert.ok(data.length <= 14, 'one day per screen');
  assert.equal(data.includes(`wp_day_${addDays(TODAY, -1)}`), TODAY > MONDAY);
  assert.equal(data.includes(`wp_day_${addDays(TODAY, 1)}`), TODAY < SUNDAY);
});

test('navigation: Monday has only ▶️, Sunday only ◀️; stale dates fall back to today', async () => {
  await sendCallback(`wp_day_${MONDAY}`);
  let nav = callbackData(lastEdit()).filter(d => d.startsWith('wp_day_'));
  assert.deepEqual(nav, [`wp_day_${addDays(MONDAY, 1)}`]);
  assert.ok(lastEdit().text.includes(T.days[0]));

  await sendCallback(`wp_day_${SUNDAY}`);
  nav = callbackData(lastEdit()).filter(d => d.startsWith('wp_day_'));
  assert.deepEqual(nav, [`wp_day_${addDays(SUNDAY, -1)}`]);

  await sendCallback(`wp_day_${addDays(SUNDAY, 7)}`);
  assert.ok(lastEdit().text.includes(T.days[weekdayIndex(TODAY)]));

  reset();
  await sendCallback('wp_menu');
  assert.equal(calls[1].payload.text, T.title);
});

test('with a profile the totals are compared with the norms', async () => {
  await saveUserProfile(TELEGRAM_ID, {
    weight: 80, height: 180, age: 30, sex: 'male', activity_level: 'moderate', goal: 'maintain'
  });
  const { target_calories: target } = await dbGet(
    'SELECT target_calories FROM user_preferences WHERE user_id = (SELECT id FROM users WHERE telegram_id = ?)',
    [TELEGRAM_ID]
  );
  await sendCallback(`wp_day_${TODAY}`);
  const { text } = lastEdit();
  assert.ok(!text.includes(T.day.noProfileHint));
  assert.match(text, new RegExp(`${texts.macroTargets.labels.calories}: \\d+ / ${target} ккал · \\d+%`));
  assert.match(text, new RegExp(`${texts.macroTargets.labels.protein}: \\d+ / \\d+ г`));
  assert.match(text, /В среднем в день: \d+ ккал \(\d+%\) · Б \d+ г \(\d+%\)/, 'week average vs norms');
});

test('remove / clear / cancel return to the same day', async () => {
  const day = MONDAY;
  await sendCallback(`confirm_remove_slot_${day}_4`);
  assert.ok(lastEdit().text.includes(formatPlanDate(day)));

  reset();
  await sendCallback(`do_remove_slot_${day}_4`);
  assert.equal(calls.find(c => c.method === 'answerCallbackQuery').payload.text, texts.editSlot.removed);
  assert.ok(lastEdit().text.includes(T.days[0]));
  assert.ok(!callbackData(lastEdit()).includes(`edit_slot_${day}_4`));

  reset();
  await sendCallback(`cancel_edit_${day}_1`);
  assert.ok(lastEdit().text.includes(T.days[0]));

  await sendCallback(`confirm_clear_day_${day}`);
  assert.ok(lastEdit().text.includes(formatPlanDate(day)));
  reset();
  await sendCallback(`do_clear_day_${day}`);
  assert.ok(lastEdit().text.includes(T.day.empty));
  assert.ok(!callbackData(lastEdit()).includes(`confirm_clear_day_${day}`));
  assert.deepEqual(await getDayPlan(TELEGRAM_ID, day), []);
});

test('buildPlanDayScreen: empty day has no totals and no clear button', () => {
  const { text, extra } = buildPlanDayScreen({
    date: '2026-11-11', today: '2026-11-12', weekStart: '2026-11-09',
    items: [], totals: { calories: 0, protein: 0, fat: 0, carbs: 0 }, targets: null
  });
  assert.ok(text.includes('Среда, 11.11'));
  assert.ok(!text.includes(T.day.todayMark));
  assert.ok(!text.includes(T.day.totalsHeader));
  assert.deepEqual(callbackData(extra), ['wp_day_2026-11-10', 'wp_day_2026-11-12', 'wp_menu']);
});
