const texts = require('../texts');
const logger = require('../../utils/logger');
const { safeEdit } = require('./helpers');
const { buildSettingsScreen } = require('./settings-view');
const { getUtcOffset, setUtcOffset } = require('../../features/time-zone/logic');
const { getReminderSettings } = require('../../features/reminders/logic');
const { buildRemindersScreen } = require('../../interface/reminder-settings');
const { ZONE_PICKER_ORIGINS, buildZonePicker } = require('../../interface/time-zone');

const T = texts.timeZone;
const ORIGIN = `(${Object.keys(ZONE_PICKER_ORIGINS).join('|')})`;

// [RU] Экран, на который возвращаемся после выбора пояса, — по месту открытия.
// [EN] The screen to return to after choosing a zone — where it was opened from.
const ORIGIN_SCREENS = {
  settings: (telegramId) => buildSettingsScreen(telegramId),
  rem: async (telegramId) => buildRemindersScreen(await getReminderSettings(telegramId))
};

/**
 * Wraps a handler with error logging and a generic error reply.
 * @param {string} label
 * @param {(ctx: import('telegraf').Context) => Promise<void>} fn
 */
function guarded(label, fn) {
  return async (ctx) => {
    try {
      await fn(ctx);
    } catch (error) {
      logger.error(`Time zone: error ${label}:`, error);
      await ctx.answerCbQuery().catch(() => {});
      await ctx.reply(texts.errors.general);
    }
  };
}

/**
 * Registers the time zone picker, opened from Settings (`tz_pick_settings`)
 * or the reminders screen (`tz_pick_rem`). Choosing a zone
 * (`tz_set_<origin>_<minutes>`) saves it for the whole bot and returns to
 * the screen the picker was opened from.
 * @param {import('telegraf').Telegraf} bot
 */
function register(bot) {
  bot.action(new RegExp(`^tz_pick_${ORIGIN}$`), guarded('opening picker', async (ctx) => {
    const { text, extra } = buildZonePicker(await getUtcOffset(ctx.from.id), ctx.match[1]);
    await ctx.answerCbQuery();
    await safeEdit(ctx, text, extra);
  }));

  bot.action(new RegExp(`^tz_set_${ORIGIN}_(\\d{1,4})$`), guarded('setting zone', async (ctx) => {
    const [, origin, offset] = ctx.match;
    const saved = await setUtcOffset(ctx.from.id, Number(offset));
    const { text, extra } = await ORIGIN_SCREENS[origin](ctx.from.id);
    await ctx.answerCbQuery(saved === null ? T.invalid : T.saved);
    await safeEdit(ctx, text, extra);
  }));
}

module.exports = { register };
