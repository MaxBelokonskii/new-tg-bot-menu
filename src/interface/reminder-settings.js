const { Markup } = require('telegraf');
const texts = require('../bot/texts');
const { REMINDER_TYPES, ZONE_OFFSETS, TIME_OPTIONS, formatTime } = require('../features/reminders/schedule');

const T = texts.reminders;
const DAYS_SHORT = texts.weeklyPlan.daysShort;
const ZONES_PER_ROW = 2;

const htmlExtra = (rows) => ({ parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) });
const mark = (label, selected) => (selected ? T.selectedMark.replace('{label}', label) : label);

/**
 * Full zone label: "Москва (UTC+3)".
 * @param {number} offsetMinutes
 * @returns {string}
 */
function formatZone(offsetMinutes) {
  return T.zoneLabel
    .replace('{city}', T.zones[offsetMinutes] || '')
    .replace('{hours}', offsetMinutes / 60);
}

/**
 * Short zone label for buttons: "Москва +3".
 * @param {number} offsetMinutes
 * @returns {string}
 */
function formatZoneShort(offsetMinutes) {
  return T.zoneShort
    .replace('{city}', T.zones[offsetMinutes] || '')
    .replace('{hours}', offsetMinutes / 60);
}

/**
 * When the reminder fires: "08:00" or, for weekly, "Вс, 18:00".
 * @param {{type: string, time_minutes: number, weekday: number|null}} reminder
 * @returns {string}
 */
function formatWhen(reminder) {
  const time = formatTime(reminder.time_minutes);
  if (reminder.type !== 'weekly') return time;
  return T.weeklyWhen.replace('{day}', DAYS_SHORT[reminder.weekday]).replace('{time}', time);
}

/**
 * Builds the "🔔 Reminders" settings screen: zone, each reminder's state and
 * time, toggle/time buttons per type, zone picker and back to settings.
 * @param {{offsetMinutes: number, reminders: object}} settings - getReminderSettings result
 * @returns {{text: string, extra: object}}
 */
function buildRemindersScreen({ offsetMinutes, reminders }) {
  const lines = [T.title, T.intro, '', T.zoneLine.replace('{zone}', formatZone(offsetMinutes)), ''];
  const rows = [];
  for (const type of REMINDER_TYPES) {
    const reminder = reminders[type];
    const when = formatWhen(reminder);
    const state = (reminder.enabled ? T.on : T.off).replace('{when}', when);
    lines.push(T.stateLine.replace('{label}', T.types[type]).replace('{state}', state));
    const toggle = (reminder.enabled ? T.toggleOn : T.toggleOff).replace('{label}', T.short[type]);
    rows.push([
      Markup.button.callback(toggle, `rem_toggle_${type}`),
      Markup.button.callback(T.timeBtn.replace('{when}', when), `rem_time_${type}`)
    ]);
  }
  rows.push([Markup.button.callback(T.zoneBtn.replace('{zone}', formatZoneShort(offsetMinutes)), 'rem_zone')]);
  rows.push([Markup.button.callback(T.backBtn, 'rem_back')]);
  return { text: lines.join('\n'), extra: htmlExtra(rows) };
}

/**
 * Time picker of one reminder; the weekly one also has a weekday row.
 * The current choice is marked with ✅.
 * @param {{type: string, time_minutes: number, weekday: number|null}} reminder
 * @returns {{text: string, extra: object}}
 */
function buildTimePicker(reminder) {
  const { type } = reminder;
  const lines = [T.timePrompt[type], ''];
  const rows = [];
  if (type === 'weekly') {
    lines.push(T.dayHeader.replace('{day}', DAYS_SHORT[reminder.weekday]));
    rows.push(DAYS_SHORT.slice(0, 4).map((day, i) => (
      Markup.button.callback(mark(day, i === reminder.weekday), `rem_setday_${i}`)
    )));
    rows.push(DAYS_SHORT.slice(4).map((day, i) => (
      Markup.button.callback(mark(day, i + 4 === reminder.weekday), `rem_setday_${i + 4}`)
    )));
  }
  lines.push(T.timeHeader.replace('{time}', formatTime(reminder.time_minutes)));
  rows.push(TIME_OPTIONS[type].map(minutes => Markup.button.callback(
    mark(formatTime(minutes), minutes === reminder.time_minutes),
    `rem_settime_${type}_${minutes}`
  )));
  rows.push([Markup.button.callback(T.toBackBtn, 'rem_menu')]);
  return { text: lines.join('\n'), extra: htmlExtra(rows) };
}

/**
 * Zone picker: Russian/CIS zones two per row, the current one marked.
 * @param {number} currentOffset
 * @returns {{text: string, extra: object}}
 */
function buildZonePicker(currentOffset) {
  const rows = [];
  ZONE_OFFSETS.forEach((offset, i) => {
    const button = Markup.button.callback(
      mark(formatZoneShort(offset), offset === currentOffset),
      `rem_setzone_${offset}`
    );
    if (i % ZONES_PER_ROW === 0) rows.push([button]);
    else rows[rows.length - 1].push(button);
  });
  rows.push([Markup.button.callback(T.toBackBtn, 'rem_menu')]);
  return { text: T.zonePrompt, extra: htmlExtra(rows) };
}

module.exports = {
  formatZone,
  formatWhen,
  buildRemindersScreen,
  buildTimePicker,
  buildZonePicker
};
