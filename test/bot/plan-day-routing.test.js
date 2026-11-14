const { seedDb } = require('../helpers/memory-db');
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const texts = require('../../src/bot/texts');
const { dbGet } = require('../../src/database/db');
const { addDays, weekdayOf } = require('../../src/utils/date-helpers');
const { defaultClock } = require('../helpers/clock');
const { getDayPlan } = require('../../src/features/weekly-planner/day-plan');
const { saveUserProfile } = require('../../src/features/profile/logic');
const { resolvePlanDate } = require('../../src/bot/handlers/plan-view');
const { buildPlanDayScreen, formatPlanDate } = require('../../src/interface/plan-day');
const { fillWeek } = require('../../src/interface/weekly-plan');
const { createFakeBot } = require('../helpers/fake-bot');

const TELEGRAM_ID = 9201;
const T = texts.weeklyPlan;
const { today: TODAY, week: { start: MONDAY } } = defaultClock();
const SUNDAY = addDays(MONDAY, 6);
const NEXT_MONDAY = addDays(MONDAY, 7);
const NEXT_SUNDAY = addDays(MONDAY, 13);
const { calls, sendCallback, methods, reset } = createFakeBot(TELEGRAM_ID);

const callbackData = (payload) => (payload.reply_markup?.inline_keyboard || [])
  .flat().map(b => b.callback_data);
const lastEdit = () => calls.filter(c => c.method === 'editMessageText').at(-1).payload;

before(seedDb);
beforeEach(reset);

test('formatPlanDate / resolvePlanDate', () => {
  assert.equal(formatPlanDate('2026-11-11'), 'Ср 11.11');
  const today = '2026-11-12';
  assert.equal(resolvePlanDate('2026-11-15', today), '2026-11-15');
  assert.equal(resolvePlanDate('2026-11-16', today), '2026-11-16', 'next week is in the horizon');
  assert.equal(resolvePlanDate('2026-11-22', today), '2026-11-22', 'next Sunday is the last day');
  assert.equal(resolvePlanDate('2026-11-23', today), '2026-11-12', 'the week after next → today');
  assert.equal(resolvePlanDate('2026-11-08', today), '2026-11-12', 'last week → today');
  assert.equal(resolvePlanDate('2026-02-31', today), '2026-11-12', 'invalid date → today');
});

test('empty week keeps the "no plan" text', async () => {
  await sendCallback('view_weekly_plan');
  assert.deepEqual(methods(), ['answerCallbackQuery', 'sendMessage']);
  assert.equal(calls[1].payload.text, T.empty);
});

test('view shows today with weekday name, kcal per dish, totals and day navigation', async () => {
  await sendCallback(`gen_week_${MONDAY}`);
  reset();
  await sendCallback('view_weekly_plan');
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText']);
  const { text } = calls[1].payload;
  assert.ok(text.includes(T.days[weekdayOf(TODAY)]), 'weekday name');
  assert.ok(text.includes(T.day.todayMark.trim()));
  assert.ok(!text.includes(TODAY), 'no raw YYYY-MM-DD');
  assert.ok(text.includes(T.day.totalsHeader));
  assert.ok(text.includes(T.day.noProfileHint), 'no profile → bare totals + hint');

  const items = await getDayPlan(TELEGRAM_ID, TODAY);
  const kcal = Math.round(items.reduce((s, i) => s + i.calories, 0));
  assert.ok(text.includes(`${kcal} ккал`), 'day total kcal');
  assert.ok(
    text.includes(fillWeek(T.day.weekHeader, 'current', MONDAY).replace('{days}', 7)),
    'week summary: this week, all 7 days planned'
  );

  const data = callbackData(calls[1].payload);
  assert.equal(data.filter(d => d.startsWith('edit_slot_')).length, 5);
  assert.ok(data.includes(`confirm_clear_day_${TODAY}`));
  assert.ok(data.includes('wp_menu'));
  assert.ok(data.length <= 14, 'one day per screen');
  assert.equal(data.includes(`wp_day_${addDays(TODAY, -1)}`), TODAY > MONDAY);
  assert.ok(data.includes(`wp_day_${addDays(TODAY, 1)}`), '▶️ always: the horizon includes next week');
});

test('navigation spans this and next week: ◀️/▶️ cross the boundary; outside dates → today', async () => {
  const nav = () => callbackData(lastEdit()).filter(d => d.startsWith('wp_day_'));
  await sendCallback(`wp_day_${MONDAY}`);
  assert.deepEqual(nav(), [`wp_day_${addDays(MONDAY, 1)}`], 'this Monday: only ▶️');
  assert.ok(lastEdit().text.includes(T.days[0]));

  await sendCallback(`wp_day_${SUNDAY}`);
  assert.deepEqual(nav(), [`wp_day_${addDays(SUNDAY, -1)}`, `wp_day_${NEXT_MONDAY}`], 'Sunday ▶️ goes to next week');

  await sendCallback(`wp_day_${NEXT_MONDAY}`);
  assert.deepEqual(nav(), [`wp_day_${SUNDAY}`, `wp_day_${addDays(NEXT_MONDAY, 1)}`], 'next Monday ◀️ goes back');
  assert.ok(lastEdit().text.includes(T.day.nextWeekMark.trim()));

  await sendCallback(`wp_day_${NEXT_SUNDAY}`);
  assert.deepEqual(nav(), [`wp_day_${addDays(NEXT_SUNDAY, -1)}`], 'next Sunday: only ◀️');

  for (const outside of [addDays(NEXT_SUNDAY, 1), addDays(MONDAY, -1)]) {
    await sendCallback(`wp_day_${outside}`);
    assert.ok(lastEdit().text.includes(T.days[weekdayOf(TODAY)]), `${outside} → today`);
  }

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

test('next week: generated from the choice, edits return to that day, week summary is labelled', async () => {
  await sendCallback(`gen_week_${NEXT_MONDAY}`);
  const shown = calls.filter(c => c.method === 'sendMessage').at(-1).payload;
  assert.ok(shown.text.includes(T.days[0]), 'opens next Monday');
  assert.ok(shown.text.includes(fillWeek(T.day.weekHeader, 'next', NEXT_MONDAY).replace('{days}', 7)));

  const day = addDays(NEXT_MONDAY, 2);
  await sendCallback(`confirm_remove_slot_${day}_4`);
  assert.ok(lastEdit().text.includes(formatPlanDate(day)));
  await sendCallback(`do_remove_slot_${day}_4`);
  assert.ok(lastEdit().text.includes(T.days[2]));
  assert.ok(!callbackData(lastEdit()).includes(`edit_slot_${day}_4`));

  await sendCallback(`edit_slot_${day}_1`);
  const [, recipeId] = callbackData(lastEdit()).find(d => d.startsWith(`replace_now_${day}_1_`)).match(/_(\d+)$/);
  await sendCallback(`replace_now_${day}_1_${recipeId}`);
  assert.ok(lastEdit().text.includes(T.days[2]));
  assert.equal((await getDayPlan(TELEGRAM_ID, day)).find(i => i.slot === 1).recipe_id, Number(recipeId));

  await sendCallback(`do_clear_day_${day}`);
  assert.ok(lastEdit().text.includes(T.day.empty));
  assert.deepEqual(await getDayPlan(TELEGRAM_ID, day), []);
});

test('buildPlanDayScreen: empty day has no totals and no clear button', () => {
  const { text, extra } = buildPlanDayScreen({
    date: '2026-11-11', today: '2026-11-12', horizon: { first: '2026-11-09', last: '2026-11-22' },
    items: [], totals: { calories: 0, protein: 0, fat: 0, carbs: 0 }, targets: null
  });
  assert.ok(text.includes('Среда, 11.11'));
  assert.ok(!text.includes(T.day.todayMark));
  assert.ok(!text.includes(T.day.totalsHeader));
  assert.deepEqual(callbackData(extra), ['wp_day_2026-11-10', 'wp_day_2026-11-12', 'wp_menu']);
});
