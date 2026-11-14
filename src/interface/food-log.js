const { Markup } = require('telegraf');
const texts = require('../bot/texts');
const { NUTRIENTS, calculateRemaining } = require('../utils/nutrition-totals');
const { addDays } = require('../utils/date-helpers');

const T = texts.foodLog;
const BAR_WIDTH = 10;
const BUTTON_NAME_MAX = 28;

/**
 * Formats YYYY-MM-DD as DD.MM.
 * @param {string} date
 * @returns {string}
 */
function formatShortDate(date) {
  const [, m, d] = date.split('-');
  return `${d}.${m}`;
}

/**
 * Human label of a diary day: "сегодня, 14.11", "вчера, 13.11" or "12.11".
 * @param {string} date - YYYY-MM-DD
 * @param {string} today - YYYY-MM-DD
 * @returns {string}
 */
function formatDayLabel(date, today) {
  const short = formatShortDate(date);
  if (date === today) return T.dayToday.replace('{date}', short);
  if (date === addDays(today, -1)) return T.dayYesterday.replace('{date}', short);
  return short;
}

/**
 * Formats a portion as ½ / 1 / 1½ / 2 (falls back to a plain number).
 * @param {number} portion
 * @returns {string}
 */
function formatPortion(portion) {
  return T.portions[Math.round(portion * 2)] || String(portion);
}

/**
 * Builds an emoji progress bar: 🟩 eaten share, ⬜ the rest, all 🟥 when the
 * target is exceeded, plus the percentage when the target is positive.
 * @param {number} eaten
 * @param {number} target
 * @param {number} [width=BAR_WIDTH]
 * @returns {string}
 */
function buildProgressBar(eaten, target, width = BAR_WIDTH) {
  if (!(target > 0)) return eaten > 0 ? '🟥'.repeat(width) : '⬜'.repeat(width);
  const ratio = eaten / target;
  if (ratio > 1) return `${'🟥'.repeat(width)} ${Math.round(ratio * 100)}%`;
  const filled = Math.min(width, Math.round(ratio * width));
  return `${'🟩'.repeat(filled)}${'⬜'.repeat(width - filled)} ${Math.round(ratio * 100)}%`;
}

/**
 * Fills a "{kcal} ккал · Б {protein} …" template with rounded values.
 * @param {string} template
 * @param {{calories: number, protein: number, fat: number, carbs: number}} n
 * @returns {string}
 */
function fillNutrition(template, n) {
  return template
    .replace('{kcal}', Math.round(n.calories))
    .replace('{protein}', Math.round(n.protein))
    .replace('{fat}', Math.round(n.fat))
    .replace('{carbs}', Math.round(n.carbs));
}

function formatEntry(entry, index) {
  const portion = entry.portion === 1 ? '' : T.portionSuffix.replace('{portion}', formatPortion(entry.portion));
  return fillNutrition(
    T.entry.replace('{n}', index + 1).replace('{name}', entry.name).replace('{portion}', portion),
    entry
  );
}

function formatTotals(totals, targets) {
  if (!targets) return [fillNutrition(T.eatenOnly, totals), '', T.noProfileHint];
  const remaining = calculateRemaining(totals, targets);
  const lines = [];
  for (const key of NUTRIENTS) {
    const rest = remaining[key] >= 0
      ? T.left.replace('{value}', Math.round(remaining[key]))
      : T.over.replace('{value}', Math.round(-remaining[key]));
    lines.push(
      T.nutrientLine
        .replace('{label}', T.nutrients[key])
        .replace('{eaten}', Math.round(totals[key]))
        .replace('{target}', targets[key])
        .replace('{unit}', T.units[key])
        .replace('{rest}', rest),
      buildProgressBar(totals[key], targets[key])
    );
  }
  return lines;
}

const truncate = (name) => (name.length > BUTTON_NAME_MAX ? `${name.slice(0, BUTTON_NAME_MAX - 1)}…` : name);

function buildNavRow(date, today, oldest) {
  const row = [];
  if (date > oldest) {
    const prev = addDays(date, -1);
    const label = date === today ? T.buttons.prevYesterday : T.buttons.prevDate.replace('{date}', formatShortDate(prev));
    row.push(Markup.button.callback(label, `fl_day_${prev}`));
  }
  if (date < today) {
    const next = addDays(date, 1);
    const label = next === today ? T.buttons.nextToday : T.buttons.nextDate.replace('{date}', formatShortDate(next));
    row.push(Markup.button.callback(label, `fl_day_${next}`));
  }
  return row;
}

/**
 * Builds the diary day screen: eaten dishes with kcal/P/F/C, totals vs
 * targets with progress bars (or a fill-the-profile hint), add buttons, one
 * "✏️" button per entry (opens the entry editor) and day navigation.
 *
 * @param {{date: string, today: string, oldest: string,
 *   entries: Array<{id: number, name: string, portion: number, calories: number,
 *     protein: number, fat: number, carbs: number}>,
 *   totals: {calories: number, protein: number, fat: number, carbs: number},
 *   targets: {calories: number, protein: number, fat: number, carbs: number}|null}} view
 *   oldest — the earliest date the diary lets the user navigate to
 * @returns {{text: string, extra: object}}
 */
function buildDayScreen({ date, today, oldest, entries, totals, targets }) {
  const lines = [T.title.replace('{day}', formatDayLabel(date, today)), ''];
  if (entries.length === 0) lines.push(T.empty);
  else lines.push(...entries.map(formatEntry));
  lines.push('', T.totalsHeader, ...formatTotals(totals, targets));

  const rows = [
    [Markup.button.callback(date === today ? T.buttons.fromPlanToday : T.buttons.fromPlanDay, `fl_plan_${date}`)],
    [
      Markup.button.callback(T.buttons.search, `fl_search_${date}`),
      Markup.button.callback(T.buttons.fromFavorites, `fl_fav_${date}_0`)
    ]
  ];
  entries.forEach((entry, i) => rows.push([Markup.button.callback(
    T.buttons.entry.replace('{n}', i + 1).replace('{name}', truncate(entry.name)),
    `fl_entry_${entry.id}`
  )]));
  // [RU] Подбор «что ещё съесть» — только для сегодня и при заданных нормах.
  // [EN] "What else to eat" — only for today and when targets are set.
  if (date === today && targets) {
    rows.push([Markup.button.callback(texts.whatToEat.openBtn, 'wte_show_0')]);
  }
  const nav = buildNavRow(date, today, oldest);
  if (nav.length) rows.push(nav);

  return { text: lines.join('\n'), extra: { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) } };
}

module.exports = {
  formatShortDate,
  formatDayLabel,
  formatPortion,
  fillNutrition,
  truncate,
  buildProgressBar,
  buildDayScreen
};
