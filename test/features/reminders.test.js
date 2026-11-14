const { seedDb } = require('../helpers/memory-db');
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { TelegramError } = require('telegraf');
const texts = require('../../src/bot/texts');
const { dbGet, dbAll, dbRun } = require('../../src/database/db');
const { getOrCreateUser } = require('../../src/features/weekly-planner/logic');
const { saveUserProfile } = require('../../src/features/profile/logic');
const { addEntry } = require('../../src/features/food-log/logic');
const {
  getReminderSettings,
  toggleReminder,
  setReminderTime,
  setWeeklyDay
} = require('../../src/features/reminders/logic');
const { setUtcOffset } = require('../../src/features/time-zone/logic');
const { buildReminderMessage } = require('../../src/features/reminders/content');
const { runReminderTick, createReminderTicker } = require('../../src/features/reminders/scheduler');

const M = texts.reminders.messages;
const SURVEY = { weight: 80, height: 180, age: 30, sex: 'male', activity_level: 'moderate', goal: 'maintain' };
// 2026-11-14 — суббота. 05:00Z = 08:00 по Москве.
const MORNING_MSK = new Date('2026-11-14T05:00:00Z');

const callbackData = (extra) => (extra.reply_markup?.inline_keyboard || []).flat().map(b => b.callback_data);

/**
 * Fake bot.telegram: records sendMessage calls; `fail(chatId)` returns an
 * error to throw for that chat (or nothing).
 */
function fakeTelegram(fail = () => null) {
  const sent = [];
  return {
    sent,
    async sendMessage(chatId, text, extra) {
      const error = fail(chatId);
      if (error) throw error;
      sent.push({ chatId, text, extra });
      return { message_id: sent.length };
    }
  };
}

const forbidden = () => new TelegramError({ error_code: 403, description: 'Forbidden: bot was blocked by the user' });

async function planDish(telegramId, date, slot, recipeId) {
  const userId = await getOrCreateUser(telegramId);
  await dbRun('INSERT OR IGNORE INTO daily_menu (user_id, date) VALUES (?, ?)', [userId, date]);
  const menu = await dbGet('SELECT id FROM daily_menu WHERE user_id = ? AND date = ?', [userId, date]);
  await dbRun('INSERT INTO daily_menu_items (daily_menu_id, recipe_id, slot) VALUES (?, ?, ?)', [menu.id, recipeId, slot]);
}

const reminderRows = async (telegramId) => dbAll(
  'SELECT type, enabled, last_sent_date FROM reminders WHERE user_id = ? ORDER BY type',
  [await getOrCreateUser(telegramId)]
);

let breakfast;
before(async () => {
  await seedDb();
  breakfast = await dbGet(
    `SELECT r.id, r.name, r.calories FROM recipes r JOIN meal_categories mc ON mc.id = r.category_id
     WHERE LOWER(mc.name) = 'breakfast' ORDER BY r.id LIMIT 1`
  );
});

test('defaults: Moscow zone, everything off, preset default times', async () => {
  const { offsetMinutes, reminders } = await getReminderSettings(8001);
  assert.equal(offsetMinutes, 180);
  assert.deepEqual(
    Object.values(reminders).map(r => [r.type, r.enabled, r.time_minutes, r.weekday]),
    [['morning', false, 480, null], ['evening', false, 1260, null], ['weekly', false, 1080, 6]]
  );
});

test('enabling after the time today marks today as sent; before the time — not', async () => {
  const late = await toggleReminder(8002, 'evening', new Date('2026-11-14T18:30:00Z')); // 21:30 МСК
  assert.equal(late.reminders.evening.enabled, true);
  assert.equal(late.reminders.evening.last_sent_date, '2026-11-14');

  const early = await toggleReminder(8003, 'evening', new Date('2026-11-14T15:00:00Z')); // 18:00 МСК
  assert.equal(early.reminders.evening.last_sent_date, null);
  const off = await toggleReminder(8003, 'evening', new Date('2026-11-14T15:00:00Z'));
  assert.equal(off.reminders.evening.enabled, false);
});

test('time, weekday and zone accept only presets', async () => {
  const now = new Date('2026-11-14T03:00:00Z');
  assert.equal(await setReminderTime(8004, 'morning', 123, now), null);
  assert.equal(await setReminderTime(8004, 'nightly', 480, now), null);
  assert.equal(await setWeeklyDay(8004, 7, now), null);
  assert.equal(await setUtcOffset(8004, 150, now), null);

  assert.equal((await setReminderTime(8004, 'morning', 600, now)).reminders.morning.time_minutes, 600);
  assert.equal((await setWeeklyDay(8004, 0, now)).reminders.weekly.weekday, 0);
  assert.equal(await setUtcOffset(8004, 720, now), 720);
  assert.equal((await getReminderSettings(8004)).offsetMinutes, 720);
});

test('changing the zone recomputes last_sent_date for the new local today', async () => {
  const now = new Date('2026-11-14T03:00:00Z'); // 06:00 МСК, 15:00 Камчатка
  await toggleReminder(8005, 'morning', now);
  assert.equal((await getReminderSettings(8005)).reminders.morning.last_sent_date, null);
  await setUtcOffset(8005, 720, now);
  const moved = await getReminderSettings(8005);
  assert.equal(moved.reminders.morning.last_sent_date, '2026-11-14', '08:00 already passed in Kamchatka');
});

test('morning message: empty plan offers picking dishes or generating the week', async () => {
  const { text, extra } = await buildReminderMessage({ type: 'morning', telegram_id: 8010 }, '2026-11-14');
  assert.ok(text.includes(M.morningEmpty.split('{date}')[0]));
  assert.ok(text.includes('Сб 14.11'));
  assert.deepEqual(callbackData(extra), ['back_to_categories', 'generate_weekly_plan']);
});

test('morning message: dishes of the local date with kcal total vs target', async () => {
  await saveUserProfile(8011, SURVEY);
  await planDish(8011, '2026-11-15', 1, breakfast.id);
  const { text, extra } = await buildReminderMessage({ type: 'morning', telegram_id: 8011 }, '2026-11-15');
  assert.ok(text.includes(breakfast.name));
  assert.match(text, new RegExp(`Итого: ${Math.round(breakfast.calories)} из \\d+ ккал`));
  assert.deepEqual(callbackData(extra), ['wp_day_2026-11-15']);
});

test('evening message: eaten vs norm and what is left, diary + what-to-eat buttons', async () => {
  await saveUserProfile(8012, SURVEY);
  await addEntry(8012, { recipeId: breakfast.id, portion: 1, date: '2026-11-14' });
  const { text, extra } = await buildReminderMessage({ type: 'evening', telegram_id: 8012 }, '2026-11-14');
  assert.ok(text.startsWith(M.eveningTitle));
  assert.match(text, new RegExp(`Съедено: ${Math.round(breakfast.calories)} ккал`));
  assert.match(text, /Норма: \d+ ккал/);
  assert.match(text, /Осталось: \d+ ккал/);
  assert.deepEqual(callbackData(extra), ['fl_day_2026-11-14', 'wte_show_0']);
});

test('evening message without a profile: no norm, hint, diary button only', async () => {
  const { text, extra } = await buildReminderMessage({ type: 'evening', telegram_id: 8013 }, '2026-11-14');
  assert.ok(text.includes(M.eveningEmpty));
  assert.ok(text.includes(M.noTargets));
  assert.deepEqual(callbackData(extra), ['fl_day_2026-11-14']);
});

test('weekly message: Fri–Sun plans the next week, Mon–Thu the current one', async () => {
  // 2026-11-15 — воскресенье: следующая неделя 16–22.11
  const sunday = await buildReminderMessage({ type: 'weekly', telegram_id: 8014 }, '2026-11-15');
  assert.ok(sunday.text.startsWith(M.weeklyTitle));
  assert.ok(sunday.text.includes('на следующую неделю (16–22 нояб.)'));
  assert.deepEqual(callbackData(sunday.extra), ['gen_week_2026-11-16', 'generate_shopping_list_nextweek']);

  // 2026-11-11 — среда: текущая неделя 9–15.11
  const wednesday = await buildReminderMessage({ type: 'weekly', telegram_id: 8014 }, '2026-11-11');
  assert.ok(wednesday.text.includes('на эту неделю (9–15 нояб.)'));
  assert.deepEqual(callbackData(wednesday.extra), ['gen_week_2026-11-09', 'generate_shopping_list_week']);
});

test('tick sends due reminders once, skips the rest, uses the user\'s local date', async () => {
  const before = new Date('2026-11-14T03:00:00Z');
  await toggleReminder(8020, 'morning', before); // Москва, 08:00
  await toggleReminder(8020, 'evening', before); // 21:00 — не сейчас
  await setUtcOffset(8021, 720, before);
  await toggleReminder(8021, 'morning', new Date('2026-11-14T19:00:00Z')); // Камчатка, 07:00 15.11
  await planDish(8021, '2026-11-15', 1, breakfast.id);

  const telegram = fakeTelegram();
  await runReminderTick(telegram, MORNING_MSK);
  assert.deepEqual(telegram.sent.map(s => s.chatId), [8020]);
  assert.ok(telegram.sent[0].text.includes('Сб 14.11'));
  assert.deepEqual(await reminderRows(8020), [
    { type: 'evening', enabled: 1, last_sent_date: null },
    { type: 'morning', enabled: 1, last_sent_date: '2026-11-14' }
  ]);

  // второй тик в той же минуте — без дублей
  await runReminderTick(telegram, new Date('2026-11-14T05:01:00Z'));
  assert.equal(telegram.sent.length, 1);

  // 20:00Z — 08:00 15.11 на Камчатке: план берётся на локальную дату
  await runReminderTick(telegram, new Date('2026-11-14T20:00:00Z'));
  const kamchatka = telegram.sent.filter(s => s.chatId === 8021);
  assert.equal(kamchatka.length, 1);
  assert.ok(kamchatka[0].text.includes(breakfast.name));
  assert.ok(kamchatka[0].text.includes('Вс 15.11'));
});

test('403 disables all reminders of that user; other errors do not stop the tick', async () => {
  const now = new Date('2026-11-16T03:00:00Z'); // понедельник, 06:00 МСК
  for (const id of [8030, 8031, 8032]) await toggleReminder(id, 'morning', now);
  await toggleReminder(8030, 'evening', now);

  const telegram = fakeTelegram((chatId) => {
    if (chatId === 8030) return forbidden();
    if (chatId === 8031) return new Error('network down');
    return null;
  });
  const stats = await runReminderTick(telegram, new Date('2026-11-16T05:00:00Z'));
  assert.ok(telegram.sent.some(s => s.chatId === 8032), 'later users still get theirs');
  assert.ok(stats.blocked >= 1 && stats.failed >= 1);
  assert.deepEqual((await reminderRows(8030)).map(r => r.enabled), [0, 0]);
  assert.deepEqual((await reminderRows(8031)).map(r => r.enabled), [1], 'transient error keeps it on');
});

test('overlapping ticks never run concurrently', async () => {
  await toggleReminder(8040, 'morning', new Date('2026-11-17T03:00:00Z'));
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const telegram = {
    sent: 0,
    async sendMessage() { await gate; this.sent += 1; }
  };
  const tick = createReminderTicker(telegram, { now: () => new Date('2026-11-17T05:00:00Z') });
  const first = tick();
  assert.equal(await tick(), null, 'second call while the first is running is skipped');
  release();
  const stats = await first;
  assert.ok(stats.sent >= 1);
  assert.notEqual(await tick(), null, 'next call runs again');
});
