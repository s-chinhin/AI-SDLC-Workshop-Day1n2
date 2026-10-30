import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { holidayDB } from '@/lib/db';
import { generateCalendarGrid } from '@/lib/calendar';

// Holidays aren't user-scoped, but the route still requires a session like the rest of the API.
// With ?year=&month= it returns holidays for that month's whole 6-week grid (including the
// leading/trailing days from adjacent months); otherwise all holidays.
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const year = Number(params.get('year'));
  const month = Number(params.get('month'));
  if (!params.has('year') && !params.has('month')) {
    return NextResponse.json({ holidays: holidayDB.findAll() });
  }
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12 || year < 1) {
    return NextResponse.json({ error: 'year and month must be valid (month 1-12)' }, { status: 400 });
  }

  const grid = generateCalendarGrid(year, month);
  return NextResponse.json({ holidays: holidayDB.findBetween(grid[0].date, grid[grid.length - 1].date) });
}
