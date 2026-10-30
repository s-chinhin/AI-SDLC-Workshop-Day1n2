// Month grid for the calendar view. Pure (no DOM/DB); all dates are Singapore calendar days.
import { getSingaporeNow, getSingaporeParts, toSingaporeDateKey } from './timezone';

export interface CalendarDay {
  date: string; // YYYY-MM-DD, Singapore-local
  day: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  isWeekend: boolean;
}

export const MAX_VISIBLE_TODOS = 3;
export const GRID_CELLS = 42; // always 6 rows so the grid height never jumps

const pad = (n: number) => String(n).padStart(2, '0');

/** `month` is 1-12. Emits 42 cells starting on the Sunday on/before the 1st. */
export function generateCalendarGrid(year: number, month: number, now: Date = getSingaporeNow()): CalendarDay[] {
  const startWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0 = Sunday
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const today = toSingaporeDateKey(now);

  return Array.from({ length: GRID_CELLS }, (_, i) => {
    const offset = i - startWeekday + 1;
    // Pure calendar arithmetic in UTC; no wall-clock instant is involved.
    const d = new Date(Date.UTC(year, month - 1, offset));
    const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const weekday = d.getUTCDay();
    return {
      date,
      day: d.getUTCDate(),
      isCurrentMonth: offset >= 1 && offset <= daysInMonth,
      isToday: date === today,
      isPast: date < today,
      isWeekend: weekday === 0 || weekday === 6,
    };
  });
}

export interface YearMonth {
  year: number;
  month: number; // 1-12
}

export function currentYearMonth(now: Date = getSingaporeNow()): YearMonth {
  const p = getSingaporeParts(now);
  return { year: p.year, month: p.month };
}

/** Parses `?month=YYYY-MM`; anything malformed or out of range falls back to the current Singapore month. */
export function parseMonthParam(value: string | null | undefined, now: Date = getSingaporeNow()): YearMonth {
  const m = /^(\d{4})-(\d{2})$/.exec(value ?? '');
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (year >= 1 && month >= 1 && month <= 12) return { year, month };
  }
  return currentYearMonth(now);
}

export function shiftMonth({ year, month }: YearMonth, delta: number): YearMonth {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function formatMonthParam({ year, month }: YearMonth): string {
  return `${year}-${pad(month)}`;
}

export function monthTitle({ year, month }: YearMonth): string {
  return new Intl.DateTimeFormat('en-SG', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, 1))
  );
}
