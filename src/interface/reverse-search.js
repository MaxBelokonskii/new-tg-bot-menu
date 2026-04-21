const { Markup } = require('telegraf');
const texts = require('../bot/texts');

/**
 * Builds the HTML message + inline keyboard with numbered recipe buttons
 * for the reverse-search result list.
 *
 * @param {Array<{id:number,name:string,calories:number,missing:string[]}>} recipes
 * @param {string[]} unknownTokens - user tokens that didn't match any ingredient
 * @returns {{text: string, keyboard: object} | null}
 */
function buildResultsMessage(recipes, unknownTokens) {
  if (!recipes || recipes.length === 0) return null;

  const lines = [`<b>${texts.reverseSearch.resultsHeader}</b>`, ''];
  if (unknownTokens && unknownTokens.length > 0) {
    const list = unknownTokens.map(t => `«${t}»`).join(', ');
    lines.push(`<i>${texts.reverseSearch.unknownPrefix} ${list}</i>`, '');
  }

  recipes.forEach((recipe, idx) => {
    const num = idx + 1;
    let line = `${num}. <b>${recipe.name}</b> — ${recipe.calories} ${texts.reverseSearch.kcalSuffix}`;
    if (recipe.missing.length === 0) {
      line += ` ${texts.reverseSearch.fullMatchBadge}`;
    } else {
      const missing = recipe.missing.join(', ');
      line += `\n   <i>${texts.reverseSearch.missingLabel} ${missing}</i>`;
    }
    lines.push(line);
  });

  const rows = [];
  const chunkSize = 5;
  for (let i = 0; i < recipes.length; i += chunkSize) {
    const row = recipes.slice(i, i + chunkSize).map((r, j) =>
      Markup.button.callback(String(i + j + 1), `reverse_show_${r.id}`)
    );
    rows.push(row);
  }
  rows.push([Markup.button.callback(texts.reverseSearch.retryBtn, 'reverse_retry')]);

  return {
    text: lines.join('\n'),
    keyboard: Markup.inlineKeyboard(rows)
  };
}

/**
 * Builds a recipe detail card highlighting which ingredients the user is
 * missing from their typed inventory. "✅ В рацион" button reuses the
 * existing confirm_dish_<id> handler from the dish-selection flow.
 *
 * @param {object} recipe - full recipe row with description/nutrition
 * @param {Array<{name:string,amount:number,unit:string}>} ingredients
 * @param {string[]} missingNames - canonical names missing from inventory
 * @returns {{text: string, keyboard: object}}
 */
function buildRecipeCard(recipe, ingredients, missingNames) {
  const missingSet = new Set(missingNames);
  const ingredientLines = ingredients.map(i => {
    const mark = missingSet.has(i.name) ? '❗️' : '✅';
    return `${mark} ${i.name}: ${i.amount} ${i.unit}`;
  }).join('\n');

  const header = `<b>${recipe.name}</b>`;
  const nutrition = `КБЖУ: ${recipe.calories} / ${recipe.protein} / ${recipe.fat} / ${recipe.carbs}`;
  const missingSummary = missingNames.length === 0
    ? texts.reverseSearch.cardFullMatch
    : texts.reverseSearch.cardMissingSummary.replace('{list}', missingNames.join(', '));

  const text = [
    header,
    '',
    nutrition,
    '',
    missingSummary,
    '',
    `<b>${texts.reverseSearch.ingredientsLabel}</b>`,
    ingredientLines,
    '',
    `<b>${texts.reverseSearch.recipeLabel}</b>`,
    recipe.description || texts.reverseSearch.noDescription
  ].join('\n');

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(texts.reverseSearch.addBtn, `confirm_dish_${recipe.id}`)],
    [Markup.button.callback(texts.reverseSearch.backToList, 'reverse_back_to_list')]
  ]);

  return { text, keyboard };
}

module.exports = {
  buildResultsMessage,
  buildRecipeCard
};
