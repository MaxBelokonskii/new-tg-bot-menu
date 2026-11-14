// [RU] Чистые правила напоминаний: варианты настроек, перевод «сейчас» в
// локальное время пользователя и проверка «пора отправлять». Без БД и таймеров.
// [EN] Pure reminder rules: setting options, converting "now" into the user's
// local time and the "is it due" check. No DB, no timers.

const REMINDER_TYPES = Object.freeze(['morning', 'evening', 'weekly']);

// Москва (UTC+3) — пояс по умолчанию, как DEFAULT в users.utc_offset_minutes
const DEFAULT_OFFSET_MINUTES = 180;

// [RU] Российские/СНГ пояса без летнего времени: UTC+2 … UTC+12 (минуты).
// [EN] Russian/CIS zones without DST: UTC+2 … UTC+12 (minutes).
const ZONE_OFFSETS = Object.freeze([120, 180, 240, 300, 360, 420, 480, 540, 600, 660, 720]);

const hours = (h) => h * 60;

// [RU] Предустановленное время (минуты от полуночи) и значения по умолчанию.
// weekday: 0 = Пн … 6 = Вс (как texts.weeklyPlan.daysShort).
// [EN] Preset times (minutes since midnight) and defaults.
// weekday: 0 = Mon … 6 = Sun (same as texts.weeklyPlan.daysShort).
const TIME_OPTIONS = Object.freeze({
  morning: Object.freeze([hours(7), hours(8), hours(9), hours(10)]),
  evening: Object.freeze([hours(19), hours(20), hours(21), hours(22)]),
  weekly: Object.freeze([hours(10), hours(12), hours(18), hours(20)])
});

const DEFAULTS = Object.freeze({
  morning: Object.freeze({ time_minutes: hours(8), weekday: null }),
  evening: Object.freeze({ time_minutes: hours(21), weekday: null }),
  weekly: Object.freeze({ time_minutes: hours(18), weekday: 6 })
});

// [RU] Окно отправки после наступления времени. Пропущенное (бот лежал)
// напоминание досылается только в пределах окна: рестарт вечером не пришлёт
// утренний план.
// [EN] Send window after the reminder time. A missed reminder (bot was down)
// is only sent within the window, so an evening restart won't send the
// morning plan.
const GRACE_MINUTES = 180;

const pad = (n) => String(n).padStart(2, '0');

/**
 * Converts a UTC instant into the user's local calendar date, minutes since
 * local midnight and ISO weekday (0 = Monday … 6 = Sunday).
 * @param {Date} nowUtc
 * @param {number} offsetMinutes - UTC offset of the user's zone
 * @returns {{date: string, minutes: number, weekday: number}}
 */
function localParts(nowUtc, offsetMinutes) {
  // [RU] Сдвигаем момент на смещение и читаем UTC-поля — так результат не
  // зависит от часового пояса сервера.
  // [EN] Shift the instant by the offset and read UTC fields, so the result
  // does not depend on the server time zone.
  const shifted = new Date(nowUtc.getTime() + offsetMinutes * 60_000);
  return {
    date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    weekday: (shifted.getUTCDay() + 6) % 7
  };
}

/**
 * True when the reminder should be sent now: it is enabled, the local time
 * is within [time, time + GRACE_MINUTES) (capped at local midnight), it was
 * not sent on this local date yet and, for weekly, today is its weekday.
 *
 * @param {{type: string, enabled: number|boolean, time_minutes: number,
 *   weekday: number|null, last_sent_date: string|null}} reminder
 * @param {number} offsetMinutes
 * @param {Date} nowUtc
 * @returns {boolean}
 */
function isDue(reminder, offsetMinutes, nowUtc) {
  if (!reminder.enabled) return false;
  const local = localParts(nowUtc, offsetMinutes);
  if (reminder.type === 'weekly' && local.weekday !== reminder.weekday) return false;
  if (local.minutes < reminder.time_minutes) return false;
  if (local.minutes >= reminder.time_minutes + GRACE_MINUTES) return false;
  // [RU] Сравнение строк YYYY-MM-DD: «позже» сегодняшней даты тоже считается
  // отправленным — так смена пояса назад не даёт повторной отправки.
  // [EN] YYYY-MM-DD string compare: a date later than today also counts as
  // sent, so moving the zone backwards cannot cause a repeat.
  return !reminder.last_sent_date || reminder.last_sent_date < local.date;
}

/**
 * Computes last_sent_date after the reminder was enabled or its time,
 * weekday or the user's zone changed: when the time has already passed
 * today (local), today counts as sent, so e.g. enabling a 20:00 reminder at
 * 21:30 does not fire it instantly. Otherwise the stored value is kept.
 *
 * @param {{time_minutes: number, last_sent_date: string|null}} reminder - settings after the change
 * @param {number} offsetMinutes
 * @param {Date} nowUtc
 * @returns {string|null} new last_sent_date
 */
function lastSentAfterChange(reminder, offsetMinutes, nowUtc) {
  const local = localParts(nowUtc, offsetMinutes);
  const current = reminder.last_sent_date || null;
  if (local.minutes < reminder.time_minutes) return current;
  return current && current > local.date ? current : local.date;
}

/**
 * Formats minutes since midnight as HH:MM.
 * @param {number} minutes
 * @returns {string}
 */
function formatTime(minutes) {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

module.exports = {
  REMINDER_TYPES,
  DEFAULT_OFFSET_MINUTES,
  ZONE_OFFSETS,
  TIME_OPTIONS,
  DEFAULTS,
  GRACE_MINUTES,
  localParts,
  isDue,
  lastSentAfterChange,
  formatTime
};
