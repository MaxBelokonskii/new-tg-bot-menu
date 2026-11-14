const { Markup } = require('telegraf');
const texts = require('../texts');
const logger = require('../../utils/logger');
const { safeEdit, safeEditMarkup } = require('./helpers');
const { isFavorite, setFavorite, listFavorites } = require('../../features/favorite-recipes/logic');
const { getRecipeById } = require('../../features/reverse-search/logic');
const { buildDishCard } = require('../../interface/dish-selection');
const { buildFavoritesList, flipFavoriteButton } = require('../../interface/favorite-recipes');

const T = texts.favoriteRecipes;

async function showList(ctx, page) {
  const { text, extra } = buildFavoritesList(await listFavorites(ctx.from.id, page));
  await safeEdit(ctx, text, extra);
}

/**
 * "⭐ В избранное" / "⭐ Убрать из избранного" on any recipe card.
 * [RU] Кнопка несёт желаемое состояние (add/rm), а не «переключить», — двойное
 * нажатие не отменяет само себя. Перерисовывается только клавиатура карточки.
 * [EN] The button carries the wanted state (add/rm), not "toggle", so a double
 * tap does not undo itself. Only the card's keyboard is redrawn.
 * @param {import('telegraf').Context} ctx
 */
async function handleToggle(ctx) {
  const recipeId = Number(ctx.match[2]);
  let state;
  try {
    state = await setFavorite(ctx.from.id, recipeId, ctx.match[1] === 'add');
  } catch (error) {
    logger.error('Favorites: error saving:', error);
    await ctx.answerCbQuery(T.errorSave).catch(() => {});
    return;
  }
  if (state === null) {
    await ctx.answerCbQuery(T.recipeNotFound);
    return;
  }
  await ctx.answerCbQuery(state ? T.added : T.removed);
  const markup = flipFavoriteButton(ctx.callbackQuery.message?.reply_markup, recipeId, state);
  if (markup) await safeEditMarkup(ctx, markup);
}

/**
 * Opens a recipe card from the favorites list; "back" returns to the same page.
 * @param {import('telegraf').Context} ctx
 */
async function handleOpen(ctx) {
  const [, recipeId, page] = ctx.match.map(Number);
  const recipe = await getRecipeById(recipeId);
  if (!recipe) {
    await ctx.answerCbQuery(T.recipeNotFound);
    await showList(ctx, page);
    return;
  }
  await ctx.answerCbQuery();
  const { text, keyboard } = await buildDishCard(recipe, {
    favorite: await isFavorite(ctx.from.id, recipeId),
    back: Markup.button.callback(T.backToList, `fav_list_${page}`)
  });
  await safeEdit(ctx, text, { parse_mode: 'HTML', ...keyboard });
}

/**
 * Wraps a handler with error logging and a generic error reply.
 * @param {string} label
 * @param {(ctx: import('telegraf').Context) => Promise<void>} fn
 */
function guarded(label, fn) {
  return async (ctx) => {
    try {
      await fn(ctx);
    } catch (error) {
      logger.error(`Favorites: error ${label}:`, error);
      await ctx.reply(texts.errors.general);
    }
  };
}

/**
 * Registers favorite-recipe handlers: the ⭐ toggle on recipe cards, the
 * favorites list (opened from the category picker) and cards opened from it.
 * @param {import('telegraf').Telegraf} bot
 */
function register(bot) {
  bot.action(/^fav_(add|rm)_(\d+)$/, guarded('toggling', handleToggle));

  bot.action(/^fav_list_(\d+)$/, guarded('showing list', async (ctx) => {
    await ctx.answerCbQuery();
    await showList(ctx, Number(ctx.match[1]));
  }));

  bot.action(/^fav_open_(\d+)_(\d+)$/, guarded('opening card', handleOpen));
}

module.exports = { register };
