const texts = require('../texts');
const logger = require('../../utils/logger');
const { safeEdit } = require('./helpers');
const { SCENE_ID } = require('../../features/reverse-search/scene');
const {
  findRecipesByInventory,
  getUserTargets,
  getRecipeById
} = require('../../features/reverse-search/logic');
const { getRecipeIngredients } = require('../../features/meal-suggestions/logic');
const { buildResultsMessage, buildRecipeCard } = require('../../interface/reverse-search');

/**
 * Returns the pantry saved by the reverse-search scene, or null (and tells
 * the user) when the session has expired.
 * @param {import('telegraf').Context} ctx
 * @returns {Promise<string[]|null>}
 */
async function requireInventory(ctx) {
  const inventory = ctx.session?.reverseInventory;
  if (Array.isArray(inventory) && inventory.length > 0) return inventory;
  await ctx.reply(texts.reverseSearch.sessionExpired);
  return null;
}

function enterScene(logLabel) {
  return async (ctx) => {
    if (ctx.callbackQuery) await ctx.answerCbQuery();
    try {
      await ctx.scene.enter(SCENE_ID);
    } catch (error) {
      logger.error(`Error ${logLabel} reverse-search scene:`, error);
      await ctx.reply(texts.errors.general);
    }
  };
}

/**
 * Registers "what can I cook from my pantry" handlers.
 * @param {import('telegraf').Telegraf} bot
 */
function register(bot) {
  bot.hears(texts.mainMenu.buttons.reverseSearch, enterScene('entering'));
  bot.action('reverse_retry', enterScene('re-entering'));

  bot.action(/^reverse_show_(\d+)$/, async (ctx) => {
    const recipeId = parseInt(ctx.match[1], 10);
    await ctx.answerCbQuery();
    try {
      const inventory = await requireInventory(ctx);
      if (!inventory) return;
      const recipe = await getRecipeById(recipeId);
      if (!recipe) return ctx.reply(texts.errors.general);
      const ingredients = await getRecipeIngredients(recipeId);
      const inventorySet = new Set(inventory);
      const missing = ingredients.map(i => i.name).filter(name => !inventorySet.has(name));
      const card = buildRecipeCard(recipe, ingredients, missing);
      await safeEdit(ctx, card.text, { parse_mode: 'HTML', ...card.keyboard });
    } catch (error) {
      logger.error('Error showing reverse-search recipe card:', error);
      await ctx.reply(texts.errors.general);
    }
  });

  bot.action('reverse_back_to_list', async (ctx) => {
    await ctx.answerCbQuery();
    try {
      const inventory = await requireInventory(ctx);
      if (!inventory) return;
      const targets = await getUserTargets(ctx.from.id);
      const recipes = await findRecipesByInventory(inventory, targets);
      const payload = buildResultsMessage(recipes, []);
      if (!payload) return safeEdit(ctx, texts.reverseSearch.noResults);
      await safeEdit(ctx, payload.text, { parse_mode: 'HTML', ...payload.keyboard });
    } catch (error) {
      logger.error('Error restoring reverse-search list:', error);
      await ctx.reply(texts.errors.general);
    }
  });
}

module.exports = { register };
