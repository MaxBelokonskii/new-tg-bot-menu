const { getUserProfile } = require('../../features/profile/logic');
const { getUtcOffset } = require('../../features/time-zone/logic');
const { getHouseholdSize } = require('../../features/household/logic');
const { buildProfileMenu } = require('../../interface/profile');

/**
 * Loads the profile, the time zone and the household size and builds the "⚙️ Settings" screen.
 * Shared by every "back to settings" button.
 * @param {number} telegramId
 * @returns {Promise<{text: string, extra: object}>}
 */
async function buildSettingsScreen(telegramId) {
  return buildProfileMenu(
    await getUserProfile(telegramId),
    await getUtcOffset(telegramId),
    await getHouseholdSize(telegramId)
  );
}

module.exports = { buildSettingsScreen };
