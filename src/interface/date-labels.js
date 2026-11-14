const texts = require('../bot/texts');
const { addDays } = require('../utils/date-helpers');

const T = texts.dates;

/**
 * Day and short month: "14 нояб.".
 * @param {string} date - YYYY-MM-DD
 * @returns {string}
 */
function formatDayMonthName(date) {
  const [, m, d] = date.split('-').map(Number);
  return T.dayMonth.replace('{day}', d).replace('{month}', T.monthsShort[m - 1]);
}

/**
 * Inclusive date range: "17–23 нояб." within a month, "29 дек. – 4 янв."
 * across months.
 * @param {string} first - YYYY-MM-DD
 * @param {string} last - YYYY-MM-DD
 * @returns {string}
 */
function formatDateRange(first, last) {
  const [, m1, d1] = first.split('-').map(Number);
  const [, m2, d2] = last.split('-').map(Number);
  if (m1 === m2) {
    return T.rangeSameMonth.replace('{from}', d1).replace('{to}', d2).replace('{month}', T.monthsShort[m1 - 1]);
  }
  return T.rangeTwoMonths
    .replace('{from}', formatDayMonthName(first))
    .replace('{to}', formatDayMonthName(last));
}

/**
 * Range of an ISO week by its Monday: "17–23 нояб.".
 * @param {string} monday - YYYY-MM-DD
 * @returns {string}
 */
function formatWeekRange(monday) {
  return formatDateRange(monday, addDays(monday, 6));
}

module.exports = { formatDayMonthName, formatDateRange, formatWeekRange };
