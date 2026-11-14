const { DEFAULT_OFFSET_MINUTES, buildClock } = require('../../src/features/time-zone/clock');

/**
 * The clock a new user (default zone, Moscow) sees right now — what the
 * handlers compute via getUserClock for users without a chosen zone.
 * @param {Date} [now=new Date()]
 * @returns {ReturnType<typeof buildClock>}
 */
const defaultClock = (now = new Date()) => buildClock(DEFAULT_OFFSET_MINUTES, now);

module.exports = { defaultClock };
