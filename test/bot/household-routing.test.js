const { seedDb } = require('../helpers/memory-db');
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const texts = require('../../src/bot/texts');
const { getHouseholdSize } = require('../../src/features/household/logic');
const { generateWeeklyPlan } = require('../../src/features/weekly-planner/generator');
const { getLastShoppingList } = require('../../src/features/shopping-list/logic');
const { createFakeBot } = require('../helpers/fake-bot');
const { defaultClock } = require('../helpers/clock');

const TELEGRAM_ID = 9601;
const H = texts.household;

const { calls, sendText, sendCallback, reset } = createFakeBot(TELEGRAM_ID);

const buttons = (payload) => (payload.reply_markup?.inline_keyboard || []).flat();
const lastPayload = (method) => calls.filter(c => c.method === method).at(-1).payload;
const toast = () => calls.find(c => c.method === 'answerCallbackQuery').payload.text;
const button = (payload, data) => buttons(payload).find(b => b.callback_data === data);

before(seedDb);
beforeEach(reset);

test('settings show the household size; the picker saves it and returns to settings', async () => {
  await sendText(texts.mainMenu.buttons.settings);
  assert.equal(button(calls[0].payload, 'hh_pick').text, H.settingsBtn.replace('{n}', 1));

  reset();
  await sendCallback('hh_pick');
  const picker = lastPayload('editMessageText');
  assert.equal(picker.text, H.prompt);
  const data = buttons(picker).map(b => b.callback_data);
  assert.deepEqual(data, ['hh_set_1', 'hh_set_2', 'hh_set_3', 'hh_set_4', 'hh_set_5', 'hh_set_6', 'settings_menu']);
  assert.equal(button(picker, 'hh_set_1').text, H.selectedMark.replace('{label}', H.option.replace('{n}', 1)));
  assert.equal(button(picker, 'hh_set_3').text, H.option.replace('{n}', 3));

  reset();
  await sendCallback('hh_set_3');
  assert.equal(toast(), H.saved, 'no list yet — no rebuild hint');
  assert.equal(await getHouseholdSize(TELEGRAM_ID), 3);
  const settings = lastPayload('editMessageText');
  assert.ok(settings.text.startsWith(texts.profile.menuTitle));
  assert.equal(button(settings, 'hh_pick').text, H.settingsBtn.replace('{n}', 3));

  reset();
  await sendCallback('hh_pick');
  assert.ok(button(lastPayload('editMessageText'), 'hh_set_3').text.startsWith('✅'));
});

test('invalid sizes are rejected with a toast and change nothing', async () => {
  for (const n of [0, 7, 12]) {
    reset();
    await sendCallback(`hh_set_${n}`);
    assert.equal(toast(), H.invalid);
    assert.equal(calls.filter(c => c.method === 'editMessageText').length, 0);
  }
  assert.equal(await getHouseholdSize(TELEGRAM_ID), 3);
});

test('the list is built for the household; changing the size hints at a rebuild', async () => {
  const { week } = defaultClock();
  await generateWeeklyPlan(TELEGRAM_ID, { week });
  await sendCallback('generate_shopping_list_week');
  assert.equal((await getLastShoppingList(TELEGRAM_ID)).householdSize, 3);
  assert.ok(lastPayload('editMessageText').text.includes(H.listSuffix.replace('{n}', 3)));

  reset();
  await sendCallback('hh_set_3');
  assert.equal(toast(), H.saved, 'same size as the list');

  reset();
  await sendCallback('hh_set_2');
  assert.equal(toast(), H.savedRebuild);
  assert.equal((await getLastShoppingList(TELEGRAM_ID)).householdSize, 3, 'the list is not rebuilt');
});
