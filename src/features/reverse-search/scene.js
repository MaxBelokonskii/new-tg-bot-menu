const { Scenes } = require('telegraf');
const texts = require('../../bot/texts');
const logger = require('../../utils/logger');
const {
  parseInventory,
  findRecipesByInventory,
  getUserTargets
} = require('./logic');
const { buildResultsMessage } = require('../../interface/reverse-search');

const SCENE_ID = 'reverse_search';

const scene = new Scenes.WizardScene(
  SCENE_ID,
  // Step 0: show hint + examples, wait for the text message.
  async (ctx) => {
    await ctx.reply(texts.reverseSearch.askInventory, { parse_mode: 'HTML' });
    return ctx.wizard.next();
  },
  // Step 1: receive comma-separated text, normalize, render results, leave.
  async (ctx) => {
    const text = ctx.message?.text;
    if (!text || typeof text !== 'string') {
      await ctx.reply(texts.reverseSearch.invalidInput);
      return;
    }
    const { canonical, unknown } = parseInventory(text);
    if (canonical.length === 0) {
      await ctx.reply(texts.reverseSearch.nothingMatched);
      return ctx.scene.leave();
    }

    try {
      const targets = await getUserTargets(ctx.from.id);
      const recipes = await findRecipesByInventory(canonical, targets);
      // [RU] Сохраняем инвентарь в session — нужен, когда юзер тапнет кнопку
      // рецепта: карточка хочет показать «не хватает: …».
      // [EN] Persist inventory in session — needed when the user taps a recipe
      // button: the detail card highlights "missing: …".
      ctx.session.reverseInventory = canonical;

      const payload = buildResultsMessage(recipes, unknown);
      if (!payload) {
        await ctx.reply(texts.reverseSearch.noResults);
        return ctx.scene.leave();
      }
      await ctx.reply(payload.text, { parse_mode: 'HTML', ...payload.keyboard });
    } catch (error) {
      logger.error('Error running reverse search:', error);
      await ctx.reply(texts.errors.general);
    }
    return ctx.scene.leave();
  }
);

scene.command('cancel', async (ctx) => {
  await ctx.reply(texts.reverseSearch.canceled);
  return ctx.scene.leave();
});

module.exports = {
  reverseSearchScene: scene,
  SCENE_ID
};
