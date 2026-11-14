const texts = require('../texts');
const logger = require('../../utils/logger');
const { safeEdit } = require('./helpers');
const { showPlanDay } = require('./plan-view');
const { getUserClock } = require('../../features/time-zone/logic');
const { planWeeks, weekKindOfMonday } = require('../../features/weekly-planner/plan-weeks');
const {
  generateWeeklyPlan,
  countWeekItems,
  EmptyCategoryError,
  GENERATION_MODES
} = require('../../features/weekly-planner/generator');
const {
  sendWeeklyPlanMenu,
  buildWeekChoice,
  buildRegenerateChoice,
  formatGenerationResult
} = require('../../interface/weekly-plan');

const T = texts.weeklyPlan;
const MONDAY = '(\\d{4}-\\d{2}-\\d{2})';

// [RU] Английские ключи категорий из БД → локализованные подписи для UI.
// [EN] DB category keys (en) → localized labels for UI.
const CATEGORY_LABEL = {
  breakfast: texts.categories.breakfast,
  main: texts.categories.main,
  salads: texts.categories.salad,
  desserts: texts.categories.dessert
};

/**
 * Shows the "which week?" choice in place of the callback message.
 * @param {import('telegraf').Context} ctx
 * @param {string} today - YYYY-MM-DD, the user's local today
 * @param {string} [toast]
 */
async function showWeekChoice(ctx, today, toast) {
  await ctx.answerCbQuery(toast);
  const { text, extra } = buildWeekChoice(today);
  await safeEdit(ctx, text, extra);
}

/**
 * Resolves the Monday from callback_data into a plan week at click time.
 *
 * [RU] Принимаем только понедельник текущей или следующей недели
 * пользователя: кнопка, нажатая через неделю (или подделанная), отвечает
 * «устарело» и заново показывает выбор недели.
 * [EN] Only the Monday of the user's current or next week is accepted: a
 * button pressed a week later (or a forged one) answers "stale" and shows
 * the week choice again.
 *
 * @param {import('telegraf').Context} ctx
 * @param {string} monday - YYYY-MM-DD
 * @returns {Promise<{kind: 'current'|'next', week: {start: string, endExclusive: string},
 *   clock: object}|null>} null when stale (already answered)
 */
async function resolveTargetWeek(ctx, monday) {
  const clock = await getUserClock(ctx.from.id);
  const kind = weekKindOfMonday(monday, clock.today);
  if (!kind) {
    await showWeekChoice(ctx, clock.today, T.staleWeek);
    return null;
  }
  return { kind, week: planWeeks(clock.today)[kind], clock };
}

/**
 * Generates the chosen week, turns the prompt message into the result (so
 * its buttons can't be pressed twice) and opens the plan: today for the
 * current week, Monday for the next one.
 * @param {import('telegraf').Context} ctx
 * @param {{kind: 'current'|'next', week: object, clock: object}} target
 * @param {'overwrite'|'fill'} mode
 */
async function runGeneration(ctx, { kind, week, clock }, mode) {
  try {
    const { slotsWritten } = await generateWeeklyPlan(ctx.from.id, { week, mode });
    await safeEdit(ctx, formatGenerationResult(kind, week.start, slotsWritten));
    if (slotsWritten === 0) return;
    const day = kind === 'current' ? clock.today : week.start;
    await showPlanDay(ctx, day, { edit: false, clock });
  } catch (error) {
    logger.error('Error generating weekly plan:', error);
    // [RU] Специализированная подсказка при «пустой категории после исключений».
    // [EN] Specialized hint for the "no recipes after exclusions" case.
    if (error instanceof EmptyCategoryError) {
      const label = CATEGORY_LABEL[error.category] || error.category;
      await ctx.reply(T.noRecipesForCategory.replace('{category}', label));
      return;
    }
    await ctx.reply(T.errorGenerate);
  }
}

/**
 * A week was chosen: an empty week is generated right away; otherwise the
 * user chooses between overwriting everything and filling empty slots (4.17).
 * @param {import('telegraf').Context} ctx
 */
async function handleWeekChosen(ctx) {
  const target = await resolveTargetWeek(ctx, ctx.match[1]);
  if (!target) return;
  const count = await countWeekItems(ctx.from.id, target.week);
  if (count === 0) {
    await ctx.answerCbQuery(T.generating);
    await runGeneration(ctx, target, GENERATION_MODES.OVERWRITE);
    return;
  }
  await ctx.answerCbQuery();
  const { text, extra } = buildRegenerateChoice(target.kind, target.week.start, count);
  await safeEdit(ctx, text, extra);
}

/**
 * Wraps a handler with error logging and an error toast.
 * @param {string} label
 * @param {(ctx: import('telegraf').Context) => Promise<void>} fn
 */
function guarded(label, fn) {
  return async (ctx) => {
    try {
      await fn(ctx);
    } catch (error) {
      logger.error(`Plan generation: error ${label}:`, error);
      await ctx.answerCbQuery(T.errorGenerate).catch(() => {});
    }
  };
}

/**
 * Registers plan generation: week choice (`generate_weekly_plan` →
 * `gen_week_<monday>`), the overwrite/fill question
 * (`generate_weekly_plan_<mode>_<monday>`) and cancel.
 * @param {import('telegraf').Telegraf} bot
 */
function register(bot) {
  bot.action('generate_weekly_plan', guarded('showing week choice', async (ctx) => {
    await showWeekChoice(ctx, (await getUserClock(ctx.from.id)).today);
  }));

  bot.action(new RegExp(`^gen_week_${MONDAY}$`), guarded('choosing week', handleWeekChosen));

  bot.action(new RegExp(`^generate_weekly_plan_(overwrite|fill)_${MONDAY}$`), guarded('generating', async (ctx) => {
    const target = await resolveTargetWeek(ctx, ctx.match[2]);
    if (!target) return;
    await ctx.answerCbQuery(T.generating);
    await runGeneration(ctx, target, ctx.match[1]);
  }));

  bot.action('cancel_generate_weekly_plan', async (ctx) => {
    await ctx.answerCbQuery(texts.confirm.canceled);
    try {
      await sendWeeklyPlanMenu(ctx);
    } catch (error) {
      logger.error('Error restoring weekly plan menu:', error);
    }
  });
}

module.exports = { register };
