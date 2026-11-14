const { dbGet, dbAll, dbRun, withTransaction } = require('../../database/db');
const { getOrCreateUser } = require('../weekly-planner/logic');
const {
  REMINDER_TYPES,
  DEFAULT_OFFSET_MINUTES,
  ZONE_OFFSETS,
  TIME_OPTIONS,
  DEFAULTS,
  lastSentAfterChange
} = require('./schedule');

/**
 * Merges stored reminder rows with defaults: a type without a row is a
 * disabled reminder with the default time/weekday.
 * @param {Array<object>} rows - reminders rows of one user
 * @returns {Record<'morning'|'evening'|'weekly', {type: string, enabled: boolean,
 *   time_minutes: number, weekday: number|null, last_sent_date: string|null}>}
 */
function mergeWithDefaults(rows) {
  const byType = new Map(rows.map(row => [row.type, row]));
  const result = {};
  for (const type of REMINDER_TYPES) {
    const row = byType.get(type);
    result[type] = {
      type,
      enabled: Boolean(row && row.enabled),
      time_minutes: row ? row.time_minutes : DEFAULTS[type].time_minutes,
      weekday: row ? row.weekday : DEFAULTS[type].weekday,
      last_sent_date: row ? row.last_sent_date : null
    };
  }
  return result;
}

/**
 * Loads the zone offset and all three reminders of an internal user id.
 * @param {number} userId
 * @returns {Promise<{offsetMinutes: number, reminders: object}>}
 */
async function loadSettings(userId) {
  const user = await dbGet('SELECT utc_offset_minutes FROM users WHERE id = ?', [userId]);
  const rows = await dbAll(
    'SELECT type, enabled, time_minutes, weekday, last_sent_date FROM reminders WHERE user_id = ?',
    [userId]
  );
  return {
    offsetMinutes: user ? user.utc_offset_minutes : DEFAULT_OFFSET_MINUTES,
    reminders: mergeWithDefaults(rows)
  };
}

/**
 * Returns the user's reminder settings (zone + three reminders with defaults).
 * @param {number} telegramId
 * @returns {Promise<{offsetMinutes: number, reminders: object}>}
 */
async function getReminderSettings(telegramId) {
  return loadSettings(await getOrCreateUser(telegramId));
}

/**
 * Inserts or updates one reminder row.
 * @param {number} userId
 * @param {{type: string, enabled: boolean, time_minutes: number, weekday: number|null,
 *   last_sent_date: string|null}} reminder
 * @returns {Promise<void>}
 */
async function upsertReminder(userId, reminder) {
  await dbRun(
    `INSERT INTO reminders (user_id, type, enabled, time_minutes, weekday, last_sent_date)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, type) DO UPDATE SET
       enabled = excluded.enabled,
       time_minutes = excluded.time_minutes,
       weekday = excluded.weekday,
       last_sent_date = excluded.last_sent_date`,
    [userId, reminder.type, reminder.enabled ? 1 : 0, reminder.time_minutes,
      reminder.weekday, reminder.last_sent_date]
  );
}

/**
 * Applies a change to one reminder and recomputes last_sent_date (a time
 * that already passed today counts as sent — see lastSentAfterChange).
 *
 * @param {number} telegramId
 * @param {'morning'|'evening'|'weekly'} type
 * @param {(current: object) => object} change - returns the patched fields
 * @param {Date} now
 * @returns {Promise<{offsetMinutes: number, reminders: object}>} settings after the change
 */
async function changeReminder(telegramId, type, change, now) {
  return withTransaction(async () => {
    const userId = await getOrCreateUser(telegramId);
    const { offsetMinutes, reminders } = await loadSettings(userId);
    const next = { ...reminders[type], ...change(reminders[type]) };
    next.last_sent_date = lastSentAfterChange(next, offsetMinutes, now);
    await upsertReminder(userId, next);
    return loadSettings(userId);
  });
}

/**
 * Switches a reminder on/off.
 * @param {number} telegramId
 * @param {'morning'|'evening'|'weekly'} type
 * @param {Date} [now=new Date()]
 * @returns {Promise<{offsetMinutes: number, reminders: object}|null>} null for an unknown type
 */
async function toggleReminder(telegramId, type, now = new Date()) {
  if (!REMINDER_TYPES.includes(type)) return null;
  return changeReminder(telegramId, type, (current) => ({ enabled: !current.enabled }), now);
}

/**
 * Sets the reminder time to one of the preset options.
 * @param {number} telegramId
 * @param {'morning'|'evening'|'weekly'} type
 * @param {number} minutes - minutes since local midnight
 * @param {Date} [now=new Date()]
 * @returns {Promise<{offsetMinutes: number, reminders: object}|null>} null when not a preset
 */
async function setReminderTime(telegramId, type, minutes, now = new Date()) {
  if (!TIME_OPTIONS[type] || !TIME_OPTIONS[type].includes(minutes)) return null;
  return changeReminder(telegramId, type, () => ({ time_minutes: minutes }), now);
}

/**
 * Sets the weekday of the weekly reminder.
 * @param {number} telegramId
 * @param {number} weekday - 0 = Monday … 6 = Sunday
 * @param {Date} [now=new Date()]
 * @returns {Promise<{offsetMinutes: number, reminders: object}|null>} null when out of range
 */
async function setWeeklyDay(telegramId, weekday, now = new Date()) {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return null;
  return changeReminder(telegramId, 'weekly', () => ({ weekday }), now);
}

/**
 * Stores the user's time zone and recomputes last_sent_date of the stored
 * reminders for the new local "today".
 * @param {number} telegramId
 * @param {number} offsetMinutes - one of ZONE_OFFSETS
 * @param {Date} [now=new Date()]
 * @returns {Promise<{offsetMinutes: number, reminders: object}|null>} null for an unknown zone
 */
async function setUtcOffset(telegramId, offsetMinutes, now = new Date()) {
  if (!ZONE_OFFSETS.includes(offsetMinutes)) return null;
  return withTransaction(async () => {
    const userId = await getOrCreateUser(telegramId);
    await dbRun('UPDATE users SET utc_offset_minutes = ? WHERE id = ?', [offsetMinutes, userId]);
    const rows = await dbAll(
      'SELECT type, time_minutes, last_sent_date FROM reminders WHERE user_id = ?',
      [userId]
    );
    for (const row of rows) {
      await dbRun(
        'UPDATE reminders SET last_sent_date = ? WHERE user_id = ? AND type = ?',
        [lastSentAfterChange(row, offsetMinutes, now), userId, row.type]
      );
    }
    return loadSettings(userId);
  });
}

/**
 * Returns all enabled reminders with the owner's Telegram id and zone.
 * @returns {Promise<Array<{user_id: number, type: string, enabled: number, time_minutes: number,
 *   weekday: number|null, last_sent_date: string|null, telegram_id: number,
 *   utc_offset_minutes: number}>>}
 */
function getEnabledReminders() {
  return dbAll(
    `SELECT r.user_id, r.type, r.enabled, r.time_minutes, r.weekday, r.last_sent_date,
            u.telegram_id, u.utc_offset_minutes
     FROM reminders r
     JOIN users u ON u.id = r.user_id
     WHERE r.enabled = 1
     ORDER BY r.user_id, r.type`
  );
}

/**
 * Atomically marks a reminder as sent for a local date. Returns false when
 * it was already marked for this date (or later) or got disabled meanwhile —
 * the caller must not send then.
 * @param {number} userId
 * @param {string} type
 * @param {string} localDate - YYYY-MM-DD
 * @returns {Promise<boolean>}
 */
async function claimReminder(userId, type, localDate) {
  const { changes } = await dbRun(
    `UPDATE reminders SET last_sent_date = ?
     WHERE user_id = ? AND type = ? AND enabled = 1
       AND (last_sent_date IS NULL OR last_sent_date < ?)`,
    [localDate, userId, type, localDate]
  );
  return changes === 1;
}

/**
 * Disables every reminder of a user (e.g. after the user blocked the bot).
 * @param {number} userId
 * @returns {Promise<void>}
 */
async function disableUserReminders(userId) {
  await dbRun('UPDATE reminders SET enabled = 0 WHERE user_id = ?', [userId]);
}

module.exports = {
  mergeWithDefaults,
  getReminderSettings,
  toggleReminder,
  setReminderTime,
  setWeeklyDay,
  setUtcOffset,
  getEnabledReminders,
  claimReminder,
  disableUserReminders
};
