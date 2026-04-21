const { Scenes, Markup } = require('telegraf');
const texts = require('../../bot/texts');
const logger = require('../../utils/logger');
const { saveUserProfile } = require('./logic');
const { buildProfileSummary } = require('../../interface/profile');

const SCENE_ID = 'profile_survey';

// [RU] Шаги, на которых ожидаем ответ кнопкой. Номер шага совпадает с cursor
// после соответствующего wizard.next(). Используется в guard-ах action-хэндлеров,
// чтобы залетевший старый callback_query не сбил wizard.
// [EN] Steps where we expect a button press. Cursor values guard action
// handlers so a stale callback from a previous survey cannot desync the wizard.
const STEP = Object.freeze({
  SEX: 4,
  ACTIVITY: 5,
  GOAL: 6
});

const parseNumber = (text) => parseFloat(String(text || '').replace(',', '.').trim());
const isValidWeight = (w) => Number.isFinite(w) && w >= 30 && w <= 300;
const isValidHeight = (h) => Number.isFinite(h) && h >= 100 && h <= 250;
const isValidAge = (a) => Number.isInteger(a) && a >= 10 && a <= 120;

const sexKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback(texts.profile.sex.male, 'profile_sex_male')],
  [Markup.button.callback(texts.profile.sex.female, 'profile_sex_female')]
]);

const activityKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback(texts.profile.activity.sedentary, 'profile_act_sedentary')],
  [Markup.button.callback(texts.profile.activity.light, 'profile_act_light')],
  [Markup.button.callback(texts.profile.activity.moderate, 'profile_act_moderate')],
  [Markup.button.callback(texts.profile.activity.active, 'profile_act_active')],
  [Markup.button.callback(texts.profile.activity.very_active, 'profile_act_very_active')]
]);

const goalKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback(texts.profile.goal.loss, 'profile_goal_loss')],
  [Markup.button.callback(texts.profile.goal.maintain, 'profile_goal_maintain')],
  [Markup.button.callback(texts.profile.goal.gain, 'profile_goal_gain')]
]);

const scene = new Scenes.WizardScene(
  SCENE_ID,
  // Step 0: приглашение + первый вопрос
  async (ctx) => {
    await ctx.reply(texts.profile.askWeight);
    return ctx.wizard.next();
  },
  // Step 1: вес → рост
  async (ctx) => {
    const w = parseNumber(ctx.message?.text);
    if (!isValidWeight(w)) {
      return ctx.reply(texts.profile.invalidWeight);
    }
    ctx.wizard.state.weight = w;
    await ctx.reply(texts.profile.askHeight);
    return ctx.wizard.next();
  },
  // Step 2: рост → возраст
  async (ctx) => {
    const h = parseNumber(ctx.message?.text);
    if (!isValidHeight(h)) {
      return ctx.reply(texts.profile.invalidHeight);
    }
    ctx.wizard.state.height = h;
    await ctx.reply(texts.profile.askAge);
    return ctx.wizard.next();
  },
  // Step 3: возраст → пол
  async (ctx) => {
    const a = parseInt(ctx.message?.text, 10);
    if (!isValidAge(a)) {
      return ctx.reply(texts.profile.invalidAge);
    }
    ctx.wizard.state.age = a;
    await ctx.reply(texts.profile.askSex, sexKeyboard);
    return ctx.wizard.next();
  },
  // Steps 4..6: ответ приходит через callback-кнопки; текстовый ввод мягко
  // напоминаем кликнуть по кнопке.
  async (ctx) => { if (ctx.message?.text) await ctx.reply(texts.profile.askSex); },
  async (ctx) => { if (ctx.message?.text) await ctx.reply(texts.profile.askActivity); },
  async (ctx) => { if (ctx.message?.text) await ctx.reply(texts.profile.askGoal); }
);

scene.action(/^profile_sex_(male|female)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (ctx.wizard.cursor !== STEP.SEX) return;
  ctx.wizard.state.sex = ctx.match[1];
  await ctx.editMessageText(`${texts.profile.labels.sex}: ${texts.profile.sex[ctx.match[1]]}`);
  await ctx.reply(texts.profile.askActivity, activityKeyboard);
  return ctx.wizard.next();
});

scene.action(/^profile_act_(sedentary|light|moderate|active|very_active)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (ctx.wizard.cursor !== STEP.ACTIVITY) return;
  ctx.wizard.state.activity_level = ctx.match[1];
  await ctx.editMessageText(
    `${texts.profile.labels.activity}: ${texts.profile.activity[ctx.match[1]]}`
  );
  await ctx.reply(texts.profile.askGoal, goalKeyboard);
  return ctx.wizard.next();
});

scene.action(/^profile_goal_(loss|maintain|gain)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (ctx.wizard.cursor !== STEP.GOAL) return;
  ctx.wizard.state.goal = ctx.match[1];
  await ctx.editMessageText(
    `${texts.profile.labels.goal}: ${texts.profile.goal[ctx.match[1]]}`
  );
  try {
    await saveUserProfile(ctx.from.id, ctx.wizard.state);
    await ctx.reply(texts.profile.saved);
    await ctx.reply(buildProfileSummary(ctx.wizard.state), { parse_mode: 'HTML' });
  } catch (error) {
    logger.error('Error saving profile:', error);
    await ctx.reply(texts.profile.errorSave);
  }
  return ctx.scene.leave();
});

scene.command('cancel', async (ctx) => {
  await ctx.reply(texts.profile.canceled);
  return ctx.scene.leave();
});

module.exports = {
  profileScene: scene,
  SCENE_ID
};
