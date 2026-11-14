/**
 * Edits the callback message, ignoring Telegram's "message is not modified"
 * error (re-rendering identical content is a no-op, not a failure).
 * @param {import('telegraf').Context} ctx
 * @param {string} text
 * @param {object} [extra] - editMessageText options (parse_mode, reply_markup)
 * @returns {Promise<void>}
 */
async function safeEdit(ctx, text, extra) {
  try {
    await ctx.editMessageText(text, extra);
  } catch (err) {
    if (err.description && err.description.includes('message is not modified')) return;
    throw err;
  }
}

module.exports = { safeEdit };
