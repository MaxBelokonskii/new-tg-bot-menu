const texts = require('../texts');
const logger = require('../../utils/logger');
const { safeEdit } = require('./helpers');
const { showPlanDay } = require('./plan-view');
const planEdit = require('./plan-edit');
const { formatLocalDate } = require('../../utils/date-helpers');
const { sendWeeklyPlanMenu, buildRegenerateChoiceKeyboard } = require('../../interface/weekly-plan');
const {
  generateWeeklyPlan,
  countWeekItems,
  EmptyCategoryError,
  GENERATION_MODES
} = require('../../features/weekly-planner/generator');

// [RU] Английские ключи категорий из БД → локализованные подписи для UI.
// [EN] DB category keys (en) → localized labels for UI.
const CATEGORY_LABEL = {
  breakfast: texts.categories.breakfast,
  main: texts.categories.main,
  salads: texts.categories.salad,
  desserts: texts.categories.dessert
};

const today = () => formatLocalDate(new Date());

/**
 * Generates the week and reports the result. When `editPrompt` is set, the
 * "overwrite / fill" question message is replaced by the result so its
 * buttons can't be pressed twice.
 * @param {import('telegraf').Context} ctx
 * @param {'overwrite'|'fill'} mode
 * @param {boolean} editPrompt
 */
async function runGeneration(ctx, mode, editPrompt) {
  try {
    const { slotsWritten } = await generateWeeklyPlan(ctx.from.id, { mode });
    const resultText = slotsWritten === 0 ? texts.weeklyPlan.nothingToFill : texts.weeklyPlan.generated;
    if (editPrompt) await safeEdit(ctx, resultText);
    else await ctx.reply(resultText);
    if (slotsWritten > 0) await showPlanDay(ctx, today(), { edit: false });
  } catch (error) {
    logger.error('Error generating weekly plan:', error);
    // [RU] Специализированная подсказка при «пустой категории после исключений».
    // [EN] Specialized hint for the "no recipes after exclusions" case.
    if (error instanceof EmptyCategoryError) {
      const label = CATEGORY_LABEL[error.category] || error.category;
      return ctx.reply(texts.weeklyPlan.noRecipesForCategory.replace('{category}', label));
    }
    await ctx.reply(texts.weeklyPlan.errorGenerate);
  }
}

/**
 * "Generate" button: an empty week is generated right away; otherwise the
 * user chooses between overwriting everything and filling empty slots (4.17).
 * @param {import('telegraf').Context} ctx
 */
async function handleGenerate(ctx) {
  let count;
  try {
    count = await countWeekItems(ctx.from.id);
  } catch (error) {
    logger.error('Error counting week items:', error);
    await ctx.answerCbQuery(texts.weeklyPlan.errorGenerate).catch(() => {});
    return;
  }
  if (count === 0) {
    await ctx.answerCbQuery(texts.weeklyPlan.generating);
    return runGeneration(ctx, GENERATION_MODES.OVERWRITE, false);
  }
  await ctx.answerCbQuery();
  try {
    await safeEdit(ctx, texts.weeklyPlan.confirmRegenerate.replace('{count}', count), {
      reply_markup: buildRegenerateChoiceKeyboard()
    });
  } catch (error) {
    logger.error('Error showing regenerate choice:', error);
  }
}

function registerGenerate(bot) {
  bot.action('generate_weekly_plan', handleGenerate);

  bot.action(/^generate_weekly_plan_(overwrite|fill)$/, async (ctx) => {
    await ctx.answerCbQuery(texts.weeklyPlan.generating);
    await runGeneration(ctx, ctx.match[1], true);
  });

  bot.action('cancel_generate_weekly_plan', async (ctx) => {
    await ctx.answerCbQuery(texts.confirm.canceled);
    try {
      await sendWeeklyPlanMenu(ctx);
    } catch (error) {
      logger.error('Error restoring weekly plan menu:', error);
    }
  });
}

/**
 * Registers weekly-plan handlers: menu, day view with navigation, generation
 * and (via plan-edit.js) clearing/replacing/removing dishes.
 * @param {import('telegraf').Telegraf} bot
 */
function register(bot) {
  bot.hears(texts.mainMenu.buttons.weeklyPlan, (ctx) => sendWeeklyPlanMenu(ctx));

  registerGenerate(bot);

  // [RU] Просмотр открывает сегодняшний день недели; пустая неделя — прежний текст.
  // [EN] Viewing opens today's day of the week; an empty week keeps the old text.
  bot.action('view_weekly_plan', async (ctx) => {
    await ctx.answerCbQuery();
    try {
      if (await countWeekItems(ctx.from.id) === 0) {
        await ctx.reply(texts.weeklyPlan.empty);
        return;
      }
      await showPlanDay(ctx, today());
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
