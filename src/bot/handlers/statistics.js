const texts = require('../texts');
const logger = require('../../utils/logger');
const { safeEdit } = require('./helpers');
const { getUserClock } = require('../../features/time-zone/logic');
const {
  statsWeekRange, isStatsMonday, statsNav, getWeekStats
} = require('../../features/statistics/logic');
const { buildStatsScreen } = require('../../interface/statistics');

const T = texts.statistics;

/**
 * Registers the weekly statistics screen: `st_week_<monday>` opens one ISO
 * week (from the diary button and ◀️/▶️ navigation). A Monday outside the
 * range (current week … STATS_WEEKS_BACK weeks back) or not a Monday shows
 * the current week with a toast.
 * @param {import('telegraf').Telegraf} bot
 */
function register(bot) {
  bot.action(/^st_week_(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
    try {
      const { today } = await getUserClock(ctx.from.id);
      let monday = ctx.match[1];
      if (isStatsMonday(monday, today)) {
        await ctx.answerCbQuery();
      } else {
        await ctx.answerCbQuery(T.outOfRange);
        monday = statsWeekRange(today).current;
      }
      const stats = await getWeekStats(ctx.from.id, monday, today);
      const { text, extra } = buildStatsScreen(stats, statsNav(monday, today));
      await safeEdit(ctx, text, extra);
    } catch (error) {
      logger.error('Statistics: error showing week:', error);
      await ctx.reply(texts.errors.general);
    }
  });
}

module.exports = { register };
