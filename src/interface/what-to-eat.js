const { Markup } = require('telegraf');
const texts = require('../bot/texts');
const { fillNutrition, formatPortion } = require('./food-log');
const { formatLocalDate } = require('../utils/date-helpers');
const { DONE_KCAL } = require('../features/what-to-eat/scoring');

const T = texts.whatToEat;

const halvesOf = (portion) => Math.round(portion * 2);
const withPortion = (name, portion) => (portion === 1
  ? name
  : name + texts.foodLog.portionSuffix.replace('{portion}', formatPortion(portion)));

/**
 * "останется: …" line after eating the option.
 * @param {object} remaining
 * @param {object} nutrition
 * @returns {string}
 */
function afterLine(remaining, nutrition) {
  const left = {};
  for (const key of Object.keys(nutrition)) left[key] = Math.max(0, remaining[key] - nutrition[key]);
  return fillNutrition(T.after, left);
}

function favoriteMark(recipe, prefs) {
  return recipe.ingredientIds.some(id => prefs.favorite.has(id)) ? T.favoriteMark : '';
}

function formatSingle(option, n, remaining, prefs) {
  const name = withPortion(option.recipe.name, option.portion) + favoriteMark(option.recipe, prefs);
  return [
    fillNutrition(T.option.replace('{n}', n).replace('{name}', name), option.nutrition),
    afterLine(remaining, option.nutrition)
  ];
}

function formatCombo(combo, n, remaining, prefs) {
  const name = combo.items
    .map(it => withPortion(it.recipe.name, it.portion) + favoriteMark(it.recipe, prefs))
    .join(T.comboJoin);
  return [
    fillNutrition(T.option.replace('{n}', n).replace('{name}', name), combo.nutrition),
    afterLine(remaining, combo.nutrition)
  ];
}

/**
 * Buttons for one option: "🍽 Съел N" and "➕ В план N".
 * Single: wte_eat_<id>_<halves> / wte_plan_<id>;
 * combo: wte_eatc_<id>x<halves>-… / wte_planc_<id>-….
 */
function optionRow(option, n) {
  const label = (key) => T.buttons[key].replace('{n}', n);
  if (option.items) {
    const eat = option.items.map(it => `${it.recipe.id}x${halvesOf(it.portion)}`).join('-');
    const plan = option.items.map(it => it.recipe.id).join('-');
    return [
      Markup.button.callback(label('eat'), `wte_eatc_${eat}`),
      Markup.button.callback(label('plan'), `wte_planc_${plan}`)
    ];
  }
  return [
    Markup.button.callback(label('eat'), `wte_eat_${option.recipe.id}_${halvesOf(option.portion)}`),
    Markup.button.callback(label('plan'), `wte_plan_${option.recipe.id}`)
  ];
}

const backRow = () => [Markup.button.callback(T.buttons.back, `fl_day_${formatLocalDate(new Date())}`)];

/**
 * Builds the suggestions screen for a getSuggestions() result.
 * @param {{status: string, remaining?: object, singles?: Array, combos?: Array, page?: number}} result
 * @param {{favorite: Set<number>}} prefs - for ❤️ marks
 * @returns {{text: string, extra: object}}
 */
function buildSuggestionsScreen(result, prefs) {
  const lines = [T.title, ''];
  const rows = [];
  if (result.status === 'done') {
    lines.push(T.done.replace('{kcal}', DONE_KCAL));
  } else if (result.status === 'over') {
    lines.push(T.over.replace('{kcal}', Math.round(-result.remaining.calories)));
  } else {
    lines.push(fillNutrition(T.remaining, result.remaining), '');
    const options = [...result.singles, ...result.combos];
    if (options.length === 0) lines.push(T.noCandidates);
    if (result.singles.length > 0) {
      lines.push(T.singlesHeader);
      result.singles.forEach((o, i) => lines.push(...formatSingle(o, i + 1, result.remaining, prefs)));
    }
    if (result.combos.length > 0) {
      lines.push('', T.combosHeader);
      result.combos.forEach((c, i) => lines.push(
        ...formatCombo(c, result.singles.length + i + 1, result.remaining, prefs)
      ));
    }
    if (options.length > 0) {
      lines.push('', T.hint);
      options.forEach((o, i) => rows.push(optionRow(o, i + 1)));
      rows.push([Markup.button.callback(T.buttons.more, `wte_show_${result.page + 1}`)]);
    }
  }
  rows.push(backRow());
  return { text: lines.join('\n'), extra: { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) } };
}

module.exports = { buildSuggestionsScreen };
