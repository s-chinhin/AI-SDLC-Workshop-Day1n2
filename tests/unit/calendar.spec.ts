import { test, expect } from '@playwright/test';
import { generateCalendarGrid, parseMonthParam, shiftMonth } from '../../lib/calendar';

test.describe('generateCalendarGrid', () => {
  const now = new Date('2028-02-15T12:00:00+08:00');

  test('always 42 cells starting on a Sunday', () => {
    for (const [y, m] of [
      [2026, 2], // Feb 2026 starts Sunday and fits in 4 rows
      [2026, 8], // needs 6 rows
      [2028, 2],
    ]) {
      const grid = generateCalendarGrid(y, m, now);
      expect(grid).toHaveLength(42);
      expect(new Date(`${grid[0].date}T00:00:00Z`).getUTCDay()).toBe(0);
    }
  });

  test('leap February has 29 current-month days; flags are correct', () => {
    const grid = generateCalendarGrid(2028, 2, now);
    const inMonth = grid.filter((d) => d.isCurrentMonth);
    expect(inMonth).toHaveLength(29);
    expect(inMonth.at(-1)!.date).toBe('2028-02-29');
    expect(grid.filter((d) => d.isToday).map((d) => d.date)).toEqual(['2028-02-15']);
    expect(grid.find((d) => d.date === '2028-02-14')!.isPast).toBe(true);
    expect(grid.find((d) => d.date === '2028-02-16')!.isPast).toBe(false);
    expect(grid.find((d) => d.date === '2028-02-19')!.isWeekend).toBe(true); // Saturday
  });

  test('"today" follows Singapore, not UTC', () => {
    // 2028-02-15 17:00 UTC is already Feb 16 in Singapore.
    const grid = generateCalendarGrid(2028, 2, new Date('2028-02-15T17:00:00Z'));
    expect(grid.find((d) => d.isToday)!.date).toBe('2028-02-16');
  });
});

test.describe('month helpers', () => {
  const now = new Date('2026-10-30T12:00:00+08:00');
  test('parseMonthParam falls back on bad input', () => {
    expect(parseMonthParam('2027-03', now)).toEqual({ year: 2027, month: 3 });
    for (const bad of ['abc', '2026-13', '2026-00', '', null]) expect(parseMonthParam(bad, now)).toEqual({ year: 2026, month: 10 });
  });
  test('shiftMonth crosses year boundaries', () => {
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth({ year: 2026, month: 5 }, -17)).toEqual({ year: 2024, month: 12 });
  });
});
