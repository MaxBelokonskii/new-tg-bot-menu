const texts = require('./texts');

const MAIN_MENU_LABELS = new Set(Object.values(texts.mainMenu.buttons));

/**
 * True for a main-menu button label or a command (/cancel never reaches a
 * wizard step: scenes handle it with scene.command before the steps run).
 * @param {unknown} text
 * @returns {boolean}
 */
function isNavigationText(text) {
  return typeof text === 'string' && (MAIN_MENU_LABELS.has(text) || text.startsWith('/'));
}

/**
 * True when the update should leave the scene and be routed by the regular
 * handlers: a main-menu button, a command, or an inline button that is not
 * one of the scene's own buttons.
 *
 * @param {import('telegraf').Context} ctx
 * @param {{ownCallback?: RegExp}} [options] - callbacks matching `ownCallback`
 *   belong to the scene's own flow and keep the user inside it
 * @returns {boolean}
 */
function isEscapeUpdate(ctx, { ownCallback } = {}) {
  if (ctx.callbackQuery) {
    const data = ctx.callbackQuery.data || '';
    return !(ownCallback && ownCallback.test(data));
  }
  return isNavigationText(ctx.message?.text);
}

/**
 * Wraps a wizard step so that navigation updates leave the scene and are
 * passed on to the regular handlers instead of being treated as input.
 *
 * [RU] Без этого сцена «глотает» навигацию: нажатие «📅 План на неделю» во
 * время анкеты превращалось в «вес должен быть числом». leave() + next():
 * апдейт после выхода идёт дальше по цепочке middleware к bot.hears/action.
 * Повторного входа по кругу нет — при входе сцена прогоняет апдейт только
 * через шаг 0, а его не оборачиваем.
 * [EN] Without this a scene swallows navigation: pressing a main-menu button
 * during the survey became "weight must be a number". leave() + next(): after
 * leaving, the update continues down the middleware chain to bot.hears/action.
 * No re-entry loop — on enter a scene runs the update through step 0 only,
 * which is never wrapped.
 *
 * @param {(ctx: import('telegraf').Context, next: Function) => unknown} step
 * @param {{ownCallback?: RegExp}} [options] - see isEscapeUpdate
 * @returns {(ctx: import('telegraf').Context, next: Function) => Promise<unknown>}
 */
function escapable(step, options) {
  return async (ctx, next) => {
    if (isEscapeUpdate(ctx, options)) {
      await ctx.scene.leave();
      return next();
    }
    return step(ctx, next);
  };
}

module.exports = { isEscapeUpdate, escapable };
