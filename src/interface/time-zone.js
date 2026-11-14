const { Markup } = require('telegraf');
const texts = require('../bot/texts');
const { ZONE_OFFSETS } = require('../features/time-zone/clock');

const T = texts.timeZone;
const ZONES_PER_ROW = 2;

// [RU] Откуда открыт выбор пояса: после выбора и по «Назад» возвращаемся туда же.
// Ключ едет в callback_data (`tz_pick_<origin>`, `tz_set_<origin>_<минуты>`).
// [EN] Where the zone picker was opened from: choosing a zone or "Back"
// returns there. The key travels in callback_data.
const ZONE_PICKER_ORIGINS = Object.freeze({
  settings: Object.freeze({ backLabel: T.backToSettings, backCallback: 'settings_menu' }),
  rem: Object.freeze({ backLabel: T.backToReminders, backCallback: 'rem_menu' })
});

/**
 * Full zone label: "Москва (UTC+3)".
 * @param {number} offsetMinutes
 * @returns {string}
 */
function formatZone(offsetMinutes) {
  return T.label
    .replace('{city}', T.zones[offsetMinutes] || '')
    .replace('{hours}', offsetMinutes / 60);
}

/**
 * Short zone label for buttons: "Москва +3".
 * @param {number} offsetMinutes
 * @returns {string}
 */
function formatZoneShort(offsetMinutes) {
  return T.short
    .replace('{city}', T.zones[offsetMinutes] || '')
    .replace('{hours}', offsetMinutes / 60);
}

/**
 * Zone picker: Russian/CIS zones two per row, the current one marked, and
 * a back button to the screen it was opened from.
 * @param {number} currentOffset
 * @param {'settings'|'rem'} origin - key of ZONE_PICKER_ORIGINS
 * @returns {{text: string, extra: object}}
 */
function buildZonePicker(currentOffset, origin) {
  const { backLabel, backCallback } = ZONE_PICKER_ORIGINS[origin];
  const rows = [];
  ZONE_OFFSETS.forEach((offset, i) => {
    const label = formatZoneShort(offset);
    const button = Markup.button.callback(
      offset === currentOffset ? T.selectedMark.replace('{label}', label) : label,
      `tz_set_${origin}_${offset}`
    );
    if (i % ZONES_PER_ROW === 0) rows.push([button]);
    else rows[rows.length - 1].push(button);
  });
  rows.push([Markup.button.callback(backLabel, backCallback)]);
  return { text: T.prompt, extra: Markup.inlineKeyboard(rows) };
}

module.exports = { ZONE_PICKER_ORIGINS, formatZone, formatZoneShort, buildZonePicker };
