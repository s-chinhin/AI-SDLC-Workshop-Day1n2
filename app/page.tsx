'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Subtask, Tag, Template, Todo } from '@/lib/db';
import {
  DEFAULT_TAG_COLOR,
  PRIORITIES,
  RECURRENCE_PATTERNS,
  REMINDER_LABELS,
  REMINDER_OPTIONS,
  type Priority,
  type RecurrencePattern,
} from '@/lib/constants';
import { reminderLabel, useNotifications } from '@/lib/hooks/useNotifications';
import {
  DEFAULT_FILTER_STATE,
  SEARCH_DEBOUNCE_MS,
  applyFilters,
  describeFilters,
  hasActiveFilters,
  loadPresets,
  savePresets,
  type CompletionFilter,
  type FilterPreset,
  type FilterState,
} from '@/lib/filters';
import { describePasskeyError, passkeyFlow } from '@/lib/passkeyClient';
import {
  HEX_COLOR,
  PRIORITY_LABELS,
  calculateProgress,
  sectionTodos,
  normalizeTitle,
  validateDueDate,
  type TemplateSubtask,
} from '@/lib/todoLogic';
import {
  datetimeLocalToISO,
  formatRelative,
  formatSingaporeDate,
  getSingaporeNow,
  isoToDatetimeLocal,
} from '@/lib/timezone';

const TITLE_SOFT_LIMIT = 200;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

// Dot uses the spec hex colors (red #EF4444/#F87171, yellow #F59E0B/#FBBF24, blue #3B82F6/#60A5FA);
// label text uses darker/lighter shades so it passes WCAG AA on the tinted background.
const PRIORITY_BADGE: Record<Priority, { badge: string; dot: string }> = {
  high: {
    badge: 'bg-red-50 text-red-800 ring-red-200 dark:bg-red-950 dark:text-red-200 dark:ring-red-800',
    dot: 'bg-[#EF4444] dark:bg-[#F87171]',
  },
  medium: {
    badge: 'bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800',
    dot: 'bg-[#F59E0B] dark:bg-[#FBBF24]',
  },
  low: {
    badge: 'bg-blue-50 text-blue-800 ring-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:ring-blue-800',
    dot: 'bg-[#3B82F6] dark:bg-[#60A5FA]',
  },
};

function PriorityBadge({ priority }: { priority: Priority }) {
  const style = PRIORITY_BADGE[priority];
  return (
    <span
      data-testid="priority-badge"
      data-priority={priority}
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${style.badge}`}
    >
      <span className={`h-2 w-2 rounded-full ${style.dot}`} aria-hidden />
      {PRIORITY_LABELS[priority]}
    </span>
  );
}

function RecurrenceBadge({ pattern }: { pattern: RecurrencePattern }) {
  return (
    <span
      data-testid="recurrence-badge"
      className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-800 ring-1 ring-purple-200 dark:bg-purple-950 dark:text-purple-200 dark:ring-purple-800"
    >
      <span aria-hidden>🔄</span>
      {pattern}
    </span>
  );
}

function ReminderBadge({ minutes }: { minutes: number }) {
  return (
    <span
      data-testid="reminder-badge"
      className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-900 ring-1 ring-orange-200 dark:bg-orange-950 dark:text-orange-200 dark:ring-orange-800"
    >
      <span aria-hidden>🔔</span>
      {reminderLabel(minutes)}
    </span>
  );
}

/** Reminder preset dropdown; disabled until there is a due date to count back from. */
function ReminderSelect({
  value,
  onChange,
  disabled,
  label,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <select
      value={disabled || value == null ? '' : String(value)}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      disabled={disabled}
      aria-label={label}
      title={disabled ? 'Set a due date to add a reminder' : undefined}
      className="rounded-lg border border-gray-300 px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
    >
      <option value="">No reminder</option>
      {REMINDER_OPTIONS.map((m) => (
        <option key={m} value={m}>
          🔔 {REMINDER_LABELS[m]} before
        </option>
      ))}
    </select>
  );
}

/** "Repeat" checkbox plus pattern dropdown, shared by the add form and edit modal. */
function RepeatControls({
  repeat,
  pattern,
  onRepeatChange,
  onPatternChange,
  idPrefix,
}: {
  repeat: boolean;
  pattern: RecurrencePattern;
  onRepeatChange: (v: boolean) => void;
  onPatternChange: (p: RecurrencePattern) => void;
  idPrefix: string;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <label className="flex items-center gap-1.5 text-gray-700 dark:text-gray-300">
        <input
          type="checkbox"
          checked={repeat}
          onChange={(e) => onRepeatChange(e.target.checked)}
          aria-label={`${idPrefix}Repeat`}
          className="h-4 w-4"
        />
        Repeat
      </label>
      {repeat && (
        <select
          value={pattern}
          onChange={(e) => onPatternChange(e.target.value as RecurrencePattern)}
          aria-label={`${idPrefix}Recurrence pattern`}
          className="rounded-lg border border-gray-300 px-2 py-1 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
        >
          {RECURRENCE_PATTERNS.map((p) => (
            <option key={p} value={p}>
              {p[0].toUpperCase() + p.slice(1)}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function PrioritySelect({
  value,
  onChange,
  label,
}: {
  value: Priority;
  onChange: (p: Priority) => void;
  label: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as Priority)}
      aria-label={label}
      className="rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
    >
      {PRIORITIES.map((p) => (
        <option key={p} value={p}>
          {PRIORITY_LABELS[p]}
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

function TagPill({
  tag,
  selected = false,
  onClick,
  label,
}: {
  tag: Tag;
  selected?: boolean;
  onClick?: (tag: Tag) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick?.(tag)}
      aria-pressed={selected}
      aria-label={label}
      data-testid="tag-pill"
      style={selected ? { backgroundColor: tag.color } : undefined}
      className={`inline-flex max-w-[12rem] items-center gap-1 rounded-full border px-3 py-0.5 text-xs font-medium transition-colors ${
        selected
          ? 'border-transparent text-white'
          : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200'
      }`}
    >
      {selected ? <span aria-hidden>✓</span> : <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} aria-hidden />}
      <span className="truncate">{tag.name}</span>
    </button>
  );
}

/** Tag chips shown on a todo card, in the tag's color with white text; click to filter. */
function TodoTagChip({ tag, onClick }: { tag: Tag; onClick: (tag: Tag) => void }) {
  return (
    <button
      type="button"
      onClick={() => onClick(tag)}
      title={`Filter by "${tag.name}"`}
      data-testid="todo-tag"
      style={{ backgroundColor: tag.color }}
      className="inline-flex max-w-[10rem] items-center rounded-full px-2 py-0.5 text-xs font-medium text-white"
    >
      <span className="truncate">{tag.name}</span>
    </button>
  );
}

function TagSelector({
  tags,
  selected,
  onChange,
}: {
  tags: Tag[];
  selected: number[];
  onChange: (ids: number[]) => void;
}) {
  if (tags.length === 0) return null;
  const toggle = (tag: Tag) =>
    onChange(selected.includes(tag.id) ? selected.filter((id) => id !== tag.id) : [...selected, tag.id]);
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="tag-selector">
      {tags.map((tag) => (
        <TagPill key={tag.id} tag={tag} selected={selected.includes(tag.id)} onClick={toggle} />
      ))}
    </div>
  );
}

function ColorField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={HEX_COLOR.test(value) ? value : DEFAULT_TAG_COLOR}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        aria-label={`${label} picker`}
        className="h-9 w-10 cursor-pointer rounded border border-gray-300 dark:border-gray-700"
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`${label} hex`}
        maxLength={7}
        className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 font-mono text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
      />
    </div>
  );
}

function ManageTagsModal({
  tags,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
}: {
  tags: Tag[];
  onClose: () => void;
  onCreate: (input: { name: string; color: string }) => Promise<void>;
  onUpdate: (tag: Tag, input: { name: string; color: string }) => Promise<void>;
  onDelete: (tag: Tag) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_TAG_COLOR);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState(DEFAULT_TAG_COLOR);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function attempt(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError('Tag name is required');
    if (!HEX_COLOR.test(color)) return setError('Color must be a valid hex code');
    if (await attempt(() => onCreate({ name: trimmed, color }))) {
      setName('');
      setColor(DEFAULT_TAG_COLOR);
    }
  }

  async function saveEdit(tag: Tag) {
    const trimmed = editName.trim();
    if (!trimmed) return setError('Tag name is required');
    if (!HEX_COLOR.test(editColor)) return setError('Color must be a valid hex code');
    if (await attempt(() => onUpdate(tag, { name: trimmed, color: editColor }))) setEditingId(null);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-label="Manage tags" className="w-full max-w-lg space-y-4 rounded-xl bg-white p-6 shadow-xl dark:bg-gray-900">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Manage tags</h2>
          <button onClick={onClose} aria-label="Close" className="px-2 text-gray-500 hover:text-gray-800 dark:hover:text-white">
            ✕
          </button>
        </div>

        <form onSubmit={create} className="flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New tag name"
            aria-label="New tag name"
            className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          />
          <ColorField value={color} onChange={setColor} label="New tag color" />
          <button type="submit" className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
            Create Tag
          </button>
        </form>

        {error && (
          <p className="text-sm text-red-600" role="alert" data-testid="tag-error">
            {error}
          </p>
        )}

        <ul className="max-h-80 space-y-2 overflow-y-auto">
          {tags.length === 0 && <li className="text-sm text-gray-400">No tags yet.</li>}
          {tags.map((tag) => (
            <li key={tag.id} data-testid="tag-row" className="flex flex-wrap items-center gap-2 text-sm">
              {editingId === tag.id ? (
                <>
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    aria-label="Tag name"
                    className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-1 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                  />
                  <ColorField value={editColor} onChange={setEditColor} label="Tag color" />
                  <button onClick={() => saveEdit(tag)} className="font-medium text-blue-600 dark:text-blue-400">
                    Update
                  </button>
                  <button onClick={() => setEditingId(null)} className="text-gray-500">
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1">
                    <TagPill tag={tag} selected />
                  </span>
                  <button
                    onClick={() => {
                      setEditingId(tag.id);
                      setEditName(tag.name);
                      setEditColor(tag.color);
                    }}
                    className="text-blue-600 hover:underline dark:text-blue-400"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => window.confirm(`Delete tag "${tag.name}"? It will be removed from all todos.`) && attempt(() => onDelete(tag))}
                    className="text-red-600 hover:underline dark:text-red-400"
                  >
                    Delete
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Saved filters
// ---------------------------------------------------------------------------

function SaveFilterModal({
  preview,
  onClose,
  onSave,
}: {
  preview: string;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        role="dialog"
        aria-label="Save filter"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSave(name.trim());
        }}
        className="w-full max-w-md space-y-3 rounded-xl bg-white p-6 shadow-xl dark:bg-gray-900"
      >
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Save filter</h2>
        <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:bg-gray-800 dark:text-gray-300" data-testid="filter-preview">
          {preview}
        </p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Filter name"
          aria-label="Filter name"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">
            Cancel
          </button>
          <button type="submit" disabled={!name.trim()} className="rounded-lg bg-green-600 px-4 py-2 font-medium text-white hover:bg-green-700 disabled:opacity-50">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

type TemplateWithSubtasks = Template & { subtasks: TemplateSubtask[] };

const TEMPLATE_CATEGORIES = ['Work', 'Personal', 'Finance', 'Health', 'Education'];
const OFFSET_PRESETS: { label: string; minutes: number }[] = [
  { label: 'In 1 hour', minutes: 60 },
  { label: 'In 1 day', minutes: 1440 },
  { label: 'In 3 days', minutes: 4320 },
  { label: 'In 1 week', minutes: 10080 },
];

function templateLabel(t: Template) {
  return t.category ? `${t.name} (${t.category})` : t.name;
}

/** Saves the add form's current state (plus subtasks entered here) as a reusable template. */
function SaveTemplateModal({
  draft,
  defaultOffset,
  onClose,
  onSave,
}: {
  draft: { title: string; priority: Priority; is_recurring: boolean; recurrence_pattern: RecurrencePattern | null; reminder_minutes: number | null };
  defaultOffset: number | null;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [name, setName] = useState(draft.title);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [subtasks, setSubtasks] = useState<string[]>([]);
  const [subtaskDraft, setSubtaskDraft] = useState('');
  const [offset, setOffset] = useState<number | null>(defaultOffset);
  const [error, setError] = useState<string | null>(null);
  const needsOffset = draft.is_recurring || draft.reminder_minutes != null;
  const offsetOptions =
    defaultOffset != null && !OFFSET_PRESETS.some((o) => o.minutes === defaultOffset)
      ? [{ label: `Same as form (${defaultOffset} min from now)`, minutes: defaultOffset }, ...OFFSET_PRESETS]
      : OFFSET_PRESETS;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function addSubtask() {
    const t = subtaskDraft.trim();
    if (!t) return;
    setSubtasks((prev) => [...prev, t]);
    setSubtaskDraft('');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Template name is required');
    if (needsOffset && offset == null) return setError('Recurring templates and reminders need a due date offset');
    try {
      await onSave({
        name,
        description,
        category,
        title_template: draft.title,
        priority: draft.priority,
        is_recurring: draft.is_recurring,
        recurrence_pattern: draft.recurrence_pattern,
        reminder_minutes: draft.reminder_minutes,
        due_date_offset_minutes: offset,
        subtasks,
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form onSubmit={submit} role="dialog" aria-label="Save template" className="w-full max-w-lg space-y-3 rounded-xl bg-white p-6 shadow-xl dark:bg-gray-900">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Save as template</h2>
        <p className="text-sm text-gray-500">
          Saves “{draft.title}” with its priority{draft.is_recurring ? ', repeat' : ''}
          {draft.reminder_minutes != null ? ', reminder' : ''}. Tags and the exact due date are not saved.
        </p>
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Template name" placeholder="Template name" className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-800 dark:text-white" />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Template description" placeholder="Description (optional)" rows={2} className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-800 dark:text-white" />
        <input value={category} onChange={(e) => setCategory(e.target.value)} list="template-categories" aria-label="Template category" placeholder="Category (optional)" className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-800 dark:text-white" />
        <datalist id="template-categories">
          {TEMPLATE_CATEGORIES.map((c) => <option key={c} value={c} />)}
        </datalist>
        <label className="block space-y-1 text-sm">
          <span className="text-gray-600 dark:text-gray-400">Due date when used</span>
          <select
            value={offset ?? ''}
            onChange={(e) => setOffset(e.target.value ? Number(e.target.value) : null)}
            aria-label="Due date offset"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          >
            <option value="">No due date</option>
            {offsetOptions.map((o) => (
              <option key={o.minutes} value={o.minutes}>{o.label}</option>
            ))}
          </select>
        </label>
        <div className="space-y-1 text-sm">
          <span className="text-gray-600 dark:text-gray-400">Subtasks</span>
          <ul className="space-y-1" data-testid="template-subtasks">
            {subtasks.map((s, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="flex-1 text-gray-700 dark:text-gray-200">{i + 1}. {s}</span>
                <button type="button" onClick={() => setSubtasks((prev) => prev.filter((_, j) => j !== i))} aria-label={`Remove subtask "${s}"`} className="text-gray-400 hover:text-red-600">✕</button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <input
              value={subtaskDraft}
              onChange={(e) => setSubtaskDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addSubtask();
                }
              }}
              aria-label="Template subtask"
              placeholder="Add a subtask"
              className="flex-1 rounded-lg border border-gray-300 px-2 py-1 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            />
            <button type="button" onClick={addSubtask} className="rounded-lg border border-gray-300 px-3 py-1 dark:border-gray-700 dark:text-gray-200">Add subtask</button>
          </div>
        </div>
        {error && <p className="text-sm text-red-600" role="alert" data-testid="template-error">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">Cancel</button>
          <button type="submit" className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700">Save Template</button>
        </div>
      </form>
    </div>
  );
}

function TemplateManagerModal({
  templates,
  onClose,
  onUse,
  onDelete,
}: {
  templates: TemplateWithSubtasks[];
  onClose: () => void;
  onUse: (t: Template) => Promise<void>;
  onDelete: (t: Template) => Promise<void>;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Templates" className="flex max-h-[85vh] w-full max-w-2xl flex-col gap-4 rounded-xl bg-white p-6 shadow-xl dark:bg-gray-900">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">📋 Templates</h2>
          <button onClick={onClose} aria-label="Close" className="px-2 text-gray-500 hover:text-gray-800 dark:hover:text-white">✕</button>
        </div>
        <ul className="space-y-3 overflow-y-auto">
          {templates.length === 0 && <li className="text-sm text-gray-400">No templates yet. Fill in the todo form and click “💾 Save as Template”.</li>}
          {templates.map((t) => (
            <li key={t.id} data-testid="template-card" className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="font-semibold text-gray-900 dark:text-white">{t.name}</p>
                  {t.description && <p className="text-sm text-gray-600 dark:text-gray-400">{t.description}</p>}
                  <div className="flex flex-wrap items-center gap-2">
                    {t.category && (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">{t.category}</span>
                    )}
                    <PriorityBadge priority={t.priority} />
                    {t.is_recurring && t.recurrence_pattern && <RecurrenceBadge pattern={t.recurrence_pattern} />}
                    {t.reminder_minutes != null && <ReminderBadge minutes={t.reminder_minutes} />}
                    {t.subtasks.length > 0 && <span className="text-xs text-gray-500">{t.subtasks.length} subtasks</span>}
                  </div>
                </div>
                <div className="flex shrink-0 gap-3 text-sm">
                  <button onClick={() => onUse(t)} className="font-medium text-blue-600 hover:underline dark:text-blue-400">Use</button>
                  <button onClick={() => window.confirm(`Delete template "${t.name}"?`) && onDelete(t)} className="text-red-600 hover:underline dark:text-red-400">Delete</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Todo item
// ---------------------------------------------------------------------------

function ProgressBar({ subtasks }: { subtasks: Subtask[] }) {
  const { completed, total, percent } = calculateProgress(subtasks);
  if (total === 0) return null;
  const done = percent === 100;
  return (
    <div className="mt-2 flex items-center gap-2" data-testid="subtask-progress">
      <div
        className="h-2 w-40 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Subtask progress"
      >
        <div
          data-testid="progress-fill"
          data-complete={done}
          className={`h-full transition-all ${done ? 'bg-green-500' : 'bg-blue-500'}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-xs text-gray-600 dark:text-gray-400" data-testid="progress-text">
        {completed}/{total} subtasks
      </span>
    </div>
  );
}

interface SubtaskHandlers {
  onAddSubtask: (todo: Todo, title: string) => void;
  onToggleSubtask: (todo: Todo, subtask: Subtask, completed: boolean) => void;
  onDeleteSubtask: (todo: Todo, subtask: Subtask) => void;
}

function SubtaskList({ todo, onAddSubtask, onToggleSubtask, onDeleteSubtask }: { todo: Todo } & SubtaskHandlers) {
  const [title, setTitle] = useState('');
  const subtasks = todo.subtasks ?? [];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = normalizeTitle(title);
    if (!trimmed) return;
    onAddSubtask(todo, trimmed);
    setTitle('');
  }

  return (
    <div className="mt-3 space-y-2 border-t border-gray-100 pt-3 dark:border-gray-700" data-testid="subtask-panel">
      {subtasks.length > 0 && (
        <ul className="space-y-1">
          {subtasks.map((s) => (
            <li key={s.id} data-testid="subtask-item" className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={s.completed}
                disabled={s.id < 0} // not saved yet: no server id to update
                onChange={(e) => onToggleSubtask(todo, s, e.target.checked)}
                aria-label={`Mark subtask "${s.title}" as ${s.completed ? 'incomplete' : 'complete'}`}
                className="h-4 w-4"
              />
              <span className={`flex-1 break-words ${s.completed ? 'text-gray-400 line-through' : 'text-gray-700 dark:text-gray-200'}`}>
                {s.title}
              </span>
              <button
                onClick={() => onDeleteSubtask(todo, s)}
                disabled={s.id < 0}
                aria-label={`Delete subtask "${s.title}"`}
                className="px-1 text-gray-400 hover:text-red-600"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="flex gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a subtask"
          aria-label="New subtask"
          className="flex-1 rounded-lg border border-gray-300 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
        />
        <button
          type="submit"
          disabled={!title.trim()}
          className="rounded-lg bg-gray-800 px-3 py-1 text-sm text-white disabled:opacity-40 dark:bg-gray-200 dark:text-gray-900"
        >
          Add
        </button>
      </form>
    </div>
  );
}

function TodoItem({
  todo,
  overdue,
  now,
  onToggle,
  onEdit,
  onDelete,
  onTagClick,
  ...subtaskHandlers
}: {
  todo: Todo;
  overdue: boolean;
  now: Date;
  onToggle: (todo: Todo, completed: boolean) => void;
  onEdit: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
  onTagClick: (tag: Tag) => void;
} & SubtaskHandlers) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li
      data-testid="todo-item"
      data-todo-id={todo.id}
      className={`rounded-lg border bg-white p-4 shadow-sm dark:bg-gray-800 ${
        overdue ? 'border-red-300 dark:border-red-800' : 'border-gray-200 dark:border-gray-700'
      }`}
    >
     <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <input
          type="checkbox"
          checked={todo.completed}
          onChange={(e) => onToggle(todo, e.target.checked)}
          className="mt-1 h-5 w-5 shrink-0 cursor-pointer rounded border-gray-300 dark:border-gray-600"
          aria-label={`Mark "${todo.title}" as ${todo.completed ? 'incomplete' : 'complete'}`}
        />
        <div className="min-w-0">
          <p
            className={`break-words font-medium ${
              todo.completed ? 'text-gray-400 line-through' : 'text-gray-800 dark:text-white'
            }`}
          >
            {todo.title}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <PriorityBadge priority={todo.priority} />
            {todo.is_recurring && todo.recurrence_pattern && <RecurrenceBadge pattern={todo.recurrence_pattern} />}
            {todo.reminder_minutes != null && <ReminderBadge minutes={todo.reminder_minutes} />}
            {todo.tags?.map((tag) => <TodoTagChip key={tag.id} tag={tag} onClick={onTagClick} />)}
            {todo.due_date && (
              <span
                className={`text-sm ${overdue ? 'font-medium text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}
              >
                {formatSingaporeDate(todo.due_date)} · {formatRelative(todo.due_date, now)}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 gap-3 pl-8 text-sm sm:pl-0">
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="text-gray-600 hover:underline dark:text-gray-300"
        >
          {expanded ? '▼ Subtasks' : '▶ Subtasks'}
        </button>
        <button onClick={() => onEdit(todo)} className="text-blue-600 hover:underline dark:text-blue-400">
          Edit
        </button>
        <button onClick={() => onDelete(todo)} className="text-red-600 hover:underline dark:text-red-400">
          Delete
        </button>
      </div>
     </div>
      <div className="pl-8">
        <ProgressBar subtasks={todo.subtasks ?? []} />
        {expanded && <SubtaskList todo={todo} {...subtaskHandlers} />}
      </div>
    </li>
  );
}

function Section({
  title,
  testId,
  tone,
  todos,
  render,
}: {
  title: string;
  testId: string;
  tone: 'red' | 'gray' | 'green';
  todos: Todo[];
  render: (todo: Todo) => React.ReactNode;
}) {
  const color = {
    red: 'text-red-600 dark:text-red-400',
    gray: 'text-gray-700 dark:text-gray-300',
    green: 'text-green-700 dark:text-green-400',
  }[tone];
  return (
    <section data-testid={testId} className="space-y-2">
      <h2 className={`text-lg font-semibold ${color}`}>
        {title} ({todos.length})
      </h2>
      {todos.length === 0 ? (
        <p className="text-sm text-gray-400">Nothing here.</p>
      ) : (
        <ul className="space-y-2">{todos.map(render)}</ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Edit modal
// ---------------------------------------------------------------------------

function EditModal({
  todo,
  tags,
  onCancel,
  onSave,
}: {
  todo: Todo;
  tags: Tag[];
  onCancel: () => void;
  onSave: (changes: Record<string, unknown>) => Promise<void>;
}) {
  const originalTagIds = (todo.tags ?? []).map((t) => t.id);
  const [tagIds, setTagIds] = useState<number[]>(originalTagIds);
  const [title, setTitle] = useState(todo.title);
  const [due, setDue] = useState(isoToDatetimeLocal(todo.due_date));
  const [priority, setPriority] = useState<Priority>(todo.priority);
  const [repeat, setRepeat] = useState(todo.is_recurring);
  const [pattern, setPattern] = useState<RecurrencePattern>(todo.recurrence_pattern ?? 'weekly');
  const [reminder, setReminder] = useState<number | null>(todo.reminder_minutes);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = normalizeTitle(title);
    if (!trimmed) return setError('Title cannot be empty');

    // Send only the fields that actually changed.
    const changes: Record<string, unknown> = {};
    if (trimmed !== todo.title) changes.title = trimmed;
    if (priority !== todo.priority) changes.priority = priority;
    const dueISO = due ? datetimeLocalToISO(due) : null;
    if (dueISO !== todo.due_date) {
      if (dueISO) {
        const dueError = validateDueDate(dueISO, getSingaporeNow());
        if (dueError) return setError(dueError);
      }
      changes.due_date = dueISO;
    }
    if (repeat && !dueISO) return setError('Recurring todos require a due date');
    const finalReminder = dueISO ? reminder : null;
    if (finalReminder !== todo.reminder_minutes) changes.reminder_minutes = finalReminder;
    const sameTags = tagIds.length === originalTagIds.length && tagIds.every((id) => originalTagIds.includes(id));
    if (!sameTags) changes.tag_ids = tagIds;
    if (repeat !== todo.is_recurring) changes.is_recurring = repeat;
    if (repeat && pattern !== todo.recurrence_pattern) {
      changes.is_recurring = true;
      changes.recurrence_pattern = pattern;
    }
    if (Object.keys(changes).length === 0) return onCancel();

    setSaving(true);
    try {
      await onSave(changes);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
      data-testid="edit-modal-backdrop"
    >
      <form
        onSubmit={submit}
        role="dialog"
        aria-label="Edit todo"
        className="w-full max-w-lg space-y-4 rounded-xl bg-white p-6 shadow-xl dark:bg-gray-900"
      >
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Edit todo</h2>
        <label className="block space-y-1">
          <span className="text-sm text-gray-600 dark:text-gray-400">Title</span>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            aria-label="Edit title"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-gray-600 dark:text-gray-400">Due date (Singapore time)</span>
          <input
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            aria-label="Edit due date"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-gray-600 dark:text-gray-400">Priority</span>
          <div>
            <PrioritySelect value={priority} onChange={setPriority} label="Edit priority" />
          </div>
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-gray-600 dark:text-gray-400">Reminder</span>
          <div>
            <ReminderSelect value={reminder} onChange={setReminder} disabled={!due} label="Edit reminder" />
          </div>
        </label>
        <RepeatControls
          repeat={repeat}
          pattern={pattern}
          onRepeatChange={setRepeat}
          onPatternChange={setPattern}
          idPrefix="Edit "
        />
        {tags.length > 0 && (
          <div className="space-y-1">
            <span className="text-sm text-gray-600 dark:text-gray-400">Tags</span>
            <TagSelector tags={tags} selected={tagIds} onChange={setTagIds} />
          </div>
        )}
        {error && <p className="text-sm text-red-600" role="alert" data-testid="edit-error">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Update
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Home() {
  const router = useRouter();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => getSingaporeNow());

  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [repeat, setRepeat] = useState(false);
  const [pattern, setPattern] = useState<RecurrencePattern>('weekly');
  const [reminder, setReminder] = useState<number | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTER_STATE);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [savingFilter, setSavingFilter] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);
  const [newTagIds, setNewTagIds] = useState<number[]>([]);
  const [managingTags, setManagingTags] = useState(false);
  const [templates, setTemplates] = useState<TemplateWithSubtasks[]>([]);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [managingTemplates, setManagingTemplates] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Todo | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTodos(): Promise<Todo[]> {
      const [meRes, res, tagsRes, templatesRes] = await Promise.all([
        fetch('/api/auth/me'),
        fetch('/api/todos'),
        fetch('/api/tags'),
        fetch('/api/templates'),
      ]);
      if (meRes.status === 401 || res.status === 401) {
        // Cookie is stale (e.g. user deleted): clear it so the proxy doesn't bounce /login back here.
        await fetch('/api/auth/logout', { method: 'POST' });
        router.replace('/login');
        return new Promise(() => {});
      }
      if (!res.ok) throw new Error('Could not load todos');
      if (!cancelled) setUsername((await meRes.json()).username);
      if (!cancelled && tagsRes.ok) setTags(await tagsRes.json());
      if (!cancelled && templatesRes.ok) setTemplates(await templatesRes.json());
      return res.json();
    }
    // Ignore a superseded load (e.g. React dev double-mount) so a late
    // response can't clobber todos added or removed in the meantime.
    let cancelled = false;
    fetchTodos()
      .then((list) => !cancelled && setTodos((prev) => [...prev.filter((t) => t.id < 0), ...list]))
      .catch((err) => !cancelled && setError((err as Error).message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [router]);

  // Re-evaluate overdue/pending as time passes.
  useEffect(() => {
    const timer = setInterval(() => setNow(getSingaporeNow()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // Search is debounced; clearing it (✕ / Clear All / presets) applies immediately.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(filters.search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [filters.search]);

  // Saved presets live in this browser's localStorage.
  useEffect(() => {
    Promise.resolve().then(() => setPresets(loadPresets()));
  }, []);

  const appliedFilters = useMemo(() => ({ ...filters, search: debouncedSearch }), [filters, debouncedSearch]);
  const filtersActive = hasActiveFilters(filters);
  const visibleTodos = useMemo(() => applyFilters(todos, appliedFilters), [todos, appliedFilters]);

  const updateFilters = (patch: Partial<FilterState>) => setFilters((prev) => ({ ...prev, ...patch }));
  function setFiltersNow(next: FilterState) {
    setFilters(next);
    setDebouncedSearch(next.search);
  }

  function handleSavePreset(name: string) {
    const preset: FilterPreset = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      filters,
      createdAt: getSingaporeNow().toISOString(),
    };
    const next = [...presets, preset];
    setPresets(next);
    savePresets(next);
    setSavingFilter(false);
  }

  function handleDeletePreset(preset: FilterPreset) {
    if (!window.confirm(`Delete saved filter "${preset.name}"?`)) return;
    const next = presets.filter((p) => p.id !== preset.id);
    setPresets(next);
    savePresets(next);
  }

  // --- Export / import ------------------------------------------------------

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setError(null);
    setNotice(file.size > 10 * 1024 * 1024 ? 'Large file: this may take a while…' : null);
    try {
      const result = await api<{ imported: number }>('/api/todos/import', { method: 'POST', body: await file.text() });
      const [freshTodos, freshTags] = await Promise.all([api<Todo[]>('/api/todos'), api<Tag[]>('/api/tags')]);
      setTodos(freshTodos);
      setTags(freshTags);
      setNow(getSingaporeNow());
      setNotice(`Successfully imported ${result.imported} todos`);
    } catch (err) {
      setNotice(null);
      setError((err as Error).message);
    }
  }

  // --- Templates ------------------------------------------------------------

  async function handleSaveTemplate(body: Record<string, unknown>) {
    const saved = await api<TemplateWithSubtasks>('/api/templates', { method: 'POST', body: JSON.stringify(body) });
    setTemplates((prev) => [...prev, saved].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })));
    setSavingTemplate(false);
    setNotice(`Template "${saved.name}" saved.`);
  }

  async function handleUseTemplate(template: Template) {
    try {
      const todo = await api<Todo>(`/api/templates/${template.id}/use`, { method: 'POST' });
      setTodos((prev) => [todo, ...prev]);
      setNow(getSingaporeNow());
      setManagingTemplates(false);
    } catch (err) {
      setError(`Could not use template: ${(err as Error).message}`);
    }
  }

  async function handleDeleteTemplate(template: Template) {
    try {
      await api(`/api/templates/${template.id}`, { method: 'DELETE' });
      setTemplates((prev) => prev.filter((t) => t.id !== template.id));
    } catch (err) {
      setError(`Could not delete template: ${(err as Error).message}`);
    }
  }

  // --- Tags -----------------------------------------------------------------

  async function handleCreateTag(input: { name: string; color: string }) {
    const tag = await api<Tag>('/api/tags', { method: 'POST', body: JSON.stringify(input) });
    setTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })));
  }

  async function handleUpdateTag(tag: Tag, input: { name: string; color: string }) {
    const saved = await api<Tag>(`/api/tags/${tag.id}`, { method: 'PUT', body: JSON.stringify(input) });
    // Tags are looked up live, so every todo showing this tag picks up the change.
    setTags((prev) => prev.map((t) => (t.id === saved.id ? saved : t)));
    setTodos((prev) => prev.map((t) => ({ ...t, tags: t.tags?.map((x) => (x.id === saved.id ? saved : x)) })));
  }

  async function handleDeleteTag(tag: Tag) {
    await api(`/api/tags/${tag.id}`, { method: 'DELETE' });
    setTags((prev) => prev.filter((t) => t.id !== tag.id));
    setTodos((prev) => prev.map((t) => ({ ...t, tags: t.tags?.filter((x) => x.id !== tag.id) })));
    setNewTagIds((prev) => prev.filter((id) => id !== tag.id));
    // Don't leave a filter pointing at a deleted tag.
    setFilters((prev) => (prev.tagId === tag.id ? { ...prev, tagId: 'all' } : prev));
  }
  const sections = useMemo(() => sectionTodos(visibleTodos, now), [visibleTodos, now]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const trimmed = normalizeTitle(title);
    if (!trimmed) return setFormError('Title is required');
    const dueISO = due ? datetimeLocalToISO(due) : null;
    if (dueISO) {
      const dueError = validateDueDate(dueISO, getSingaporeNow());
      if (dueError) return setFormError(dueError);
    }
    if (repeat && !dueISO) return setFormError('Recurring todos require a due date');

    const optimistic: Todo = {
      id: -Date.now(), // temporary negative id, replaced on server response
      user_id: 0,
      title: trimmed,
      completed: false,
      due_date: dueISO,
      priority,
      is_recurring: repeat,
      recurrence_pattern: repeat ? pattern : null,
      reminder_minutes: dueISO ? reminder : null,
      last_notification_sent: null,
      created_at: getSingaporeNow().toISOString(),
      updated_at: null,
      subtasks: [],
      tags: tags.filter((t) => newTagIds.includes(t.id)),
    };
    const tagIds = newTagIds;
    setTodos((prev) => [optimistic, ...prev]);
    setNow(getSingaporeNow()); // keep relative due times fresh for the new row
    setTitle('');
    setDue('');
    setPriority('medium');
    setRepeat(false);
    setReminder(null);
    setNewTagIds([]);

    try {
      const saved = await api<Todo>('/api/todos', {
        method: 'POST',
        body: JSON.stringify({
          title: trimmed,
          due_date: dueISO,
          priority,
          is_recurring: repeat,
          recurrence_pattern: repeat ? pattern : null,
          reminder_minutes: dueISO ? reminder : null,
          tag_ids: tagIds,
        }),
      });
      setTodos((prev) => prev.map((t) => (t.id === optimistic.id ? saved : t)));
    } catch (err) {
      setTodos((prev) => prev.filter((t) => t.id !== optimistic.id));
      setError(`Could not create todo: ${(err as Error).message}`);
    }
  }

  async function handleToggle(todo: Todo, completed: boolean) {
    setTodos((prev) =>
      prev.map((t) => (t.id === todo.id ? { ...t, completed, updated_at: getSingaporeNow().toISOString() } : t))
    );
    try {
      const { next_instance, ...saved } = await api<Todo & { next_instance?: Todo | null }>(`/api/todos/${todo.id}`, {
        method: 'PUT',
        body: JSON.stringify({ completed }),
      });
      setTodos((prev) => {
        const list = prev.map((t) => (t.id === todo.id ? saved : t));
        return next_instance ? [next_instance, ...list] : list;
      });
    } catch (err) {
      setTodos((prev) => prev.map((t) => (t.id === todo.id ? todo : t)));
      setError(`Could not update todo: ${(err as Error).message}`);
    }
  }

  async function handleDelete(todo: Todo) {
    setTodos((prev) => prev.filter((t) => t.id !== todo.id));
    try {
      await api(`/api/todos/${todo.id}`, { method: 'DELETE' });
    } catch (err) {
      setTodos((prev) => [todo, ...prev]);
      setError(`Could not delete todo: ${(err as Error).message}`);
    }
  }

  async function handleSaveEdit(changes: Record<string, unknown>) {
    if (!editing) return;
    const saved = await api<Todo>(`/api/todos/${editing.id}`, {
      method: 'PUT',
      body: JSON.stringify(changes),
    });
    setTodos((prev) => prev.map((t) => (t.id === saved.id ? saved : t)));
    setEditing(null);
  }

  const closeEdit = useCallback(() => setEditing(null), []);
  const closeManageTags = useCallback(() => setManagingTags(false), []);
  const closeSaveTemplate = useCallback(() => setSavingTemplate(false), []);
  const closeTemplates = useCallback(() => setManagingTemplates(false), []);
  const closeSaveFilter = useCallback(() => setSavingFilter(false), []);

  // Subtasks: optimistic updates on the parent todo's `subtasks` array.
  const patchSubtasks = (todoId: number, fn: (subs: Subtask[]) => Subtask[]) =>
    setTodos((prev) => prev.map((t) => (t.id === todoId ? { ...t, subtasks: fn(t.subtasks ?? []) } : t)));

  async function handleAddSubtask(todo: Todo, title: string) {
    const temp: Subtask = {
      id: -Date.now(),
      todo_id: todo.id,
      title,
      completed: false,
      position: Math.max(0, ...(todo.subtasks ?? []).map((s) => s.position)) + 1,
      created_at: getSingaporeNow().toISOString(),
    };
    patchSubtasks(todo.id, (subs) => [...subs, temp]);
    try {
      const saved = await api<Subtask>(`/api/todos/${todo.id}/subtasks`, { method: 'POST', body: JSON.stringify({ title }) });
      patchSubtasks(todo.id, (subs) => subs.map((s) => (s.id === temp.id ? saved : s)));
    } catch (err) {
      patchSubtasks(todo.id, (subs) => subs.filter((s) => s.id !== temp.id));
      setError(`Could not add subtask: ${(err as Error).message}`);
    }
  }

  async function handleToggleSubtask(todo: Todo, subtask: Subtask, completed: boolean) {
    patchSubtasks(todo.id, (subs) => subs.map((s) => (s.id === subtask.id ? { ...s, completed } : s)));
    try {
      const saved = await api<Subtask>(`/api/subtasks/${subtask.id}`, { method: 'PUT', body: JSON.stringify({ completed }) });
      patchSubtasks(todo.id, (subs) => subs.map((s) => (s.id === saved.id ? saved : s)));
    } catch (err) {
      patchSubtasks(todo.id, (subs) => subs.map((s) => (s.id === subtask.id ? subtask : s)));
      setError(`Could not update subtask: ${(err as Error).message}`);
    }
  }

  async function handleDeleteSubtask(todo: Todo, subtask: Subtask) {
    patchSubtasks(todo.id, (subs) => subs.filter((s) => s.id !== subtask.id));
    try {
      await api(`/api/subtasks/${subtask.id}`, { method: 'DELETE' });
    } catch (err) {
      patchSubtasks(todo.id, (subs) => [...subs, subtask].sort((a, b) => a.position - b.position));
      setError(`Could not delete subtask: ${(err as Error).message}`);
    }
  }

  const markNotified = useCallback(
    (todo: Todo) =>
      setTodos((prev) =>
        prev.map((t) => (t.id === todo.id ? { ...t, last_notification_sent: getSingaporeNow().toISOString() } : t))
      ),
    []
  );
  const { permission, requestPermission } = useNotifications(markNotified);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
  }

  async function handleAddDevice() {
    if (!username) return;
    setError(null);
    setNotice(null);
    try {
      await passkeyFlow('register', username);
      setNotice('Passkey added. You can now sign in with this device too.');
    } catch (err) {
      setError(describePasskeyError(err));
    }
  }

  function renderItem(todo: Todo, overdue: boolean) {
    return (
      <TodoItem
        key={todo.id}
        todo={todo}
        overdue={overdue}
        now={now}
        onToggle={handleToggle}
        onEdit={setEditing}
        onDelete={handleDelete}
        onAddSubtask={handleAddSubtask}
        onToggleSubtask={handleToggleSubtask}
        onDeleteSubtask={handleDeleteSubtask}
        onTagClick={(tag) => updateFilters({ tagId: tag.id })}
      />
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl space-y-8 px-4 py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Todo App</h1>
          <p className="text-sm text-gray-500">All times are Singapore time (SGT).</p>
        </div>
        {username && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            {permission === 'granted' ? (
              <span
                className="rounded-full bg-green-100 px-3 py-1 font-medium text-green-800 dark:bg-green-950 dark:text-green-300"
                data-testid="notifications-on"
              >
                🔔 Notifications On
              </span>
            ) : permission !== 'unsupported' ? (
              <button
                onClick={requestPermission}
                className="rounded-lg bg-orange-500 px-3 py-1 font-medium text-white hover:bg-orange-600"
                title={permission === 'denied' ? 'Notifications are blocked. Allow them in your browser site settings.' : undefined}
              >
                🔔 Enable Notifications
              </button>
            ) : null}
            <span className="text-gray-600 dark:text-gray-400" data-testid="current-user">
              {username}
            </span>
            <Link href="/calendar" className="rounded-lg bg-purple-600 px-3 py-1 font-medium text-white hover:bg-purple-700">
              Calendar
            </Link>
            <button onClick={() => setManagingTemplates(true)} className="font-medium text-gray-700 hover:underline dark:text-gray-300">
              📋 Templates
            </button>
            <button onClick={handleAddDevice} className="text-blue-600 hover:underline dark:text-blue-400">
              Add device
            </button>
            <button
              onClick={handleLogout}
              className="rounded-lg border border-gray-300 px-3 py-1 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Logout
            </button>
          </div>
        )}
      </header>

      {username && (
        <div className="flex flex-wrap items-center justify-end gap-2 text-sm" aria-label="Export and import">
          <a
            href="/api/todos/export?format=json"
            download
            className="rounded-lg bg-green-600 px-3 py-1.5 font-medium text-white hover:bg-green-700"
          >
            Export JSON
          </a>
          <a
            href="/api/todos/export?format=csv"
            download
            className="rounded-lg bg-green-800 px-3 py-1.5 font-medium text-white hover:bg-green-900"
          >
            Export CSV
          </a>
          <label
            className="cursor-pointer rounded-lg bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700"
            title="Import creates new todos and does not merge with existing ones"
          >
            Import
            <input type="file" accept="application/json,.json" onChange={handleImportFile} className="sr-only" aria-label="Import todos file" />
          </label>
        </div>
      )}

      {notice && (
        <p className="rounded-lg bg-green-50 px-4 py-2 text-sm text-green-800 dark:bg-green-950 dark:text-green-300" data-testid="notice">
          {notice}
        </p>
      )}

      <form onSubmit={handleAdd} className="space-y-2" noValidate>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs to be done?"
            aria-label="Todo title"
            className="flex-1 rounded-lg sm:min-w-full border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          />
          <input
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            aria-label="Due date"
            className="rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          />
          <PrioritySelect value={priority} onChange={setPriority} label="Priority" />
          <ReminderSelect value={reminder} onChange={setReminder} disabled={!due} label="Reminder" />
          <div className="flex items-center">
            <RepeatControls repeat={repeat} pattern={pattern} onRepeatChange={setRepeat} onPatternChange={setPattern} idPrefix="" />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-blue-600 px-5 py-2 font-medium text-white hover:bg-blue-700"
          >
            Add
          </button>
        </div>
        {title.length > TITLE_SOFT_LIMIT && (
          <p className="text-sm text-amber-600">Long title ({title.length} characters). Consider shortening it.</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <TagSelector tags={tags} selected={newTagIds} onChange={setNewTagIds} />
          <button
            type="button"
            onClick={() => setManagingTags(true)}
            className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            + Manage Tags
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {templates.length > 0 && (
            <select
              value=""
              onChange={(e) => {
                const t = templates.find((x) => x.id === Number(e.target.value));
                if (t) handleUseTemplate(t);
              }}
              aria-label="Use Template"
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            >
              <option value="">Use Template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {templateLabel(t)}
                </option>
              ))}
            </select>
          )}
          {title.trim() && (
            <button
              type="button"
              onClick={() => setSavingTemplate(true)}
              className="text-sm font-medium text-gray-700 hover:underline dark:text-gray-300"
            >
              💾 Save as Template
            </button>
          )}
        </div>
        {formError && (
          <p className="text-sm text-red-600" role="alert" data-testid="form-error">
            {formError}
          </p>
        )}
      </form>

      {error && (
        <div
          className="flex items-center justify-between rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
          role="alert"
          data-testid="error-banner"
        >
          <span>{error}</span>
          <button onClick={() => setError(null)} className="font-medium">
            Dismiss
          </button>
        </div>
      )}

      <section className="space-y-3" aria-label="Search and filters">
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden>
            🔍
          </span>
          <input
            value={filters.search}
            onChange={(e) => updateFilters({ search: e.target.value })}
            placeholder="Search todos and subtasks..."
            aria-label="Search todos"
            className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-10 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          />
          {filters.search && (
            <button
              type="button"
              onClick={() => setFiltersNow({ ...filters, search: '' })}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 px-1 text-gray-400 hover:text-gray-700"
            >
              ✕
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={filters.priority}
            onChange={(e) => updateFilters({ priority: e.target.value as Priority | 'all' })}
            aria-label="Filter by priority"
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          >
            <option value="all">All Priorities</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]} Priority
              </option>
            ))}
          </select>
          {tags.length > 0 && (
            <select
              value={filters.tagId === 'all' ? '' : filters.tagId}
              onChange={(e) => updateFilters({ tagId: e.target.value ? Number(e.target.value) : 'all' })}
              aria-label="Filter by tag"
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            >
              <option value="">All Tags</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              showAdvanced ? 'bg-blue-600 text-white' : 'border border-gray-300 text-gray-700 dark:border-gray-700 dark:text-gray-300'
            }`}
          >
            {showAdvanced ? '▼ Advanced' : '▶ Advanced'}
          </button>
          {filtersActive && (
            <>
              <button
                type="button"
                onClick={() => setFiltersNow(DEFAULT_FILTER_STATE)}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
              >
                Clear All
              </button>
              <button
                type="button"
                onClick={() => setSavingFilter(true)}
                className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
              >
                💾 Save Filter
              </button>
            </>
          )}
        </div>

        {showAdvanced && (
          <div className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700" data-testid="advanced-filters">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <select
                value={filters.completion}
                onChange={(e) => updateFilters({ completion: e.target.value as CompletionFilter })}
                aria-label="Completion status"
                className="rounded-lg border border-gray-300 px-3 py-1.5 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              >
                <option value="all">All Todos</option>
                <option value="incomplete">Incomplete Only</option>
                <option value="completed">Completed Only</option>
              </select>
              <label className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
                Due from
                <input
                  type="date"
                  value={filters.dueDateFrom ?? ''}
                  onChange={(e) => updateFilters({ dueDateFrom: e.target.value || null })}
                  aria-label="Due date from"
                  className="rounded-lg border border-gray-300 px-2 py-1 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
              </label>
              <label className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
                to
                <input
                  type="date"
                  value={filters.dueDateTo ?? ''}
                  onChange={(e) => updateFilters({ dueDateTo: e.target.value || null })}
                  aria-label="Due date to"
                  className="rounded-lg border border-gray-300 px-2 py-1 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
              </label>
            </div>
            {presets.length > 0 && (
              <div className="flex flex-wrap items-center gap-2" data-testid="filter-presets">
                <span className="text-xs text-gray-500">Saved:</span>
                {presets.map((p) => (
                  <span key={p.id} className="inline-flex items-center rounded-full bg-gray-100 text-sm dark:bg-gray-800" data-testid="filter-preset">
                    <button
                      type="button"
                      onClick={() => setFiltersNow({ ...DEFAULT_FILTER_STATE, ...p.filters })}
                      title={describeFilters(p.filters, tags)}
                      className="px-3 py-1 text-gray-800 hover:underline dark:text-gray-200"
                    >
                      {p.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeletePreset(p)}
                      aria-label={`Delete saved filter "${p.name}"`}
                      className="pr-2 text-gray-400 hover:text-red-600"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : filtersActive && visibleTodos.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center dark:border-gray-700" data-testid="no-matches">
          <p className="text-gray-600 dark:text-gray-400">No todos match your filters.</p>
          <button onClick={() => setFiltersNow(DEFAULT_FILTER_STATE)} className="mt-2 text-sm font-medium text-blue-600 hover:underline">
            Clear All
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          {todos.length === 0 && (
            <p className="text-gray-500" data-testid="empty-state">
              No todos yet. Add your first one above.
            </p>
          )}
          {/* While filtering, empty sections are hidden; counts are post-filter. */}
          {sections.overdue.length > 0 && (
            <Section title="Overdue" testId="section-overdue" tone="red" todos={sections.overdue} render={(t) => renderItem(t, true)} />
          )}
          {(!filtersActive || sections.pending.length > 0) && (
            <Section title="Pending" testId="section-pending" tone="gray" todos={sections.pending} render={(t) => renderItem(t, false)} />
          )}
          {(!filtersActive || sections.completed.length > 0) && (
            <Section title="Completed" testId="section-completed" tone="green" todos={sections.completed} render={(t) => renderItem(t, false)} />
          )}
        </div>
      )}

      {editing && <EditModal todo={editing} tags={tags} onCancel={closeEdit} onSave={handleSaveEdit} />}
      {managingTags && (
        <ManageTagsModal
          tags={tags}
          onClose={closeManageTags}
          onCreate={handleCreateTag}
          onUpdate={handleUpdateTag}
          onDelete={handleDeleteTag}
        />
      )}
      {savingTemplate && (
        <SaveTemplateModal
          draft={{
            title: title.trim(),
            priority,
            is_recurring: repeat,
            recurrence_pattern: repeat ? pattern : null,
            reminder_minutes: due ? reminder : null,
          }}
          defaultOffset={(() => {
            const iso = due ? datetimeLocalToISO(due) : null;
            if (!iso) return null;
            const minutes = Math.round((new Date(iso).getTime() - getSingaporeNow().getTime()) / 60_000);
            return minutes >= 1 ? minutes : null;
          })()}
          onClose={closeSaveTemplate}
          onSave={handleSaveTemplate}
        />
      )}
      {savingFilter && (
        <SaveFilterModal preview={describeFilters(filters, tags)} onClose={closeSaveFilter} onSave={handleSavePreset} />
      )}
      {managingTemplates && (
        <TemplateManagerModal
          templates={templates}
          onClose={closeTemplates}
          onUse={handleUseTemplate}
          onDelete={handleDeleteTemplate}
        />
      )}
    </main>
  );
}
