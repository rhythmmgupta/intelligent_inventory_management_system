const config = require('../config/env');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Returns UTC midnight Date representing the store's current calendar date.
 */
function getStoreToday(referenceDate = new Date()) {
  const shifted = new Date(referenceDate.getTime() + config.storeTimezoneOffsetMinutes * 60 * 1000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

/**
 * Normalizes any Date or ISO date string to UTC midnight Date (YYYY-MM-DDT00:00:00.000Z).
 */
function toDateOnlyUTC(input) {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date value: ${input}`);
  }
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Computes integer day difference: (targetDate - baseDate) in calendar days.
 */
function diffCalendarDays(targetDate, baseDate) {
  const a = toDateOnlyUTC(targetDate).getTime();
  const b = toDateOnlyUTC(baseDate).getTime();
  return Math.round((a - b) / MS_PER_DAY);
}

function addDaysUTC(baseDate, days) {
  const normalized = toDateOnlyUTC(baseDate);
  return new Date(normalized.getTime() + days * MS_PER_DAY);
}

function formatISODate(dateInput) {
  return toDateOnlyUTC(dateInput).toISOString().slice(0, 10);
}

module.exports = {
  MS_PER_DAY,
  getStoreToday,
  toDateOnlyUTC,
  diffCalendarDays,
  addDaysUTC,
  formatISODate,
};
