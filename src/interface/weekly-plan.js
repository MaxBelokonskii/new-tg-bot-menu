const { Markup } = require('telegraf');
const texts = require('../bot/texts');

// [RU] Мапа английских ключей категорий из БД на локализованные подписи.
// [EN] Maps DB category keys (en) to localized labels.
const CATEGORY_LABEL = {
  breakfast: texts.categories.breakfast,
  main: texts.categories.main,
  salad: texts.categories.salad,
  salads: texts.categories.salad,
  dessert: texts.categories.dessert,
  desserts: texts.categories.dessert
};

/**
 * Shows the weekly plan menu (view / generate).
 * @param {object} ctx
 */
async function sendWeeklyPlanMenu(ctx) {
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(texts.weeklyPlan.view, 'view_weekly_plan')],
    [Markup.button.callback(texts.weeklyPlan.generate, 'generate_weekly_plan')]
  ]);

  const text = texts.weeklyPlan.title;
  if (ctx.updateType === 'callback_query') {
    await ctx.editMessageText(text, keyboard);
  } else {
    await ctx.reply(text, keyboard);
  }
}

/**
 * Builds the weekly plan message (HTML text + inline keyboard with per-day
 * clear buttons). Used both for the initial render and for restoring the
 * view after a cancelled clear confirmation.
 *
 * @param {Array<{name: string, category: string, date: string}>} plan
 * @returns {{text: string, reply_markup: object}|null} null when plan is empty
 */
function buildWeeklyPlanMessage(plan) {
  if (!plan || plan.length === 0) return null;

  const grouped = plan.reduce((acc, item) => {
    if (!acc[item.date]) acc[item.date] = [];
    acc[item.date].push(item);
    return acc;
  }, {});

  let message = `<b>${texts.weeklyPlan.title}</b>\n\n`;
  const buttons = [];
  for (const date of Object.keys(grouped)) {
    message += `📅 <b>${date}</b>\n`;
    grouped[date].forEach(item => {
      const key = (item.category || '').toLowerCase();
      const categoryName = CATEGORY_LABEL[key] || item.category;
      message += `• [${categoryName}] ${item.name}\n`;
    });
    message += '\n';
    buttons.push([{
      text: `${texts.weeklyPlan.clearDay} (${date})`,
      callback_data: `confirm_clear_day_${date}`
    }]);
  }

  return {
    text: message,
    reply_markup: { inline_keyboard: buttons }
  };
}

/**
 * Builds the Yes/No keyboard for the "clear day" confirmation dialog.
 * @param {string} date - YYYY-MM-DD
 * @returns {object} reply_markup payload
 */
function buildClearDayConfirmKeyboard(date) {
  return {
    inline_keyboard: [[
      { text: texts.confirm.yes, callback_data: `do_clear_day_${date}` },
      { text: texts.confirm.no, callback_data: `cancel_clear_day_${date}` }
    ]]
  };
}

module.exports = {
  sendWeeklyPlanMenu,
  buildWeeklyPlanMessage,
  buildClearDayConfirmKeyboard
};
