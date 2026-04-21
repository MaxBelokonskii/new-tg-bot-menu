/**
 * Formats a Date into a local YYYY-MM-DD string.
 * Avoids toISOString() UTC drift that shifts the day near midnight in non-UTC zones.
 *
 * @param {Date} d
 * @returns {string}
 */
function formatLocalDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Returns ISO-week bounds (Mon..Sun) containing the given date as half-open
 * local-date strings: { start: Monday, endExclusive: next Monday }.
 *
 * Use with SQL `WHERE date >= start AND date < endExclusive`.
 *
 * @param {Date} [now=new Date()]
 * @returns {{ start: string, endExclusive: string }}
 */
function getCurrentWeekBounds(now = new Date()) {
  // [RU] getDay(): 0=вс..6=сб. Смещение до понедельника — (getDay()+6)%7.
  // [EN] getDay(): 0=Sun..6=Sat. Offset back to Monday is (getDay()+6)%7.
  const offsetToMonday = (now.getDay() + 6) % 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offsetToMonday);
  const nextMonday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
  return {
    start: formatLocalDate(monday),
    endExclusive: formatLocalDate(nextMonday)
  };
}

/**
 * Returns half-open local-date bounds for the day containing `now`:
 * { start: today, endExclusive: tomorrow }. Same shape as getCurrentWeekBounds.
 *
 * @param {Date} [now=new Date()]
 * @returns {{ start: string, endExclusive: string }}
 */
function getCurrentDayBounds(now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return {
    start: formatLocalDate(today),
    endExclusive: formatLocalDate(tomorrow)
  };
}

module.exports = {
  formatLocalDate,
  getCurrentWeekBounds,
  getCurrentDayBounds
};
