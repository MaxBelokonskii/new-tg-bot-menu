const { Markup } = require('telegraf');
const texts = require('../bot/texts');

const T = texts.ingredientPrefs;
const BUTTONS_PER_ROW = 2;

/**
 * Builds the list screen for one preference kind: explanation, current
 * products as "✖️ name" remove buttons, "add" and "back" buttons.
 *
 * @param {'excluded'|'favorite'} kind
 * @param {Array<{id: number, name: string}>} items
 * @returns {{text: string, extra: object}}
 */
function buildPrefsScreen(kind, items) {
  const lines = [T.title[kind], '', T.explain[kind], ''];
  lines.push(items.length === 0 ? T.empty : T.removeHint);

  const rows = [];
  for (let i = 0; i < items.length; i += BUTTONS_PER_ROW) {
    rows.push(items.slice(i, i + BUTTONS_PER_ROW).map(item =>
      Markup.button.callback(`${T.removePrefix} ${item.name}`, `prefs_del_${kind}_${item.id}`)
    ));
  }
  rows.push([Markup.button.callback(T.addBtn, `prefs_add_${kind}`)]);
  rows.push([Markup.button.callback(T.backBtn, 'prefs_back')]);

  return {
    text: lines.join('\n'),
    extra: { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) }
  };
}

/**
 * Prompt shown when the add scene starts.
 * @param {'excluded'|'favorite'} kind
 * @returns {{text: string, extra: object}}
 */
function buildAddPrompt(kind) {
  return {
    text: T.askAdd[kind],
    extra: {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback(T.cancelBtn, 'prefs_add_cancel')]])
    }
  };
}

const joinNames = (names) => names.map(n => `«${n}»`).join(', ');

/**
 * Formats unresolved tokens with suggestions: «курица» (может быть, «Куриное филе»?).
 * @param {Array<{token: string, suggestions: string[]}>} unknown
 * @returns {string}
 */
function formatUnknown(unknown) {
  const list = unknown.map(({ token, suggestions }) => (suggestions.length > 0
    ? T.result.suggestion.replace('{token}', token).replace('{list}', joinNames(suggestions))
    : `«${token}»`));
  return T.result.unknown.replace('{list}', list.join(', '));
}

/**
 * Builds the summary after adding products. `recognized: false` means no
 * product was resolved — the scene then keeps waiting for input.
 *
 * @param {'excluded'|'favorite'} kind
 * @param {{added: string[], moved: string[], already: string[],
 *   unknown: Array<{token: string, suggestions: string[]}>}} result
 * @returns {{text: string, recognized: boolean}}
 */
function buildAddResult(kind, result) {
  const recognized = result.added.length + result.moved.length + result.already.length;
  const lines = [];
  if (recognized === 0) lines.push(T.nothingRecognized);
  if (result.added.length > 0) lines.push(T.result.added.replace('{list}', joinNames(result.added)));
  if (result.moved.length > 0) lines.push(T.result.moved[kind].replace('{list}', joinNames(result.moved)));
  if (result.already.length > 0) lines.push(T.result.already.replace('{list}', joinNames(result.already)));
  if (result.unknown.length > 0) lines.push(formatUnknown(result.unknown));
  return { text: lines.join('\n'), recognized: recognized > 0 };
}

module.exports = {
  buildPrefsScreen,
  buildAddPrompt,
  buildAddResult
};
