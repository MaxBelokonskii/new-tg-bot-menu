const { seedDb } = require('../helpers/memory-db');
const { test, before, beforeEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const texts = require('../../src/bot/texts');
const { dbGet, dbAll } = require('../../src/database/db');
const { runReminderTick } = require('../../src/features/reminders/scheduler');
const { toggleReminder, setWeeklyDay } = require('../../src/features/reminders/logic');
const { fillWeek } = require('../../src/interface/weekly-plan');
const { createFakeBot } = require('../helpers/fake-bot');

const TELEGRAM_ID = 9601;
const T = texts.weeklyPlan;
const SL = texts.shoppingList;
// [RU] Пользователь в поясе по умолчанию (Москва, UTC+3).
// Вс 15.11 23:30 МСК = 20:30Z; Пн 16.11 00:30 МСК = 21:30Z.
// [EN] User in the default zone (Moscow, UTC+3).
const SUNDAY_LATE = Date.parse('2026-11-15T20:30:00Z');
const MONDAY_EARLY = Date.parse('2026-11-15T21:30:00Z');

const { calls, sendCallback, reset } = createFakeBot(TELEGRAM_ID);

const buttons = (payload) => (payload.reply_markup?.inline_keyboard || []).flat();
const callbackData = (payload) => buttons(payload).map(b => b.callback_data);
const lastPayload = (method) => calls.filter(c => c.method === method).at(-1).payload;
const answer = () => calls.find(c => c.method === 'answerCallbackQuery').payload;
const userId = async () => (await dbGet('SELECT id FROM users WHERE telegram_id = ?', [TELEGRAM_ID])).id;
const plannedDates = async () => (await dbAll(
  `SELECT DISTINCT dm.date FROM daily_menu dm JOIN daily_menu_items dmi ON dmi.daily_menu_id = dm.id
   WHERE dm.user_id = ? ORDER BY dm.date`, [await userId()]
)).map(r => r.date);

before(async () => {
  await seedDb();
  mock.timers.enable({ apis: ['Date'], now: SUNDAY_LATE });
});
after(() => mock.timers.reset());
beforeEach(reset);

test('Sunday 23:30: the week choice offers this week and the next one with dates', async () => {
  await sendCallback('generate_weekly_plan');
  const choice = lastPayload('editMessageText');
  assert.equal(choice.text, T.chooseWeek);
  assert.deepEqual(buttons(choice).map(b => [b.text, b.callback_data]), [
    ['Эта неделя (9–15 нояб.)', 'gen_week_2026-11-09'],
    ['Следующая (16–22 нояб.)', 'gen_week_2026-11-16'],
    [texts.confirm.no, 'cancel_generate_weekly_plan']
  ]);
});

test('Monday 00:30: last week\'s button is stale and the choice moves forward', async () => {
  mock.timers.setTime(MONDAY_EARLY);
  await sendCallback('gen_week_2026-11-09');
  assert.equal(answer().text, T.staleWeek);
  const choice = lastPayload('editMessageText');
  assert.equal(choice.text, T.chooseWeek);
  assert.deepEqual(callbackData(choice).slice(0, 2), ['gen_week_2026-11-16', 'gen_week_2026-11-23']);
  assert.deepEqual(await plannedDates(), [], 'nothing generated');
});

test('next-week shopping list on an empty next week is an alert', async () => {
  await sendCallback('generate_shopping_list_nextweek');
  assert.equal(answer().text, SL.emptyForPeriod.nextweek);
  assert.equal(answer().show_alert, true);
});

test('generating the next week opens its Monday; view falls back to it while this week is empty', async () => {
  await sendCallback('gen_week_2026-11-23');
  assert.equal(answer().text, T.generating);
  assert.equal(lastPayload('editMessageText').text, fillWeek(T.generated, 'next', '2026-11-23'));
  const day = lastPayload('sendMessage');
  assert.ok(day.text.includes(`${T.days[0]}, 23.11`));
  assert.ok(day.text.includes(T.day.nextWeekMark.trim()));
  assert.ok(day.text.includes('За следующую неделю, 23–29 нояб.'));
  assert.deepEqual(await plannedDates(), [
    '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29'
  ]);

  reset();
  await sendCallback('view_weekly_plan');
  assert.ok(lastPayload('editMessageText').text.includes(`${T.days[0]}, 23.11`), 'opens next Monday');
});

test('a non-empty week asks overwrite/fill with its Monday in the callbacks', async () => {
  await sendCallback('gen_week_2026-11-23');
  const question = lastPayload('editMessageText');
  assert.equal(question.text, fillWeek(T.confirmRegenerate, 'next', '2026-11-23').replace('{count}', 35));
  assert.deepEqual(callbackData(question), [
    'generate_weekly_plan_overwrite_2026-11-23', 'generate_weekly_plan_fill_2026-11-23', 'cancel_generate_weekly_plan'
  ]);

  reset();
  await sendCallback('generate_weekly_plan_fill_2026-11-23');
  assert.equal(lastPayload('editMessageText').text, fillWeek(T.nothingToFill, 'next', '2026-11-23'));

  reset();
  await sendCallback('generate_weekly_plan_fill_2026-11-30');
  assert.equal(answer().text, T.staleWeek, 'the week after next is not accepted');
});

test('this week generated from the choice opens today; view opens today again', async () => {
  await sendCallback('gen_week_2026-11-16');
  assert.equal(lastPayload('editMessageText').text, fillWeek(T.generated, 'current', '2026-11-16'));
  assert.ok(lastPayload('sendMessage').text.includes(`${T.days[0]}, 16.11</b>${T.day.todayMark}`));

  reset();
  await sendCallback('view_weekly_plan');
  const view = lastPayload('editMessageText');
  assert.ok(view.text.includes(T.day.todayMark));
  assert.ok(view.text.includes('За эту неделю, 16–22 нояб.'));
});

test('next-week shopping list: dated header, not stale, separate from this week', async () => {
  await sendCallback('generate_shopping_list_nextweek');
  assert.equal(answer().text, SL.generated.nextweek);
  const list = await dbGet('SELECT period_start, period_end FROM shopping_lists WHERE user_id = ?', [await userId()]);
  assert.deepEqual(list, { period_start: '2026-11-23', period_end: '2026-11-30' });
  const screen = lastPayload('editMessageText');
  assert.ok(screen.text.includes(`${SL.title}</b> (на следующую неделю, 23–29 нояб.)`));
  assert.ok(!screen.text.includes(SL.stale));
  assert.ok(callbackData(screen).includes('generate_shopping_list_nextweek'));

  reset();
  await sendCallback('generate_shopping_list_week');
  assert.ok(lastPayload('editMessageText').text.includes('(на эту неделю, 16–22 нояб.)'));
});

test('the period toggle is two rows: today + this week, then next week', async () => {
  await sendCallback('generate_shopping_list_week');
  const rows = lastPayload('editMessageText').reply_markup.inline_keyboard.map(row => row.map(b => b.callback_data));
  assert.deepEqual(rows.slice(-3), [
    ['generate_shopping_list_day', 'generate_shopping_list_week'],
    ['generate_shopping_list_nextweek'],
    ['confirm_clear_shopping']
  ]);
});

test('reminder shopping button sl_week_<monday>: this week, next week, stale', async () => {
  const period = async () => dbGet('SELECT period_start, period_end FROM shopping_lists WHERE user_id = ?', [await userId()]);

  await sendCallback('sl_week_2026-11-16');
  assert.equal(answer().text, SL.generated.week);
  assert.deepEqual(await period(), { period_start: '2026-11-16', period_end: '2026-11-23' });
  assert.ok(lastPayload('editMessageText').text.includes('(на эту неделю, 16–22 нояб.)'));

  reset();
  await sendCallback('sl_week_2026-11-23');
  assert.equal(answer().text, SL.generated.nextweek);
  assert.deepEqual(await period(), { period_start: '2026-11-23', period_end: '2026-11-30' });

  // [RU] Кнопка воскресного напоминания про прошлую неделю — без пересборки.
  // [EN] Last week's reminder button: no rebuild, current list shown.
  reset();
  await sendCallback('sl_week_2026-11-09');
  assert.equal(answer().text, SL.staleWeek);
  assert.deepEqual(await period(), { period_start: '2026-11-23', period_end: '2026-11-30' });
  assert.ok(lastPayload('editMessageText').text.includes('(на следующую неделю, 23–29 нояб.)'));

  reset();
  await sendCallback('sl_week_2026-11-30');
  assert.equal(answer().text, SL.staleWeek, 'the week after next is not accepted');
});

test('weekly reminder on Sunday evening targets next week; on Monday — this week', async () => {
  await toggleReminder(TELEGRAM_ID, 'weekly', new Date('2026-11-15T12:00:00Z'));
  const sent = [];
  const telegram = { sendMessage: async (chatId, text, extra) => { sent.push({ text, extra }); } };

  // Вс 15.11, 18:00 МСК
  await runReminderTick(telegram, new Date('2026-11-15T15:00:00Z'));
  assert.equal(sent.length, 1);
  assert.ok(sent[0].text.includes('на следующую неделю (16–22 нояб.)'));
  assert.deepEqual(callbackData(sent[0].extra), ['gen_week_2026-11-16', 'sl_week_2026-11-16']);

  // Пн 16.11, 18:00 МСК: напоминание на понедельник — про текущую неделю
  await setWeeklyDay(TELEGRAM_ID, 0, new Date('2026-11-16T12:00:00Z'));
  await runReminderTick(telegram, new Date('2026-11-16T15:00:00Z'));
  assert.equal(sent.length, 2);
  assert.ok(sent[1].text.includes('на эту неделю (16–22 нояб.)'));
  assert.deepEqual(callbackData(sent[1].extra), ['gen_week_2026-11-16', 'sl_week_2026-11-16']);
});
