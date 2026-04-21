const { Markup } = require('telegraf');
const texts = require('../bot/texts');

/**
 * Builds HTML summary of saved profile fields.
 * @param {object} profile - row from user_preferences (get-shape)
 * @returns {string}
 */
function buildProfileSummary(profile) {
  const L = texts.profile.labels;
  return `${texts.profile.summaryHeader}\n` +
    `• ${L.weight}: ${profile.weight} кг\n` +
    `• ${L.height}: ${profile.height} см\n` +
    `• ${L.age}: ${profile.age}\n` +
    `• ${L.sex}: ${texts.profile.sex[profile.sex] || profile.sex}\n` +
    `• ${L.activity}: ${texts.profile.activity[profile.activity_level] || profile.activity_level}\n` +
    `• ${L.goal}: ${texts.profile.goal[profile.goal] || profile.goal}`;
}

/**
 * Renders the profile screen: summary (if filled) or empty-state hint,
 * plus a single start/edit button.
 * @param {object} ctx
 * @param {object|null} profile
 */
async function sendProfileMenu(ctx, profile) {
  if (!profile) {
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(texts.profile.startBtn, 'profile_start')]
    ]);
    const text = `${texts.profile.menuTitle}\n\n${texts.profile.emptyHint}`;
    return ctx.reply(text, keyboard);
  }
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(texts.profile.editBtn, 'profile_start')]
  ]);
  const text = `${texts.profile.menuTitle}\n\n${buildProfileSummary(profile)}`;
  return ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
}

module.exports = {
  buildProfileSummary,
  sendProfileMenu
};
