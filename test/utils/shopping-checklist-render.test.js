const { test } = require('node:test');
const assert = require('node:assert/strict');
const texts = require('../../src/bot/texts');
const { formatShoppingList, getShoppingListKeyboard } = require('../../src/interface/shopping-list');
const { buildChecklistScreen, clampPage } = require('../../src/interface/shopping-checklist');

const T = texts.shoppingList.checklist;
const TODAY = '2026-11-14';
const period = { periodStart: '2026-11-09', periodEnd: '2026-11-16' };

const item = (ingredientId, name, type, extra = {}) => ({
  ingredientId, name, type, total_amount: 100, unit: 'г', to_taste: false, is_bought: false, ...extra
});

const buttons = (extra) => extra.reply_markup.inline_keyboard;
const callbacks = (extra) => buttons(extra).flat().map(b => b.callback_data);

test('text list strikes bought items through and counts them', () => {
  const list = {
    listId: 7,
    ...period,
    items: [
      item(1, 'Молоко', 'Молочные продукты', { is_bought: true, unit: 'мл', total_amount: 1000 }),
      item(2, 'Огурец', 'Овощи'),
      item(3, 'Соль', 'Специи и приправы', { total_amount: 0, unit: '', to_taste: true, is_bought: true })
    ]
  };
  const text = formatShoppingList(list, TODAY);
  assert.ok(text.includes('• <s>Молоко: 1 л</s>'));
  assert.ok(text.includes('• Огурец: 100 г'));
  assert.ok(text.includes('• <s>Соль: по вкусу</s>'));
  assert.ok(text.includes('☑️ Куплено: 2 из 3'));
  assert.ok(!text.includes(texts.shoppingList.allBought));
  // Порядок групп — как в texts.shoppingList.types: овощи раньше молочных.
  assert.ok(text.indexOf('Огурец') < text.indexOf('Молоко'));
});

test('text list: no counter without marks, "all bought" when everything is bought', () => {
  const items = [item(1, 'Огурец', 'Овощи'), item(2, 'Морковь', 'Овощи')];
  const none = formatShoppingList({ listId: 1, ...period, items }, TODAY);
  assert.ok(!none.includes('Куплено'));
  assert.ok(!none.includes(texts.shoppingList.allBought));

  const all = formatShoppingList(
    { listId: 1, ...period, items: items.map(i => ({ ...i, is_bought: true })) }, TODAY
  );
  assert.ok(all.includes(texts.shoppingList.allBought));
  assert.ok(!all.includes('Куплено:'));
  // Внутри группы — по алфавиту.
  assert.ok(all.indexOf('Морковь') < all.indexOf('Огурец'));
});

test('list keyboard offers the checklist only when there is a list', () => {
  const withList = getShoppingListKeyboard(42).reply_markup.inline_keyboard;
  assert.deepEqual(withList[0], [{ text: T.openBtn, callback_data: 'sl_check_42_0', hide: false }]);
  const empty = getShoppingListKeyboard().reply_markup.inline_keyboard.flat().map(b => b.callback_data);
  assert.ok(!empty.some(data => data.startsWith('sl_check_')));
});

test('checklist: one toggle button per item with marks, list id and page', () => {
  const list = {
    listId: 9,
    ...period,
    items: [
      item(5, 'Молоко', 'Молочные продукты', { unit: 'мл', total_amount: 1000, is_bought: true }),
      item(6, 'Огурец', 'Овощи', { unit: 'шт', total_amount: 2 })
    ]
  };
  const { text, extra } = buildChecklistScreen(list, 0);
  assert.ok(text.startsWith(T.title));
  assert.ok(text.includes('☑️ Куплено: 1 из 2'));
  assert.ok(!text.includes('Страница'), 'single page has no page line');
  assert.deepEqual(buttons(extra).slice(0, 2), [
    [{ text: '⬜ Огурец — 2 шт', callback_data: 'sl_tgl_9_6_0' }],
    [{ text: '✅ Молоко — 1 л', callback_data: 'sl_tgl_9_5_0' }]
  ]);
  assert.deepEqual(callbacks(extra).slice(2), ['sl_reset_9_0', 'sl_list']);

  const unmarked = buildChecklistScreen({ ...list, items: [item(6, 'Огурец', 'Овощи')] }, 0);
  assert.deepEqual(callbacks(unmarked.extra), ['sl_tgl_9_6_0', 'sl_list'], 'no reset without marks');
});

test('checklist pages: 10 items per page, nav buttons, clamped page', () => {
  const items = Array.from({ length: 23 }, (_, i) => item(i + 1, `Продукт ${String(i + 1).padStart(2, '0')}`, 'Овощи'));
  const list = { listId: 123456, ...period, items };

  const first = buildChecklistScreen(list, 0);
  assert.ok(first.text.includes('Страница 1 из 3'));
  assert.equal(callbacks(first.extra).filter(d => d.startsWith('sl_tgl_')).length, 10);
  assert.deepEqual(buttons(first.extra)[10], [{ text: T.nextBtn, callback_data: 'sl_check_123456_1' }]);

  const middle = buildChecklistScreen(list, 1);
  assert.deepEqual(buttons(middle.extra)[10].map(b => b.callback_data), ['sl_check_123456_0', 'sl_check_123456_2']);
  assert.ok(callbacks(middle.extra).includes('sl_tgl_123456_11_1'));

  const last = buildChecklistScreen(list, 99);
  assert.ok(last.text.includes('Страница 3 из 3'));
  assert.equal(callbacks(last.extra).filter(d => d.startsWith('sl_tgl_')).length, 3);
  assert.ok(buttons(last.extra).length <= 15);
  assert.ok(callbacks(first.extra).every(d => Buffer.byteLength(d) <= 64));

  assert.deepEqual(clampPage(-1, 23), { page: 0, pages: 3 });
  assert.deepEqual(clampPage(0, 0), { page: 0, pages: 1 });
});
