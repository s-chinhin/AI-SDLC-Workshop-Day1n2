'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Holiday, Todo } from '@/lib/db';
import type { Priority } from '@/lib/constants';
import {
  MAX_VISIBLE_TODOS,
  currentYearMonth,
  formatMonthParam,
  generateCalendarGrid,
  monthTitle,
  parseMonthParam,
  shiftMonth,
  type CalendarDay,
  type YearMonth,
} from '@/lib/calendar';
import { formatSingaporeDate, getSingaporeNow, toSingaporeDateKey } from '@/lib/timezone';
import { PRIORITY_LABELS, sortTodos } from '@/lib/todoLogic';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Same palette as the list view's priority badges (PRP 02).
const PILL: Record<Priority, string> = {
  high: 'bg-red-50 text-red-800 ring-red-200 dark:bg-red-950 dark:text-red-200 dark:ring-red-800',
  medium: 'bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800',
  low: 'bg-blue-50 text-blue-800 ring-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:ring-blue-800',
};
const DOT: Record<Priority, string> = {
  high: 'bg-[#EF4444] dark:bg-[#F87171]',
  medium: 'bg-[#F59E0B] dark:bg-[#FBBF24]',
  low: 'bg-[#3B82F6] dark:bg-[#60A5FA]',
};

function DayTodosModal({
  day,
  todos,
  holiday,
  onClose,
}: {
  day: CalendarDay;
  todos: Todo[];
  holiday: Holiday | undefined;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const heading = new Intl.DateTimeFormat('en-SG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${day.date}T00:00:00Z`)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label={`Todos on ${day.date}`} className="w-full max-w-md space-y-4 rounded-xl bg-white p-6 shadow-xl dark:bg-gray-900">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{heading}</h2>
          <button onClick={onClose} aria-label="Close" className="px-2 text-gray-500 hover:text-gray-800 dark:hover:text-white">
            ✕
          </button>
        </div>
        {holiday && (
          <p className="rounded-lg bg-purple-50 px-3 py-2 text-sm font-medium text-purple-800 dark:bg-purple-950 dark:text-purple-200" data-testid="modal-holiday">
            🎉 {holiday.name}
          </p>
        )}
        {todos.length === 0 ? (
          <p className="text-sm text-gray-500">No todos due this day.</p>
        ) : (
          <ul className="space-y-2" data-testid="modal-todos">
            {todos.map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-sm">
                <span aria-hidden>{t.completed ? '✅' : '⬜'}</span>
                <span className={`flex-1 ${t.completed ? 'text-gray-400 line-through' : 'text-gray-800 dark:text-gray-100'}`}>{t.title}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${PILL[t.priority]}`}>{PRIORITY_LABELS[t.priority]}</span>
                {t.due_date && <span className="text-xs text-gray-500">{formatSingaporeDate(t.due_date, { weekday: undefined, day: undefined, month: undefined, year: undefined })}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CalendarView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = parseMonthParam(searchParams.get('month'));
  const [todos, setTodos] = useState<Todo[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CalendarDay | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/todos')
      .then(async (res) => {
        if (res.status === 401) return router.replace('/login');
        if (!res.ok) throw new Error('Could not load todos');
        const list: Todo[] = await res.json();
        if (!cancelled) setTodos(list);
      })
      .catch((err) => !cancelled && setError((err as Error).message));
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/holidays?year=${current.year}&month=${current.month}`)
      .then((res) => (res.ok ? res.json() : { holidays: [] }))
      .then((data) => !cancelled && setHolidays(data.holidays))
      .catch(() => !cancelled && setHolidays([]));
    return () => {
      cancelled = true;
    };
  }, [current.year, current.month]);

  const grid = useMemo(() => generateCalendarGrid(current.year, current.month, getSingaporeNow()), [current.year, current.month]);

  // Bucket dated todos by their Singapore calendar day.
  const todosByDay = useMemo(() => {
    const map = new Map<string, Todo[]>();
    for (const t of todos) {
      if (!t.due_date) continue;
      const key = toSingaporeDateKey(new Date(t.due_date));
      map.set(key, [...(map.get(key) ?? []), t]);
    }
    for (const [key, list] of map) map.set(key, sortTodos(list));
    return map;
  }, [todos]);
  const holidayByDay = useMemo(() => new Map(holidays.map((h) => [h.date, h])), [holidays]);

  const go = (ym: YearMonth) => router.replace(`/calendar?month=${formatMonthParam(ym)}`);
  const closeModal = useCallback(() => setSelected(null), []);

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white" data-testid="month-title">
            {monthTitle(current)}
          </h1>
          <p className="text-sm text-gray-500">Singapore time (SGT)</p>
        </div>
        <nav className="flex items-center gap-2 text-sm">
          <button onClick={() => go(shiftMonth(current, -1))} aria-label="Previous month" className="rounded-lg border border-gray-300 px-3 py-1.5 dark:border-gray-700 dark:text-gray-200">
            ◀
          </button>
          <button onClick={() => go(currentYearMonth())} className="rounded-lg border border-gray-300 px-3 py-1.5 font-medium dark:border-gray-700 dark:text-gray-200">
            Today
          </button>
          <button onClick={() => go(shiftMonth(current, 1))} aria-label="Next month" className="rounded-lg border border-gray-300 px-3 py-1.5 dark:border-gray-700 dark:text-gray-200">
            ▶
          </button>
          <Link href="/" className="rounded-lg bg-gray-800 px-3 py-1.5 font-medium text-white dark:bg-gray-200 dark:text-gray-900">
            List
          </Link>
        </nav>
      </header>

      {error && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700" role="alert">{error}</p>}

      <div className="overflow-x-auto">
        <div className="grid min-w-[640px] grid-cols-7 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700" data-testid="calendar-grid">
          {WEEKDAYS.map((d, i) => (
            <div
              key={d}
              role="columnheader"
              className={`border-b border-gray-200 py-2 text-center text-xs font-semibold uppercase dark:border-gray-700 ${
                i === 0 || i === 6 ? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' : 'bg-gray-50 text-gray-700 dark:bg-gray-900 dark:text-gray-300'
              }`}
            >
              {d}
            </div>
          ))}
          {grid.map((day) => {
            const dayTodos = todosByDay.get(day.date) ?? [];
            const holiday = holidayByDay.get(day.date);
            const extra = dayTodos.length - MAX_VISIBLE_TODOS;
            return (
              <button
                key={day.date}
                type="button"
                onClick={() => setSelected(day)}
                data-testid="calendar-day"
                data-date={day.date}
                data-current-month={day.isCurrentMonth}
                data-today={day.isToday}
                data-weekend={day.isWeekend}
                aria-label={`${day.date}${holiday ? `, ${holiday.name}` : ''}, ${dayTodos.length} todos`}
                className={`flex min-h-24 flex-col gap-1 border-b border-r border-gray-100 p-1.5 text-left align-top transition-colors hover:bg-blue-50 dark:border-gray-800 dark:hover:bg-gray-800 ${
                  day.isWeekend ? 'bg-gray-50 dark:bg-gray-900' : 'bg-white dark:bg-gray-950'
                } ${day.isCurrentMonth ? '' : 'opacity-40'}`}
              >
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                    day.isToday ? 'bg-blue-600 text-white' : day.isCurrentMonth && day.isPast ? 'text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-300'
                  }`}
                >
                  {day.day}
                </span>
                {holiday && (
                  <span className="truncate rounded bg-purple-100 px-1 text-[11px] font-medium text-purple-800 dark:bg-purple-950 dark:text-purple-200" data-testid="holiday-label">
                    {holiday.name}
                  </span>
                )}
                {dayTodos.slice(0, MAX_VISIBLE_TODOS).map((t) => (
                  <span
                    key={t.id}
                    data-testid="calendar-todo"
                    data-priority={t.priority}
                    className={`flex items-center gap-1 truncate rounded px-1 text-[11px] ring-1 ${PILL[t.priority]} ${t.completed ? 'line-through opacity-60' : ''}`}
                  >
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[t.priority]}`} aria-hidden />
                    <span className="truncate">{t.title}</span>
                  </span>
                ))}
                {extra > 0 && (
                  <span className="text-[11px] font-medium text-gray-500" data-testid="more-count">
                    +{extra} more
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {selected && (
        <DayTodosModal day={selected} todos={todosByDay.get(selected.date) ?? []} holiday={holidayByDay.get(selected.date)} onClose={closeModal} />
      )}
    </main>
  );
}

export default function CalendarPage() {
  // useSearchParams needs a Suspense boundary.
  return (
    <Suspense fallback={<p className="px-4 py-10 text-gray-500">Loading calendar…</p>}>
      <CalendarView />
    </Suspense>
  );
}
