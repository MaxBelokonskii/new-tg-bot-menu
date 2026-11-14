const logger = require('../../utils/logger');
const { localParts } = require('../../utils/date-helpers');
const { isDue } = require('./schedule');
const { getEnabledReminders, claimReminder, disableUserReminders } = require('./logic');
const { buildReminderMessage } = require('./content');

const DEFAULT_INTERVAL_MS = 60_000;

/**
 * True for Telegram's 403 (bot blocked by the user, user deactivated, …):
 * messages to this chat can no longer be delivered.
 * @param {Error & {code?: number, response?: {error_code?: number}}} error
 * @returns {boolean}
 */
function isForbidden(error) {
  const code = error && (error.code ?? (error.response && error.response.error_code));
  return code === 403;
}

/**
 * Builds, claims and sends one due reminder.
 *
 * [RU] Порядок: собрать текст (только чтения) → пометить отправленным
 * (условный UPDATE) → отправить. Пометка до отправки — «не более одного
 * раза»: при падении между пометкой и отправкой напоминание за этот день
 * теряется, зато дубль невозможен, даже если тики или процессы пересеклись.
 * [EN] Order: build the text (reads only) → mark as sent (conditional
 * UPDATE) → send. Marking before sending is "at most once": a crash between
 * the two loses that day's reminder, but a duplicate is impossible even if
 * ticks or processes overlap.
 *
 * @param {{telegram: object, reminder: object, localDate: string}} args
 * @returns {Promise<'sent'|'skipped'|'blocked'|'failed'>}
 */
async function deliver({ telegram, reminder, localDate }) {
  const { text, extra } = await buildReminderMessage(reminder, localDate);
  if (!(await claimReminder(reminder.user_id, reminder.type, localDate))) return 'skipped';
  try {
    await telegram.sendMessage(reminder.telegram_id, text, extra);
    return 'sent';
  } catch (error) {
    if (!isForbidden(error)) throw error;
    await disableUserReminders(reminder.user_id);
    logger.info(`Reminders disabled for user ${reminder.user_id}: chat is unavailable (403)`);
    return 'blocked';
  }
}

/**
 * One scheduler pass: sends every enabled reminder that is due at `nowUtc`,
 * sequentially. A failing reminder is logged and does not stop the pass.
 * @param {{sendMessage: Function}} telegram - bot.telegram (or a fake in tests)
 * @param {Date} nowUtc
 * @returns {Promise<{sent: number, skipped: number, blocked: number, failed: number}>}
 */
async function runReminderTick(telegram, nowUtc) {
  const stats = { sent: 0, skipped: 0, blocked: 0, failed: 0 };
  const blockedUsers = new Set();
  const reminders = await getEnabledReminders();
  for (const reminder of reminders) {
    if (blockedUsers.has(reminder.user_id)) continue;
    if (!isDue(reminder, reminder.utc_offset_minutes, nowUtc)) continue;
    const { date } = localParts(nowUtc, reminder.utc_offset_minutes);
    try {
      const result = await deliver({ telegram, reminder, localDate: date });
      stats[result] += 1;
      if (result === 'sent') logger.info(`Reminder ${reminder.type} sent to user ${reminder.user_id} for ${date}`);
      if (result === 'blocked') blockedUsers.add(reminder.user_id);
    } catch (error) {
      stats.failed += 1;
      logger.error(`Reminder ${reminder.type} for user ${reminder.user_id} failed:`, error);
    }
  }
  return stats;
}

/**
 * Wraps runReminderTick so that overlapping calls never run concurrently:
 * a call made while a pass is in progress returns null immediately.
 * @param {{sendMessage: Function}} telegram
 * @param {{now?: () => Date}} [options]
 * @returns {() => Promise<object|null>} tick function
 */
function createReminderTicker(telegram, { now = () => new Date() } = {}) {
  let running = false;
  return async function tick() {
    if (running) return null;
    running = true;
    try {
      return await runReminderTick(telegram, now());
    } catch (error) {
      logger.error('Reminder tick failed:', error);
      return null;
    } finally {
      running = false;
    }
  };
}

/**
 * Starts the process-level reminder timer: one pass right away, then every
 * `intervalMs`. Must be started once, after the bot is launched (not from
 * createBot — tests build the bot without launching it).
 * @param {{sendMessage: Function}} telegram - bot.telegram
 * @param {{intervalMs?: number, now?: () => Date}} [options]
 * @returns {() => void} stop function
 */
function startReminderScheduler(telegram, { intervalMs = DEFAULT_INTERVAL_MS, now } = {}) {
  const tick = createReminderTicker(telegram, { now });
  const timer = setInterval(tick, intervalMs);
  // Таймер не должен держать процесс после bot.stop()
  timer.unref();
  tick();
  return () => clearInterval(timer);
}

module.exports = {
  runReminderTick,
  createReminderTicker,
  startReminderScheduler
};
