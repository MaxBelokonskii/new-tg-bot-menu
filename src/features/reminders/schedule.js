// [RU] Чистые правила напоминаний: варианты настроек и проверка «пора
// отправлять» по локальному времени пользователя (utils/date-helpers.js:localParts).
// Без БД и таймеров.
// [EN] Pure reminder rules: setting options and the "is it due" check in the
// user's local time (utils/date-helpers.js:localParts). No DB, no timers.
const { localParts, weekdayOf } = require('../../utils/date-helpers');
const { planWeeks } = require('../weekly-planner/plan-weeks');

const REMINDER_TYPES = Object.freeze(['morning', 'evening', 'weekly']);

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

// [RU] С пятницы (4) по воскресенье недельное напоминание зовёт планировать
// следующую неделю, с понедельника по четверг — текущую.
// [EN] From Friday (4) to Sunday the weekly reminder targets the next week,
// Monday to Thursday — the current one.
const NEXT_WEEK_FROM_WEEKDAY = 4;

const pad = (n) => String(n).padStart(2, '0');

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
 * Which week the weekly reminder is about on the user's local date: the
 * next one from Friday to Sunday, otherwise the current one.
 * @param {string} localDate - YYYY-MM-DD, the user's local today
 * @returns {{kind: 'current'|'next', monday: string}}
 */
function weeklyReminderWeek(localDate) {
  const kind = weekdayOf(localDate) >= NEXT_WEEK_FROM_WEEKDAY ? 'next' : 'current';
  return { kind, monday: planWeeks(localDate)[kind].start };
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
  TIME_OPTIONS,
  DEFAULTS,
  GRACE_MINUTES,
  isDue,
  lastSentAfterChange,
  weeklyReminderWeek,
  formatTime
};
