// Seeds Singapore public holidays. Idempotent: re-running updates names, never duplicates.
// Usage: npx tsx scripts/seed-holidays.ts   (honours DATABASE_PATH, default ./todos.db)
//
// Source: Ministry of Manpower gazetted public holidays (https://www.mom.gov.sg/employment-practices/public-holidays).
// When a holiday falls on a Sunday, the following Monday is a holiday ("observed").
// Verify against the MOM list and add new years here when they are announced.
import { holidayDB } from '../lib/db';

const HOLIDAYS: [date: string, name: string][] = [
  // 2025
  ['2025-01-01', "New Year's Day"],
  ['2025-01-29', 'Chinese New Year'],
  ['2025-01-30', 'Chinese New Year (Day 2)'],
  ['2025-03-31', 'Hari Raya Puasa'],
  ['2025-04-18', 'Good Friday'],
  ['2025-05-01', 'Labour Day'],
  ['2025-05-03', 'Polling Day'],
  ['2025-05-12', 'Vesak Day'],
  ['2025-06-07', 'Hari Raya Haji'],
  ['2025-08-09', 'National Day'],
  ['2025-10-20', 'Deepavali'],
  ['2025-12-25', 'Christmas Day'],
  // 2026
  ['2026-01-01', "New Year's Day"],
  ['2026-02-17', 'Chinese New Year'],
  ['2026-02-18', 'Chinese New Year (Day 2)'],
  ['2026-03-21', 'Hari Raya Puasa'],
  ['2026-04-03', 'Good Friday'],
  ['2026-05-01', 'Labour Day'],
  ['2026-05-27', 'Hari Raya Haji'],
  ['2026-05-31', 'Vesak Day'],
  ['2026-06-01', 'Vesak Day (observed)'],
  ['2026-08-09', 'National Day'],
  ['2026-08-10', 'National Day (observed)'],
  ['2026-11-08', 'Deepavali'],
  ['2026-11-09', 'Deepavali (observed)'],
  ['2026-12-25', 'Christmas Day'],
];

for (const [date, name] of HOLIDAYS) holidayDB.upsert(date, name);
console.log(`Seeded ${HOLIDAYS.length} Singapore public holidays.`);
