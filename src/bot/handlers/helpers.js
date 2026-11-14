/**
 * Edits the callback message, ignoring Telegram's "message is not modified"
 * error (re-rendering identical content is a no-op, not a failure).
 * @param {import('telegraf').Context} ctx
 * @param {string} text
 * @param {object} [extra] - editMessageText options (parse_mode, reply_markup)
 * @returns {Promise<void>}
 */
async function safeEdit(ctx, text, extra) {
  await ignoreNotModified(() => ctx.editMessageText(text, extra));
}

/**
 * Replaces only the inline keyboard of the callback message, ignoring the
 * "message is not modified" error.
 * @param {import('telegraf').Context} ctx
 * @param {{inline_keyboard: Array<Array<object>>}} markup
 * @returns {Promise<void>}
 */
async function safeEditMarkup(ctx, markup) {
  await ignoreNotModified(() => ctx.editMessageReplyMarkup(markup));
}

async function ignoreNotModified(edit) {
  try {
    await edit();
  } catch (err) {
    if (err.description && err.description.includes('message is not modified')) return;
    throw err;
  }
}

module.exports = { safeEdit, safeEditMarkup };
