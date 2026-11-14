// [RU] Чистые хелперы календарных дат YYYY-MM-DD. Вся арифметика — в UTC,
// поэтому результат не зависит от часового пояса сервера (process.env.TZ).
// «Сегодня» пользователя считается из момента и его смещения от UTC
// (localParts), а не из часов сервера.
// [EN] Pure helpers for YYYY-MM-DD calendar dates. All arithmetic is done in
// UTC, so results do not depend on the server time zone (process.env.TZ).
// The user's "today" comes from an instant plus their UTC offset
// (localParts), never from the server clock.

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MINUTE_MS = 60_000;

const pad = (n) => String(n).padStart(2, '0');

/**
 * Formats the UTC calendar fields of a Date as YYYY-MM-DD.
 * @param {Date} d
 * @returns {string}
 */
function formatUtcDate(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * Parses YYYY-MM-DD into a Date at 00:00 UTC of that day.
 * @param {string} date
 * @returns {Date}
 */
function parseUtcDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Converts an instant into the local calendar date, minutes since local
 * midnight and ISO weekday (0 = Monday … 6 = Sunday) of a UTC offset.
 * @param {Date} instant
 * @param {number} offsetMinutes - UTC offset of the zone, e.g. 180 for UTC+3
 * @returns {{date: string, minutes: number, weekday: number}}
 */
function localParts(instant, offsetMinutes) {
  // [RU] Сдвигаем момент на смещение и читаем UTC-поля — так результат не
  // зависит от часового пояса сервера.
  // [EN] Shift the instant by the offset and read UTC fields, so the result
  // does not depend on the server time zone.
  const shifted = new Date(instant.getTime() + offsetMinutes * MINUTE_MS);
  return {
    date: formatUtcDate(shifted),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    weekday: (shifted.getUTCDay() + 6) % 7
  };
}

/**
 * Shifts a YYYY-MM-DD date by a number of days.
 * Calendar overflow is normalised (2026-02-31 + 0 → 2026-03-03), so
 * `addDays(d, 0) === d` doubles as a validity check.
 * @param {string} date - YYYY-MM-DD
 * @param {number} days - may be negative
 * @returns {string} YYYY-MM-DD
 */
function addDays(date, days) {
  const d = parseUtcDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return formatUtcDate(d);
}

/**
 * True for a well-formed, existing calendar date (2026-02-30 is not).
 * @param {unknown} date
 * @returns {boolean}
 */
function isValidDate(date) {
  return typeof date === 'string' && DATE_PATTERN.test(date) && addDays(date, 0) === date;
}

/**
 * ISO weekday of a date: 0 = Monday … 6 = Sunday.
 * @param {string} date - YYYY-MM-DD
 * @returns {number}
 */
function weekdayOf(date) {
  return (parseUtcDate(date).getUTCDay() + 6) % 7;
}

/**
 * ISO-week bounds (Mon..Sun) of the week containing `date`, half-open:
 * { start: Monday, endExclusive: next Monday }.
 * Use with SQL `WHERE date >= start AND date < endExclusive`.
 * @param {string} date - YYYY-MM-DD
 * @returns {{start: string, endExclusive: string}}
 */
function getWeekBounds(date) {
  const start = addDays(date, -weekdayOf(date));
  return { start, endExclusive: addDays(start, 7) };
}

/**
 * Half-open bounds of one day: { start: date, endExclusive: next day }.
 * Same shape as getWeekBounds.
 * @param {string} date - YYYY-MM-DD
 * @returns {{start: string, endExclusive: string}}
 */
function getDayBounds(date) {
  return { start: date, endExclusive: addDays(date, 1) };
}

module.exports = {
  localParts,
  addDays,
  isValidDate,
  weekdayOf,
  getWeekBounds,
  getDayBounds
};
