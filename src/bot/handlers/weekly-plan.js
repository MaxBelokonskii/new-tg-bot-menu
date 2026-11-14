const texts = require('../texts');
const logger = require('../../utils/logger');
const { showPlanDay } = require('./plan-view');
const planEdit = require('./plan-edit');
const planGenerate = require('./plan-generate');
const { getUserClock } = require('../../features/time-zone/logic');
const { sendWeeklyPlanMenu } = require('../../interface/weekly-plan');
const { countWeekItems } = require('../../features/weekly-planner/generator');
const { planWeeks } = require('../../features/weekly-planner/plan-weeks');

/**
 * Picks the day the plan view opens on: today when the current week has
 * dishes, next Monday when only the next week has them, null when both
 * weeks are empty.
 * @param {number} telegramId
 * @param {string} today - YYYY-MM-DD, the user's local today
 * @returns {Promise<string|null>}
 */
async function pickViewDay(telegramId, today) {
  const { current, next } = planWeeks(today);
  if (await countWeekItems(telegramId, current) > 0) return today;
  if (await countWeekItems(telegramId, next) > 0) return next.start;
  return null;
}

/**
 * Registers weekly-plan handlers: menu, day view with navigation, generation
 * (via plan-generate.js) and (via plan-edit.js) clearing/replacing/removing dishes.
 * @param {import('telegraf').Telegraf} bot
 */
function register(bot) {
  bot.hears(texts.mainMenu.buttons.weeklyPlan, (ctx) => sendWeeklyPlanMenu(ctx));

  planGenerate.register(bot);

  // [RU] Просмотр открывает сегодня; если эта неделя пуста, а следующая нет —
  // её понедельник; обе пустые — прежний текст.
  // [EN] Viewing opens today; if this week is empty but the next one is not —
  // next Monday; both empty — the old text.
  bot.action('view_weekly_plan', async (ctx) => {
    await ctx.answerCbQuery();
    try {
      const clock = await getUserClock(ctx.from.id);
      const day = await pickViewDay(ctx.from.id, clock.today);
      if (!day) {
        await ctx.reply(texts.weeklyPlan.empty);
        return;
      }
      await showPlanDay(ctx, day, { clock });
    } catch (error) {
      logger.error('Error viewing plan:', error);
      await ctx.reply(texts.errors.general);
    }
  });

  bot.action(/^wp_day_(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
    await ctx.answerCbQuery();
    try {
      await showPlanDay(ctx, ctx.match[1]);
    } catch (error) {
      logger.error('Error showing plan day:', error);
      await ctx.reply(texts.errors.general);
    }
  });

  bot.action('wp_menu', async (ctx) => {
    await ctx.answerCbQuery();
    try {
      await sendWeeklyPlanMenu(ctx);
    } catch (error) {
      logger.error('Error showing weekly plan menu:', error);
    }
  });

  // [RU] Правка дня — отдельным файлом (лимит 300 строк); регистрируется
  // отсюда, чтобы не трогать общий список в create-bot.js.
  // [EN] Day editing lives in its own file (300-line limit); registered from
  // here to keep the shared list in create-bot.js untouched.
  planEdit.register(bot);
}

module.exports = { register };
