const { seedDb } = require('../helpers/memory-db');
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const texts = require('../../src/bot/texts');
const { isUsableBotToken } = require('../../src/bot/create-bot');
const { defaultClock } = require('../helpers/clock');
const { fillWeek } = require('../../src/interface/weekly-plan');
const { createFakeBot } = require('../helpers/fake-bot');

const { calls, sendText, sendCallback, methods, reset } = createFakeBot(5001);

before(seedDb);
beforeEach(reset);

test('isUsableBotToken rejects empty values and placeholders', () => {
  for (const bad of [undefined, '', 'your_telegram_bot_token', 'your_telegram_bot_token_here', '123:short']) {
    assert.equal(isUsableBotToken(bad), false, String(bad));
  }
  assert.equal(isUsableBotToken('1234567890:AAEhBP0av28dsJNkPQXjE_FQq6ZmLX4WuOk'), true);
});

test('/help replies in Russian from texts.js', async () => {
  await sendText('/help');
  assert.deepEqual(methods(), ['sendMessage']);
  assert.equal(calls[0].payload.text, texts.help);
});

test('/start replies with welcome and main menu', async () => {
  await sendText('/start');
  assert.deepEqual(methods(), ['sendMessage', 'sendMessage']);
  assert.equal(calls[0].payload.text, texts.welcome);
});

for (const [key, label] of Object.entries(texts.mainMenu.buttons)) {
  test(`main menu button "${key}" is routed`, async () => {
    await sendText(label);
    assert.ok(methods().includes('sendMessage'), `no reply for ${label}`);
  });
}

test('generate → choose this week → view → edit slot → cancel flow is routed', async () => {
  const { week } = defaultClock();
  await sendCallback('generate_weekly_plan');
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText']);
  assert.equal(calls[1].payload.text, texts.weeklyPlan.chooseWeek);

  reset();
  await sendCallback(`gen_week_${week.start}`);
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText', 'sendMessage']);
  assert.equal(calls[1].payload.text, fillWeek(texts.weeklyPlan.generated, 'current', week.start));

  reset();
  await sendCallback('view_weekly_plan');
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText']);

  const { today } = defaultClock();
  reset();
  await sendCallback(`edit_slot_${today}_1`);
  assert.equal(methods()[0], 'answerCallbackQuery');
  assert.ok(methods().length > 1);

  reset();
  await sendCallback(`cancel_edit_${today}_1`);
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText']);
});

test('generate on a non-empty week asks overwrite/fill, fill reports nothing to do', async () => {
  const { week } = defaultClock();
  await sendCallback(`gen_week_${week.start}`);
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText']);
  assert.equal(
    calls[1].payload.text,
    fillWeek(texts.weeklyPlan.confirmRegenerate, 'current', week.start).replace('{count}', 35)
  );

  reset();
  await sendCallback(`generate_weekly_plan_fill_${week.start}`);
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText']);
  assert.equal(calls[1].payload.text, fillWeek(texts.weeklyPlan.nothingToFill, 'current', week.start));

  reset();
  await sendCallback(`generate_weekly_plan_overwrite_${week.start}`);
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText', 'sendMessage']);

  reset();
  await sendCallback('cancel_generate_weekly_plan');
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText']);
});

test('clear-day and remove-slot confirmations are routed', async () => {
  const { today } = defaultClock();
  for (const data of [`confirm_clear_day_${today}`, `confirm_remove_slot_${today}_2`]) {
    reset();
    await sendCallback(data);
    assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText'], data);
  }
});

test('shopping list rebuild and clear dialog are routed', async () => {
  await sendCallback('generate_shopping_list_week');
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText']);
  reset();
  await sendCallback('confirm_clear_shopping');
  assert.deepEqual(methods(), ['answerCallbackQuery', 'editMessageText']);
});

test('dish selection category and reverse-search expiry are routed', async () => {
  await sendCallback('select_cat_breakfast');
  assert.ok(methods().length > 0);
  reset();
  await sendCallback('reverse_back_to_list');
  assert.deepEqual(methods(), ['answerCallbackQuery', 'sendMessage']);
  assert.equal(calls[1].payload.text, texts.reverseSearch.sessionExpired);
});
