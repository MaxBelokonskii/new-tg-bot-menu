const { sumNutrition } = require('../../utils/nutrition-totals');
const { getUserProfile } = require('../profile/logic');
const { pickTargets } = require('../profile/targets');
const { getDayPlan } = require('../weekly-planner/day-plan');
const { getDayLog } = require('../food-log/logic');
const { weeklyReminderWeek } = require('./schedule');
const {
  buildMorningMessage,
  buildEveningMessage,
  buildWeeklyMessage
} = require('../../interface/reminder-messages');

/**
 * Daily targets of a user, or null without a filled profile.
 * @param {number} telegramId
 * @returns {Promise<object|null>}
 */
async function loadTargets(telegramId) {
  const profile = await getUserProfile(telegramId);
  return profile ? pickTargets(profile) : null;
}

/**
 * Loads the data for a reminder and builds its message.
 *
 * [RU] Дата — локальная для пользователя (по его часовому поясу), а не
 * серверная: в 08:00 по Камчатке на сервере в Москве ещё вчерашний вечер.
 * [EN] The date is the user's local date (from their zone), not the server
 * one: 08:00 in Kamchatka is still the previous evening on a Moscow server.
 *
 * @param {{type: 'morning'|'evening'|'weekly', telegram_id: number}} reminder
 * @param {string} localDate - YYYY-MM-DD, user's local today
 * @returns {Promise<{text: string, extra: object}>}
 */
async function buildReminderMessage(reminder, localDate) {
  const telegramId = reminder.telegram_id;
  switch (reminder.type) {
    case 'morning': {
      const items = await getDayPlan(telegramId, localDate);
      return buildMorningMessage({ date: localDate, items, targets: await loadTargets(telegramId) });
    }
    case 'evening': {
      const entries = await getDayLog(telegramId, localDate);
      return buildEveningMessage({
        date: localDate,
        entriesCount: entries.length,
        totals: sumNutrition(entries),
        targets: await loadTargets(telegramId)
      });
    }
    case 'weekly':
      return buildWeeklyMessage(weeklyReminderWeek(localDate));
    default:
      throw new Error(`Unknown reminder type: ${reminder.type}`);
  }
}

module.exports = { buildReminderMessage };
