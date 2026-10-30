// Client-side search & filtering over the already-loaded Todo[] (no server endpoints).
import type { Tag, Todo } from './db';
import type { Priority } from './constants';
import { toSingaporeDateKey } from './timezone';

export type CompletionFilter = 'all' | 'incomplete' | 'completed';

export interface FilterState {
  search: string;
  priority: Priority | 'all';
  tagId: number | 'all';
  completion: CompletionFilter;
  dueDateFrom: string | null; // 'YYYY-MM-DD' (Singapore calendar day)
  dueDateTo: string | null;
}

export const DEFAULT_FILTER_STATE: FilterState = {
  search: '',
  priority: 'all',
  tagId: 'all',
  completion: 'all',
  dueDateFrom: null,
  dueDateTo: null,
};

export const SEARCH_DEBOUNCE_MS = 300;

export function hasActiveFilters(f: FilterState): boolean {
  return (
    f.search.trim() !== '' ||
    f.priority !== 'all' ||
    f.tagId !== 'all' ||
    f.completion !== 'all' ||
    f.dueDateFrom !== null ||
    f.dueDateTo !== null
  );
}

/** AND of all active filters, applied in order: search → priority → tag → completion → date range. */
export function applyFilters<T extends Todo>(todos: T[], filters: FilterState): T[] {
  let result = todos;

  const query = filters.search.trim().toLowerCase();
  if (query) {
    result = result.filter(
      (todo) =>
        todo.title.toLowerCase().includes(query) ||
        (todo.subtasks ?? []).some((st) => st.title.toLowerCase().includes(query))
    );
  }

  if (filters.priority !== 'all') {
    result = result.filter((todo) => todo.priority === filters.priority);
  }

  if (filters.tagId !== 'all') {
    result = result.filter((todo) => (todo.tags ?? []).some((tag) => tag.id === filters.tagId));
  }

  if (filters.completion === 'incomplete') {
    result = result.filter((todo) => !todo.completed);
  } else if (filters.completion === 'completed') {
    result = result.filter((todo) => todo.completed);
  }

  // Date range only matches todos that have a due date; bounds are inclusive and optional.
  if (filters.dueDateFrom || filters.dueDateTo) {
    result = result.filter((todo) => {
      if (!todo.due_date) return false;
      const day = toSingaporeDateKey(new Date(todo.due_date));
      if (filters.dueDateFrom && day < filters.dueDateFrom) return false;
      if (filters.dueDateTo && day > filters.dueDateTo) return false;
      return true;
    });
  }

  return result;
}

/** Human-readable summary, e.g. `Search: "meeting" · Priority: High · Tag: Work`. */
export function describeFilters(f: FilterState, tags: Tag[]): string {
  const parts: string[] = [];
  if (f.search.trim()) parts.push(`Search: "${f.search.trim()}"`);
  if (f.priority !== 'all') parts.push(`Priority: ${f.priority[0].toUpperCase()}${f.priority.slice(1)}`);
  if (f.tagId !== 'all') parts.push(`Tag: ${tags.find((t) => t.id === f.tagId)?.name ?? 'deleted tag'}`);
  if (f.completion !== 'all') parts.push(`Completion: ${f.completion === 'completed' ? 'Completed' : 'Incomplete'}`);
  if (f.dueDateFrom && f.dueDateTo) parts.push(`Date: ${f.dueDateFrom} to ${f.dueDateTo}`);
  else if (f.dueDateFrom) parts.push(`Date: from ${f.dueDateFrom}`);
  else if (f.dueDateTo) parts.push(`Date: until ${f.dueDateTo}`);
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Saved presets (per browser, in localStorage)
// ---------------------------------------------------------------------------

export const PRESETS_STORAGE_KEY = 'todo-app:filter-presets';

export interface FilterPreset {
  id: string;
  name: string;
  filters: FilterState;
  createdAt: string;
}

/** Storage can be unavailable (private mode, blocked site data); treat that as "no presets". */
export function loadPresets(): FilterPreset[] {
  try {
    const raw = window.localStorage.getItem(PRESETS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed
          .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string' && p.filters)
          .map((p) => ({ ...p, filters: { ...DEFAULT_FILTER_STATE, ...p.filters } }))
      : [];
  } catch {
    return [];
  }
}

export function savePresets(presets: FilterPreset[]): void {
  try {
    window.localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Not persisted; the in-memory list still works for this session.
  }
}
