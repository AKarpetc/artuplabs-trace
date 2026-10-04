import { describe, expect, it } from 'vitest';
import { DAY_MS, parseDate, startOfDayMs } from '../../src/core/dates.js';

const NOW = Date.UTC(2026, 9, 8, 15, 0);

describe('parseDate', () => {
  it.each([
    ['2026-09-01', Date.UTC(2026, 8, 1)],
    ['2026/09/01 10:30', Date.UTC(2026, 8, 1, 10, 30)],
    ['-7d', NOW - 7 * DAY_MS],
    ['-0d', NOW],
    ['+2h', NOW + 2 * 3600000],
    ['-30m', NOW - 30 * 60000],
    ['startOfDay()', Date.UTC(2026, 9, 8)],
    ['startOfWeek()', Date.UTC(2026, 9, 5)],
    ['startOfWeek(-1)', Date.UTC(2026, 8, 28)],
    ['startOfMonth()', Date.UTC(2026, 9, 1)],
    ['startOfMonth(-1)', Date.UTC(2026, 8, 1)],
    ['endOfMonth(-1)', Date.UTC(2026, 9, 1) - 1],
    ['endOfDay()', Date.UTC(2026, 9, 9) - 1],
    ['startOfDay("-1d")', Date.UTC(2026, 9, 7)],
    ['startOfYear()', Date.UTC(2026, 0, 1)],
  ])('%s', (text, ms) => {
    expect(parseDate(text, NOW)).toEqual({ ms });
  });
  it('rejects impossible and unknown dates', () => {
    expect(parseDate('2026-02-30', NOW)).toEqual({ error: 'Invalid date "2026-02-30"' });
    expect(parseDate('tomorrow', NOW)).toEqual({ error: 'Invalid date "tomorrow"' });
  });
  it('cuts to midnight UTC', () => {
    expect(startOfDayMs(Date.UTC(2026, 2, 29, 23, 59))).toBe(Date.UTC(2026, 2, 29));
  });
});

describe('parseDate edges', () => {
  it.each([
    ['7d', NOW + 7 * DAY_MS],
    ['+1w', NOW + 7 * DAY_MS],
    ['2026-09-01T08:05', Date.UTC(2026, 8, 1, 8, 5)],
    ['  2026-09-01  ', Date.UTC(2026, 8, 1)],
    ['STARTOFDAY()', Date.UTC(2026, 9, 8)],
    ['startOfDay( "+2h" )', Date.UTC(2026, 9, 8, 2)],
    ['endOfDay("-1d")', Date.UTC(2026, 9, 8) - 1],
    ['endOfWeek()', Date.UTC(2026, 9, 12) - 1],
    ['startOfWeek(+1)', Date.UTC(2026, 9, 12)],
    ['endOfYear()', Date.UTC(2027, 0, 1) - 1],
    ['startOfYear(-1)', Date.UTC(2025, 0, 1)],
    ['startOfMonth(-10)', Date.UTC(2025, 11, 1)],
    ['endOfMonth()', Date.UTC(2026, 10, 1) - 1],
  ])('%s', (text, ms) => {
    expect(parseDate(text, NOW)).toEqual({ ms });
  });
  it('starts the week on Monday when today is Sunday or Monday', () => {
    expect(parseDate('startOfWeek()', Date.UTC(2026, 9, 11, 23))).toEqual({ ms: Date.UTC(2026, 9, 5) });
    expect(parseDate('startOfWeek()', Date.UTC(2026, 9, 5, 0, 1))).toEqual({ ms: Date.UTC(2026, 9, 5) });
  });
  it('reads a year below 100 as written', () => {
    const year26 = new Date(0);
    year26.setUTCFullYear(26, 0, 1);
    expect(parseDate('0026-01-01', NOW)).toEqual({ ms: year26.getTime() });
  });
  it.each(['2026-09-01 24:00', '2026-09-01 10:60', '2026-13-01', '2026-00-10', '2026-9-1', '-7y', '', '-', 'startOfDecade()', 'startOfDay(-1y)'])(
    'rejects %j',
    (text) => {
      expect(parseDate(text, NOW).error).toBe(`Invalid date "${text.trim()}"`);
    },
  );
  it('rejects offsets beyond the calendar instead of returning a non-number', () => {
    expect(parseDate('-99999999999999999999d', NOW)).toEqual({ error: 'Invalid date "-99999999999999999999d"' });
    expect(parseDate('startOfMonth(999999999999)', NOW)).toEqual({ error: 'Invalid date "startOfMonth(999999999999)"' });
    expect(parseDate('+999999999w', NOW).error).toMatch(/^Invalid date/);
  });
  it('treats a missing value as an empty date', () => {
    expect(parseDate(undefined, NOW)).toEqual({ error: 'Invalid date ""' });
  });
  it('quotes only the start of a long value', () => {
    const { error } = parseDate('x'.repeat(5000), NOW);
    expect(error).toBe(`Invalid date "${'x'.repeat(30)}…"`);
  });
});
