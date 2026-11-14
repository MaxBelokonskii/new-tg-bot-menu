const { Markup } = require('telegraf');
const texts = require('../bot/texts');
const { macrosToCalories, isMacroMismatch } = require('../utils/calculations');

/**
 * Builds the "my macro targets" screen: current kcal/P/F/C, manual/auto
 * marker, calories implied by the macros and edit/recalc/back buttons.
 *
 * @param {{calories: number, protein: number, fat: number, carbs: number, manual: boolean}} targets
 * @returns {{text: string, extra: object}}
 */
function buildTargetsScreen(targets) {
  const T = texts.macroTargets;
  const U = texts.profile.units;
  const lines = [
    T.title,
    '',
    `• ${T.labels.calories}: ${targets.calories} ${U.kcal}`,
    `• ${T.labels.protein}: ${targets.protein} ${U.grams}`,
    `• ${T.labels.fat}: ${targets.fat} ${U.grams}`,
    `• ${T.labels.carbs}: ${targets.carbs} ${U.grams}`,
    '',
    T.fromMacros.replace('{kcal}', macrosToCalories(targets)),
    targets.manual ? T.manualMark : T.autoMark
  ];
  const btn = (field) => Markup.button.callback(T.buttons[field], `macro_edit_${field}`);
  const keyboard = Markup.inlineKeyboard([
    [btn('calories')],
    [btn('protein'), btn('fat'), btn('carbs')],
    [Markup.button.callback(T.buttons.recalc, 'macro_recalc')],
    [Markup.button.callback(T.buttons.back, 'macro_back')]
  ]);
  return { text: lines.join('\n'), extra: { parse_mode: 'HTML', ...keyboard } };
}

/**
 * Returns the soft warning shown when P×4 + F×9 + C×4 differs from the
 * calorie target by more than 10 %, or null when the numbers agree.
 *
 * @param {{calories: number, protein: number, fat: number, carbs: number}} targets
 * @returns {string|null}
 */
function buildMismatchWarning(targets) {
  if (!isMacroMismatch(targets)) return null;
  return texts.macroTargets.mismatchWarning
    .replace('{macroKcal}', macrosToCalories(targets))
    .replace('{kcal}', targets.calories);
}

module.exports = {
  buildTargetsScreen,
  buildMismatchWarning
};
