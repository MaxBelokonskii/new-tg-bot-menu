// [RU] Часы пользователя: варианты часовых поясов и чистый расчёт «сейчас»
// в поясе пользователя. Без БД — её читает features/time-zone/logic.js.
// [EN] The user's clock: time zone options and the pure "now" in the user's
// zone. No DB here — features/time-zone/logic.js reads it.
const { localParts, getWeekBounds } = require('../../utils/date-helpers');

// Москва (UTC+3) — пояс по умолчанию, как DEFAULT в users.utc_offset_minutes
const DEFAULT_OFFSET_MINUTES = 180;

// [RU] Российские/СНГ пояса без летнего времени: UTC+2 … UTC+12 (минуты).
// [EN] Russian/CIS zones without DST: UTC+2 … UTC+12 (minutes).
const ZONE_OFFSETS = Object.freeze([120, 180, 240, 300, 360, 420, 480, 540, 600, 660, 720]);

/**
 * True when the offset is one of the selectable zones.
 * @param {number} offsetMinutes
 * @returns {boolean}
 */
function isKnownZone(offsetMinutes) {
  return ZONE_OFFSETS.includes(offsetMinutes);
}

/**
 * Builds the user's clock for an instant: local today, minutes and hour
 * since local midnight, ISO weekday (0 = Monday) and the current ISO week.
 * @param {number} offsetMinutes - UTC offset of the user's zone
 * @param {Date} [now=new Date()]
 * @returns {{offsetMinutes: number, today: string, minutes: number, hour: number,
 *   weekday: number, week: {start: string, endExclusive: string}}}
 */
function buildClock(offsetMinutes, now = new Date()) {
  const { date, minutes, weekday } = localParts(now, offsetMinutes);
  return {
    offsetMinutes,
    today: date,
    minutes,
    hour: Math.floor(minutes / 60),
    weekday,
    week: getWeekBounds(date)
  };
}

module.exports = { DEFAULT_OFFSET_MINUTES, ZONE_OFFSETS, isKnownZone, buildClock };
