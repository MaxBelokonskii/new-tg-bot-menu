const { Scenes } = require('telegraf');
const texts = require('../../bot/texts');
const logger = require('../../utils/logger');
const { PREF_KINDS, addPrefsFromText, listPrefs } = require('./logic');
const { buildPrefsScreen, buildAddPrompt, buildAddResult } = require('../../interface/ingredient-prefs');
const { escapable } = require('../../bot/scene-escape');

const SCENE_ID = 'ingredient_prefs_add';
const KINDS = new Set(Object.values(PREF_KINDS));
const T = texts.ingredientPrefs;
const CANCEL_CALLBACK = 'prefs_add_cancel';
const OWN_CALLBACK = /^prefs_add_cancel$/;

/**
 * Sends the refreshed list screen as a new message.
 * @param {import('telegraf').Context} ctx
 * @param {string} kind
 */
async function sendListScreen(ctx, kind) {
  const { text, extra } = buildPrefsScreen(kind, await listPrefs(ctx.from.id, kind));
  await ctx.reply(text, extra);
}

/**
 * Leaves the scene and shows the list again (cancel button or /cancel).
 * @param {import('telegraf').Context} ctx
 */
async function cancel(ctx) {
  const { kind } = ctx.wizard.state;
  await ctx.reply(T.canceled);
  await ctx.scene.leave();
  await sendListScreen(ctx, kind);
}

/**
 * Saves the typed products. When nothing is recognized the scene keeps
 * waiting; otherwise it reports the result, shows the list and leaves.
 * @param {import('telegraf').Context} ctx
 */
async function handleInput(ctx) {
  const { kind } = ctx.wizard.state;
  const text = ctx.message?.text;
  if (!text) {
    await ctx.reply(T.invalidInput);
    return;
  }
  try {
    const { text: summary, recognized } = buildAddResult(kind, await addPrefsFromText(ctx.from.id, kind, text));
    await ctx.reply(summary);
    if (!recognized) return;
    await ctx.scene.leave();
    await sendListScreen(ctx, kind);
  } catch (error) {
    logger.error('Error saving ingredient prefs:', error);
    await ctx.reply(T.errorSave);
    await ctx.scene.leave();
  }
}

// [RU] Тип списка приходит в initial state (`ctx.scene.enter(SCENE_ID, { kind })`).
// Кнопки «➕ Добавить» не регистрируются через scene.action — см. комментарий
// в features/profile/targets-scene.js (повторный вход по кругу).
// [EN] The list kind comes via initial state. "Add" buttons are not
// scene.action handlers — see features/profile/targets-scene.js (re-entry loop).
const scene = new Scenes.WizardScene(
  SCENE_ID,
  async (ctx) => {
    const { kind } = ctx.wizard.state;
    if (!KINDS.has(kind)) {
      logger.error(`${SCENE_ID} entered with unknown kind: ${kind}`);
      return ctx.scene.leave();
    }
    const { text, extra } = buildAddPrompt(kind);
    await ctx.reply(text, extra);
    return ctx.wizard.next();
  },
  // [RU] Своя inline-кнопка здесь одна — «Отмена»; остальные кнопки, кнопки
  // главного меню и команды выводят из сцены (bot/scene-escape.js).
  // [EN] The only own inline button is "Cancel"; other buttons, main-menu
  // buttons and commands leave the scene (bot/scene-escape.js).
  escapable(async (ctx) => {
    if (ctx.callbackQuery?.data === CANCEL_CALLBACK) {
      await ctx.answerCbQuery();
      return cancel(ctx);
    }
    return handleInput(ctx);
  }, { ownCallback: OWN_CALLBACK })
);

scene.command('cancel', cancel);

module.exports = {
  ingredientPrefsScene: scene,
  SCENE_ID
};
