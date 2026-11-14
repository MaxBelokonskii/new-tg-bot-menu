const { dbGet, dbRun, withTransaction } = require('../../database/db');
const { getOrCreateUser } = require('../weekly-planner/logic');
const { refreshSentDatesForZone } = require('../reminders/logic');
const { DEFAULT_OFFSET_MINUTES, isKnownZone, buildClock } = require('./clock');

/**
 * Returns the user's UTC offset in minutes; the default zone (Moscow) for
 * an unknown user. Read-only — does not create the user row.
 * @param {number} telegramId
 * @returns {Promise<number>}
 */
async function getUtcOffset(telegramId) {
  const row = await dbGet('SELECT utc_offset_minutes FROM users WHERE telegram_id = ?', [telegramId]);
  return row ? row.utc_offset_minutes : DEFAULT_OFFSET_MINUTES;
}

/**
 * The single source of "now" for the user: local today, time, weekday and
 * the current ISO week in the user's time zone.
 *
 * [RU] Хэндлеры берут часы здесь и передают даты/границы недели в логику
 * и интерфейс явно — серверные часы нигде больше не читаются.
 * [EN] Handlers take the clock here and pass dates/week bounds to logic
 * and interface explicitly — the server clock is read nowhere else.
 *
 * @param {number} telegramId
 * @param {Date} [now=new Date()] - injectable for tests
 * @returns {Promise<{offsetMinutes: number, today: string, minutes: number, hour: number,
 *   weekday: number, week: {start: string, endExclusive: string}}>}
 */
async function getUserClock(telegramId, now = new Date()) {
  return buildClock(await getUtcOffset(telegramId), now);
}

/**
 * Stores the user's time zone. Reminders' last_sent_date is recomputed for
 * the new local "today" in the same transaction (see lastSentAfterChange),
 * so a zone change cannot fire a reminder twice or instantly.
 * @param {number} telegramId
 * @param {number} offsetMinutes - one of ZONE_OFFSETS
 * @param {Date} [now=new Date()]
 * @returns {Promise<number|null>} saved offset, or null for an unknown zone
 */
async function setUtcOffset(telegramId, offsetMinutes, now = new Date()) {
  if (!isKnownZone(offsetMinutes)) return null;
  return withTransaction(async () => {
    const userId = await getOrCreateUser(telegramId);
    await dbRun('UPDATE users SET utc_offset_minutes = ? WHERE id = ?', [offsetMinutes, userId]);
    await refreshSentDatesForZone(userId, offsetMinutes, now);
    return offsetMinutes;
  });
}

module.exports = { getUtcOffset, getUserClock, setUtcOffset };
