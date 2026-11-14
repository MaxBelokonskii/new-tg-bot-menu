const { getUserProfile } = require('../../features/profile/logic');
const { getUtcOffset } = require('../../features/time-zone/logic');
const { buildProfileMenu } = require('../../interface/profile');

/**
 * Loads the profile and the time zone and builds the "⚙️ Settings" screen.
 * Shared by every "back to settings" button.
 * @param {number} telegramId
 * @returns {Promise<{text: string, extra: object}>}
 */
async function buildSettingsScreen(telegramId) {
  return buildProfileMenu(await getUserProfile(telegramId), await getUtcOffset(telegramId));
}

module.exports = { buildSettingsScreen };
