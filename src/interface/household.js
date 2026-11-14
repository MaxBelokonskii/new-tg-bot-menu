const { Markup } = require('telegraf');
const texts = require('../bot/texts');
const { MIN_HOUSEHOLD_SIZE, MAX_HOUSEHOLD_SIZE } = require('../features/household/logic');

const T = texts.household;
const SIZES_PER_ROW = 3;

/**
 * Settings button label: "👨‍👩‍👧 Готовлю на: 2 чел.".
 * @param {number} size
 * @returns {string}
 */
function formatHouseholdButton(size) {
  return T.settingsBtn.replace('{n}', size);
}

/**
 * Shopping list header suffix " · на 3 чел."; empty for one person.
 * @param {number} [size=1]
 * @returns {string}
 */
function formatHouseholdSuffix(size = 1) {
  return size > 1 ? T.listSuffix.replace('{n}', size) : '';
}

/**
 * Household size picker: 1..6 three per row, the current one marked, and
 * a back button to Settings.
 * @param {number} currentSize
 * @returns {{text: string, extra: object}}
 */
function buildHouseholdPicker(currentSize) {
  const rows = [];
  for (let size = MIN_HOUSEHOLD_SIZE; size <= MAX_HOUSEHOLD_SIZE; size++) {
    const label = T.option.replace('{n}', size);
    const button = Markup.button.callback(
      size === currentSize ? T.selectedMark.replace('{label}', label) : label,
      `hh_set_${size}`
    );
    if ((size - MIN_HOUSEHOLD_SIZE) % SIZES_PER_ROW === 0) rows.push([button]);
    else rows[rows.length - 1].push(button);
  }
  rows.push([Markup.button.callback(T.backToSettings, 'settings_menu')]);
  return { text: T.prompt, extra: Markup.inlineKeyboard(rows) };
}

module.exports = { formatHouseholdButton, formatHouseholdSuffix, buildHouseholdPicker };
