const { Scenes } = require('telegraf');
const texts = require('../../bot/texts');
const logger = require('../../utils/logger');
const { TARGET_FIELDS, parseTargetValue, updateTarget } = require('./targets');
const { buildTargetsScreen, buildMismatchWarning } = require('../../interface/macro-targets');
const { escapable } = require('../../bot/scene-escape');

const SCENE_ID = 'macro_target_edit';
const EDIT_CALLBACK = /^macro_edit_(calories|protein|fat|carbs)$/;

const invalidText = (field) => (field === 'calories'
  ? texts.macroTargets.invalid.calories
  : texts.macroTargets.invalid.macro);

/**
 * Handles an "edit …" button press while the scene waits for a number:
 * switches the edited field (other buttons leave the scene, see escapable).
 * @param {import('telegraf').Context} ctx
 */
async function handleCallbackWhileWaiting(ctx) {
  await ctx.answerCbQuery();
  const match = EDIT_CALLBACK.exec(ctx.callbackQuery.data || '');
  if (!match) return;
  ctx.wizard.state.field = match[1];
  await ctx.reply(texts.macroTargets.ask[match[1]]);
}

/**
 * Validates and saves the entered value, then shows the norms screen.
 * @param {import('telegraf').Context} ctx
 */
async function handleValue(ctx) {
  const { field } = ctx.wizard.state;
  const value = parseTargetValue(field, ctx.message?.text);
  if (value === null) {
    await ctx.reply(invalidText(field));
    return;
  }
  try {
    const targets = await updateTarget(ctx.from.id, field, value);
    const warning = buildMismatchWarning(targets);
    await ctx.reply(warning ? `${texts.macroTargets.saved}\n\n${warning}` : texts.macroTargets.saved);
    const { text, extra } = buildTargetsScreen(targets);
    await ctx.reply(text, extra);
  } catch (error) {
    logger.error('Error saving macro target:', error);
    await ctx.reply(texts.macroTargets.errorSave);
  }
  await ctx.scene.leave();
}

// [RU] Одна сцена на все четыре нормы: редактируемое поле приходит в
// initial state (`ctx.scene.enter(SCENE_ID, { field })`). Кнопки «Изменить …»
// намеренно не регистрируются через scene.action: при входе сцена прогоняет
// тот же callback через свои хэндлеры, и scene.action на нём вошёл бы
// в сцену повторно по кругу.
// [EN] One scene for all four targets: the edited field comes via initial
// state. "Edit …" buttons are deliberately not scene.action handlers: on
// enter the scene runs the same callback through its handlers, and such a
// handler would re-enter the scene in a loop.
const scene = new Scenes.WizardScene(
  SCENE_ID,
  async (ctx) => {
    const { field } = ctx.wizard.state;
    if (!TARGET_FIELDS[field]) {
      logger.error(`macro_target_edit entered with unknown field: ${field}`);
      return ctx.scene.leave();
    }
    await ctx.reply(texts.macroTargets.ask[field]);
    return ctx.wizard.next();
  },
  // [RU] Кнопки «Изменить …» — часть сценария (переключают поле); прочие
  // кнопки, кнопки главного меню и команды выводят из сцены.
  // [EN] "Edit …" buttons belong to the flow (switch the field); other
  // buttons, main-menu buttons and commands leave the scene.
  escapable(async (ctx) => {
    if (ctx.callbackQuery) return handleCallbackWhileWaiting(ctx);
    return handleValue(ctx);
  }, { ownCallback: EDIT_CALLBACK })
);

scene.command('cancel', async (ctx) => {
  await ctx.reply(texts.macroTargets.canceled);
  return ctx.scene.leave();
});

module.exports = {
  macroTargetScene: scene,
  SCENE_ID
};
