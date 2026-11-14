const { Markup } = require('telegraf');
const texts = require('../bot/texts');

/**
 * Builds HTML summary of saved profile fields plus calorie breakdown
 * when the per-slot targets are present.
 *
 * @param {object} profile - row from user_preferences (get-shape)
 * @returns {string}
 */
function buildProfileSummary(profile) {
  const L = texts.profile.labels;
  const U = texts.profile.units;
  const lines = [
    texts.profile.summaryHeader,
    `• ${L.weight}: ${profile.weight} ${U.weight}`,
    `• ${L.height}: ${profile.height} ${U.height}`,
    `• ${L.age}: ${profile.age}`,
    `• ${L.sex}: ${texts.profile.sex[profile.sex] || profile.sex}`,
    `• ${L.activity}: ${texts.profile.activity[profile.activity_level] || profile.activity_level}`,
    `• ${L.goal}: ${texts.profile.goal[profile.goal] || profile.goal}`
  ];
  if (profile.target_calories) {
    lines.push('', buildCaloriesBlock(profile));
  }
  return lines.join('\n');
}

/**
 * Renders the calorie / per-slot block. Used inside the summary and as a
 * standalone "ваша раскладка" message at the end of the profile wizard.
 *
 * @param {object} data - object with target_calories and target_* per-slot keys,
 *   optionally bmr/tdee (survey finish flow)
 * @returns {string}
 */
function buildCaloriesBlock(data) {
  const C = texts.profile.calories;
  const U = texts.profile.units;
  const slotLines = [
    `• ${C.slots.breakfast}: ${data.target_breakfast} ${U.kcal}`,
    `• ${C.slots.main1}: ${data.target_main1} ${U.kcal}`,
    `• ${C.slots.main2}: ${data.target_main2} ${U.kcal}`,
    `• ${C.slots.salad}: ${data.target_salad} ${U.kcal}`,
    `• ${C.slots.dessert}: ${data.target_dessert} ${U.kcal}`
  ];
  const header = [C.header];
  if (data.bmr) header.push(`• ${C.bmr}: ${data.bmr} ${U.kcal}`);
  if (data.tdee) header.push(`• ${C.tdee}: ${data.tdee} ${U.kcal}`);
  header.push(`• ${C.target}: ${data.target_calories} ${U.kcal}`);
  if (data.targets_manual) header.push(C.manualMark);
  return [...header, ...buildMacrosLines(data), '', C.slotsHeader, ...slotLines].join('\n');
}

/**
 * Renders daily macro lines (with a leading blank line) or nothing when
 * macros are absent.
 * @param {object} data - object with target_protein/target_fat/target_carbs
 * @returns {string[]}
 */
function buildMacrosLines(data) {
  if (data.target_protein === null || data.target_protein === undefined) return [];
  const M = texts.profile.calories.macros;
  const g = texts.profile.units.grams;
  return [
    '',
    texts.profile.calories.macrosHeader,
    `• ${M.protein}: ${data.target_protein} ${g}`,
    `• ${M.fat}: ${data.target_fat} ${g}`,
    `• ${M.carbs}: ${data.target_carbs} ${g}`
  ];
}

/**
 * Builds the profile screen: summary (if filled) or empty-state hint,
 * plus start/edit, (for a filled profile) macro targets and product
 * preference buttons.
 * @param {object|null} profile
 * @returns {{text: string, extra: object}}
 */
function buildProfileMenu(profile) {
  const P = texts.ingredientPrefs.listBtn;
  const prefsRows = [
    [Markup.button.callback(P.excluded, 'prefs_list_excluded')],
    [Markup.button.callback(P.favorite, 'prefs_list_favorite')]
  ];
  if (!profile) {
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(texts.profile.startBtn, 'profile_start')],
      ...prefsRows
    ]);
    return { text: `${texts.profile.menuTitle}\n\n${texts.profile.emptyHint}`, extra: keyboard };
  }
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(texts.profile.targetsBtn, 'macro_targets')],
    [Markup.button.callback(texts.profile.editBtn, 'profile_start')],
    ...prefsRows
  ]);
  return {
    text: `${texts.profile.menuTitle}\n\n${buildProfileSummary(profile)}`,
    extra: { parse_mode: 'HTML', ...keyboard }
  };
}

/**
 * Sends the profile screen as a new message.
 * @param {object} ctx
 * @param {object|null} profile
 */
async function sendProfileMenu(ctx, profile) {
  const { text, extra } = buildProfileMenu(profile);
  return ctx.reply(text, extra);
}

module.exports = {
  buildProfileSummary,
  buildCaloriesBlock,
  buildProfileMenu,
  sendProfileMenu
};
