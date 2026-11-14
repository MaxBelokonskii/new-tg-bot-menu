const texts = require('../texts');
const logger = require('../../utils/logger');
const { safeEdit } = require('./helpers');
const { getUserProfile } = require('../../features/profile/logic');
const { buildProfileMenu } = require('../../interface/profile');
const {
  getReminderSettings,
  toggleReminder,
  setReminderTime,
  setWeeklyDay,
  setUtcOffset
} = require('../../features/reminders/logic');
const {
  buildRemindersScreen,
  buildTimePicker,
  buildZonePicker
} = require('../../interface/reminder-settings');

const T = texts.reminders;
const TYPE = '(morning|evening|weekly)';

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
      logger.error(`Reminders: error ${label}:`, error);
      await ctx.answerCbQuery().catch(() => {});
      await ctx.reply(texts.errors.general);
    }
  };
}

/**
 * Renders a screen in place and answers the callback with an optional toast.
 * @param {import('telegraf').Context} ctx
 * @param {{text: string, extra: object}} screen
 * @param {string} [toast]
 */
async function render(ctx, { text, extra }, toast) {
  await ctx.answerCbQuery(toast);
  await safeEdit(ctx, text, extra);
}

/**
 * Applies a settings change; null (invalid option from a stale or forged
 * button) answers with a notice and re-renders the reminders screen.
 * @param {import('telegraf').Context} ctx
 * @param {object|null} settings - change result
 * @param {(settings: object) => {text: string, extra: object}} buildScreen
 * @param {string} toast
 */
async function applyChange(ctx, settings, buildScreen, toast) {
  if (!settings) {
    await render(ctx, buildRemindersScreen(await getReminderSettings(ctx.from.id)), T.toasts.invalid);
    return;
  }
  await render(ctx, buildScreen(settings), toast);
}

/**
 * Registers the "🔔 Reminders" settings handlers: screen, toggles, time,
 * weekday and zone pickers, back to settings. Everything edits the message
 * in place — no scenes.
 * @param {import('telegraf').Telegraf} bot
 */
function register(bot) {
  bot.action('rem_menu', guarded('opening screen', async (ctx) => {
    await render(ctx, buildRemindersScreen(await getReminderSettings(ctx.from.id)));
  }));

  bot.action(new RegExp(`^rem_toggle_${TYPE}$`), guarded('toggling', async (ctx) => {
    const type = ctx.match[1];
    const settings = await toggleReminder(ctx.from.id, type);
    const toast = settings && settings.reminders[type].enabled ? T.toasts.enabled : T.toasts.disabled;
    await applyChange(ctx, settings, buildRemindersScreen, toast);
  }));

  bot.action(new RegExp(`^rem_time_${TYPE}$`), guarded('opening time picker', async (ctx) => {
    const settings = await getReminderSettings(ctx.from.id);
    await render(ctx, buildTimePicker(settings.reminders[ctx.match[1]]));
  }));

  bot.action(new RegExp(`^rem_settime_${TYPE}_(\\d{1,4})$`), guarded('setting time', async (ctx) => {
    const settings = await setReminderTime(ctx.from.id, ctx.match[1], Number(ctx.match[2]));
    await applyChange(ctx, settings, buildRemindersScreen, T.toasts.timeSaved);
  }));

  // [RU] День недели — остаёмся в пикере, чтобы следом выбрать время.
  // [EN] Weekday stays on the picker so the time can be chosen next.
  bot.action(/^rem_setday_(\d)$/, guarded('setting weekday', async (ctx) => {
    const settings = await setWeeklyDay(ctx.from.id, Number(ctx.match[1]));
    await applyChange(ctx, settings, (s) => buildTimePicker(s.reminders.weekly), T.toasts.daySaved);
  }));

  bot.action('rem_zone', guarded('opening zone picker', async (ctx) => {
    const { offsetMinutes } = await getReminderSettings(ctx.from.id);
    await render(ctx, buildZonePicker(offsetMinutes));
  }));

  bot.action(/^rem_setzone_(\d{1,4})$/, guarded('setting zone', async (ctx) => {
    const settings = await setUtcOffset(ctx.from.id, Number(ctx.match[1]));
    await applyChange(ctx, settings, buildRemindersScreen, T.toasts.zoneSaved);
  }));

  bot.action('rem_back', guarded('returning to settings', async (ctx) => {
    await render(ctx, buildProfileMenu(await getUserProfile(ctx.from.id)));
  }));
}

module.exports = { register };
