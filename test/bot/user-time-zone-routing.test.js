const { seedDb } = require('../helpers/memory-db');
const { test, before, beforeEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const texts = require('../../src/bot/texts');
const { dbGet, dbAll } = require('../../src/database/db');
const { saveUserProfile } = require('../../src/features/profile/logic');
const { getSuggestions } = require('../../src/features/what-to-eat/logic');
const { getPrefsByTelegramId } = require('../../src/features/ingredient-prefs/logic');
const { buildSuggestionsScreen } = require('../../src/interface/what-to-eat');
const { fillWeek } = require('../../src/interface/weekly-plan');
const { createFakeBot } = require('../helpers/fake-bot');

const TELEGRAM_ID = 9501;
const TZ = texts.timeZone;
const SURVEY = { weight: 80, height: 180, age: 30, sex: 'male', activity_level: 'moderate', goal: 'maintain' };
// [RU] 12:30 UTC воскресенья 15.11: в Москве (и на «сервере») ещё воскресенье
// 15:30, а на Камчатке (UTC+12) уже понедельник 16.11, 00:30 — новая неделя.
// [EN] 12:30 UTC on Sunday 15.11: still Sunday 15:30 in Moscow, but Monday
// 16.11 00:30 in Kamchatka (UTC+12) — a new ISO week.
const NOW = new Date('2026-11-15T12:30:00Z');
const USER_TODAY = '2026-11-16';
const MOSCOW_TODAY = '2026-11-15';

const { calls, sendText, sendCallback, reset } = createFakeBot(TELEGRAM_ID);

const buttons = (payload) => (payload.reply_markup?.inline_keyboard || []).flat();
const callbackData = (payload) => buttons(payload).map(b => b.callback_data);
const lastPayload = (method) => calls.filter(c => c.method === method).at(-1).payload;
const toast = () => calls.find(c => c.method === 'answerCallbackQuery').payload.text;
const recipeOf = async (category) => (await dbGet(
  `SELECT r.id FROM recipes r JOIN meal_categories mc ON mc.id = r.category_id
   WHERE mc.name = ? ORDER BY r.id LIMIT 1`, [category]
)).id;
const userId = async () => (await dbGet('SELECT id FROM users WHERE telegram_id = ?', [TELEGRAM_ID])).id;

before(async () => {
  await seedDb();
  // Подменяем только Date: таймеры sqlite3/Telegraf работают как обычно
  mock.timers.enable({ apis: ['Date'], now: NOW });
});
after(() => mock.timers.reset());
beforeEach(reset);

test('settings show the zone; the picker saves it and returns to settings', async () => {
  await sendText(texts.mainMenu.buttons.settings);
  const zoneButton = buttons(calls[0].payload).find(b => b.callback_data === 'tz_pick_settings');
  assert.equal(zoneButton.text, TZ.settingsBtn.replace('{zone}', 'Москва (UTC+3)'));

  reset();
  await sendCallback('tz_pick_settings');
  const picker = lastPayload('editMessageText');
  assert.equal(picker.text, TZ.prompt);
  const data = callbackData(picker);
  assert.equal(data.filter(d => d.startsWith('tz_set_settings_')).length, 11);
  assert.equal(data.at(-1), 'settings_menu');
  assert.ok(buttons(picker).find(b => b.callback_data === 'tz_set_settings_180').text.startsWith('✅'));

  reset();
  await sendCallback('tz_set_settings_150');
  assert.equal(toast(), TZ.invalid);

  reset();
  await sendCallback('tz_set_settings_720');
  assert.equal(toast(), TZ.saved);
  const settings = lastPayload('editMessageText');
  assert.ok(settings.text.startsWith(texts.profile.menuTitle));
  assert.ok(buttons(settings).some(b => b.text === TZ.settingsBtn.replace('{zone}', 'Камчатка (UTC+12)')));

  reset();
  await sendCallback('settings_menu');
  assert.ok(lastPayload('editMessageText').text.startsWith(texts.profile.menuTitle));
});

test('a dish goes to the user\'s local today; a question from "yesterday" is stale', async () => {
  const breakfast = await recipeOf('breakfast');
  await sendCallback(`confirm_dish_${breakfast}`);
  const rows = await dbAll('SELECT date FROM daily_menu WHERE user_id = ?', [await userId()]);
  assert.deepEqual(rows.map(r => r.date), [USER_TODAY]);
  assert.ok(callbackData(lastPayload('sendMessage')).includes(`wp_day_${USER_TODAY}`));

  reset();
  await sendCallback(`dish_swap_${MOSCOW_TODAY}_1_${breakfast}`);
  assert.equal(toast(), texts.dishSelection.stale);
});

test('the diary opens on the user\'s date; "ate" from a card and from suggestions logs there', async () => {
  await saveUserProfile(TELEGRAM_ID, SURVEY);
  await sendText(texts.mainMenu.buttons.foodLog);
  assert.ok(callbackData(calls[0].payload).includes(`fl_search_${USER_TODAY}`));

  const dessert = await recipeOf('desserts');
  reset();
  await sendCallback(`fl_eat_${dessert}`);
  assert.ok(callbackData(lastPayload('sendMessage')).includes(`fl_add_${USER_TODAY}_${dessert}_0_2`));

  // запись за «сегодня» по Москве для пользователя на Камчатке — уже вчера, в окне дневника
  reset();
  await sendCallback(`fl_add_${MOSCOW_TODAY}_${dessert}_0_2`);
  assert.equal(toast(), texts.foodLog.added);

  reset();
  await sendCallback(`wte_eat_${dessert}_2`);
  const dates = await dbAll('SELECT date FROM food_log WHERE user_id = ? ORDER BY id', [await userId()]);
  assert.deepEqual(dates.map(r => r.date), [MOSCOW_TODAY, USER_TODAY]);
  assert.ok(callbackData(lastPayload('editMessageText')).includes(`fl_day_${USER_TODAY}`));
});

test('what-to-eat uses the user\'s local hour for time-of-day rules', async () => {
  const prefs = await getPrefsByTelegramId(TELEGRAM_ID);
  const screenAt = async (hour, page) => buildSuggestionsScreen(
    await getSuggestions(TELEGRAM_ID, { today: USER_TODAY, hour, page }), prefs, USER_TODAY
  ).text;
  // [RU] Проверка осмысленна только на странице, где правила времени меняют
  // выдачу: 00:30 на Камчатке против 15:30 по Москве (после полудня завтрак штрафуется).
  // [EN] Only meaningful on a page where time-of-day rules change the output:
  // 00:30 in Kamchatka vs 15:30 in Moscow (breakfast is penalised after noon).
  let page = 0;
  while (page < 10 && await screenAt(0, page) === await screenAt(15, page)) page++;
  assert.ok(page < 10, 'some page depends on the hour');

  await sendCallback(`wte_show_${page}`);
  assert.equal(lastPayload('editMessageText').text, await screenAt(0, page));
});

test('the generated week, plan view and shopping list follow the user\'s week', async () => {
  // понедельник 09.11 — текущая неделя по Москве, но для пользователя уже прошлая
  await sendCallback('generate_weekly_plan_fill_2026-11-09');
  assert.equal(toast(), texts.weeklyPlan.staleWeek);
  assert.equal(lastPayload('editMessageText').text, texts.weeklyPlan.chooseWeek);

  reset();
  await sendCallback(`generate_weekly_plan_fill_${USER_TODAY}`);
  const rows = await dbAll(
    'SELECT DISTINCT date FROM daily_menu WHERE user_id = ? ORDER BY date', [await userId()]
  );
  assert.deepEqual(rows.map(r => r.date), [
    '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'
  ]);
  const week = await dbGet('SELECT week_start FROM weekly_menu WHERE user_id = ?', [await userId()]);
  assert.equal(week.week_start, USER_TODAY);

  // воскресенье 15.11 — уже прошлая неделя пользователя: экран откатывается на сегодня
  reset();
  await sendCallback(`wp_day_${MOSCOW_TODAY}`);
  const day = lastPayload('editMessageText');
  assert.ok(day.text.includes(texts.weeklyPlan.days[0]), 'Monday');
  assert.ok(day.text.includes(fillWeek(texts.weeklyPlan.day.weekHeader, 'current', USER_TODAY).replace('{days}', 7)));
  assert.ok(!callbackData(day).includes(`wp_day_${MOSCOW_TODAY}`), 'no ◀️ before Monday');

  reset();
  await sendCallback('generate_shopping_list_day');
  const list = await dbGet(
    'SELECT period_start, period_end FROM shopping_lists WHERE user_id = ?', [await userId()]
  );
  assert.deepEqual(list, { period_start: USER_TODAY, period_end: '2026-11-17' });
  assert.ok(!lastPayload('editMessageText').text.includes(texts.shoppingList.stale));
});
