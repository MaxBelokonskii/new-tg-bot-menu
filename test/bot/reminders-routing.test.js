const { seedDb } = require('../helpers/memory-db');
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const texts = require('../../src/bot/texts');
const { dbGet } = require('../../src/database/db');
const { formatLocalDate } = require('../../src/utils/date-helpers');
const { saveUserProfile } = require('../../src/features/profile/logic');
const { saveSelectedDish } = require('../../src/features/weekly-planner/logic');
const { getReminderSettings } = require('../../src/features/reminders/logic');
const { createFakeBot } = require('../helpers/fake-bot');

const TELEGRAM_ID = 8101;
const T = texts.reminders;
const TODAY = formatLocalDate(new Date());

const { calls, sendText, sendCallback, methods, reset } = createFakeBot(TELEGRAM_ID);

const callbackData = (payload) => (payload.reply_markup?.inline_keyboard || [])
  .flat().map(b => b.callback_data);
const lastEdit = () => [...calls].reverse().find(c => c.method === 'editMessageText').payload;
const toast = () => calls.find(c => c.method === 'answerCallbackQuery').payload.text;
const sentTexts = () => calls.filter(c => c.method === 'sendMessage').map(c => c.payload.text);

before(seedDb);
beforeEach(reset);

test('settings screen has the reminders button that opens the reminders screen', async () => {
  await sendText(texts.mainMenu.buttons.settings);
  assert.ok(callbackData(calls[0].payload).includes('rem_menu'));

  reset();
  await sendCallback('rem_menu');
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText']);
  const screen = lastEdit();
  assert.ok(screen.text.startsWith(T.title));
  assert.ok(screen.text.includes('Москва (UTC+3)'));
  assert.ok(screen.text.includes('❌ выкл (08:00)'));
  assert.ok(screen.text.includes('❌ выкл (Вс, 18:00)'));
  assert.deepEqual(callbackData(screen), [
    'rem_toggle_morning', 'rem_time_morning',
    'rem_toggle_evening', 'rem_time_evening',
    'rem_toggle_weekly', 'rem_time_weekly',
    'rem_zone', 'rem_back'
  ]);
});

test('toggle switches the reminder on and off in place', async () => {
  await sendCallback('rem_toggle_morning');
  assert.equal(toast(), T.toasts.enabled);
  assert.ok(lastEdit().text.includes('✅ 08:00'));
  assert.equal((await getReminderSettings(TELEGRAM_ID)).reminders.morning.enabled, true);

  reset();
  await sendCallback('rem_toggle_morning');
  assert.equal(toast(), T.toasts.disabled);
  assert.equal((await getReminderSettings(TELEGRAM_ID)).reminders.morning.enabled, false);
});

test('time picker: preset times with the current one marked, choice returns to the screen', async () => {
  await sendCallback('rem_time_evening');
  const picker = lastEdit();
  assert.ok(picker.text.startsWith(T.timePrompt.evening));
  assert.deepEqual(callbackData(picker), [
    'rem_settime_evening_1140', 'rem_settime_evening_1200', 'rem_settime_evening_1260',
    'rem_settime_evening_1320', 'rem_menu'
  ]);
  assert.ok(picker.reply_markup.inline_keyboard[0][2].text.startsWith('✅'));

  reset();
  await sendCallback('rem_settime_evening_1200');
  assert.equal(toast(), T.toasts.timeSaved);
  assert.ok(lastEdit().text.startsWith(T.title));
  assert.equal((await getReminderSettings(TELEGRAM_ID)).reminders.evening.time_minutes, 1200);
});

test('weekly picker has weekdays; picking a day stays on the picker', async () => {
  await sendCallback('rem_time_weekly');
  const data = callbackData(lastEdit());
  assert.deepEqual(data.slice(0, 7), [0, 1, 2, 3, 4, 5, 6].map(d => `rem_setday_${d}`));
  assert.ok(data.includes('rem_settime_weekly_600'));

  reset();
  await sendCallback('rem_setday_4');
  assert.equal(toast(), T.toasts.daySaved);
  assert.ok(lastEdit().text.startsWith(T.timePrompt.weekly));
  assert.equal((await getReminderSettings(TELEGRAM_ID)).reminders.weekly.weekday, 4);
});

test('a forged or stale option is rejected with a notice', async () => {
  await sendCallback('rem_settime_morning_123');
  assert.equal(toast(), T.toasts.invalid);
  assert.ok(lastEdit().text.startsWith(T.title));
  assert.equal((await getReminderSettings(TELEGRAM_ID)).reminders.morning.time_minutes, 480);
});

test('zone picker lists 11 zones; choosing one saves it', async () => {
  await sendCallback('rem_zone');
  const data = callbackData(lastEdit());
  assert.equal(data.filter(d => d.startsWith('rem_setzone_')).length, 11);
  assert.equal(data.at(-1), 'rem_menu');

  reset();
  await sendCallback('rem_setzone_720');
  assert.equal(toast(), T.toasts.zoneSaved);
  assert.ok(lastEdit().text.includes('Камчатка (UTC+12)'));
  assert.equal((await getReminderSettings(TELEGRAM_ID)).offsetMinutes, 720);
});

test('back returns to the settings screen', async () => {
  await sendCallback('rem_back');
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText']);
  assert.ok(lastEdit().text.startsWith(texts.profile.menuTitle));
});

test('reminder buttons work when pressed from a fresh reminder message', async () => {
  await saveUserProfile(TELEGRAM_ID, { weight: 80, height: 180, age: 30, sex: 'male', activity_level: 'moderate', goal: 'maintain' });
  for (const data of [`fl_day_${TODAY}`, 'wte_show_0', 'back_to_categories', 'generate_shopping_list_week']) {
    reset();
    await sendCallback(data);
    assert.ok(!sentTexts().includes(texts.errors.general), data);
  }
  // пустая неделя → «нечего собирать» алертом
  assert.equal(toast(), texts.shoppingList.emptyForPeriod.week);

  reset();
  await sendCallback('generate_weekly_plan');
  assert.ok(sentTexts().includes(texts.weeklyPlan.generated));

  await saveSelectedDish(TELEGRAM_ID, (await dbGet('SELECT id FROM recipes LIMIT 1')).id);
  reset();
  await sendCallback(`wp_day_${TODAY}`);
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText']);
});
