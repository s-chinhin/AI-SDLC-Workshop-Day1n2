import Database from 'better-sqlite3';
import path from 'path';
import { getSingaporeNow, toSingaporeISO } from './timezone';

// ---------------------------------------------------------------------------
// Types (shared by API routes and client components — import as types only
// on the client)
// ---------------------------------------------------------------------------

import { DEFAULT_TAG_COLOR, type Priority, type RecurrencePattern } from './constants';
export * from './constants';

export interface User {
  id: number;
  username: string;
  created_at: string;
}

export interface Authenticator {
  id: number;
  user_id: number;
  credential_id: string;
  credential_public_key: Buffer;
  counter: number;
  transports: string | null;
  created_at: string;
}

export interface Todo {
  id: number;
  user_id: number;
  title: string;
  completed: boolean;
  due_date: string | null;
  priority: Priority;
  is_recurring: boolean;
  recurrence_pattern: RecurrencePattern | null;
  reminder_minutes: number | null;
  last_notification_sent: string | null;
  created_at: string;
  updated_at: string | null;
  subtasks?: Subtask[];
  tags?: Tag[];
}

export interface Subtask {
  id: number;
  todo_id: number;
  title: string;
  completed: boolean;
  position: number;
  created_at: string;
}

export interface Tag {
  id: number;
  user_id: number;
  name: string;
  color: string;
  created_at: string;
}

export interface Template {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  category: string | null;
  title_template: string;
  priority: Priority;
  is_recurring: boolean;
  recurrence_pattern: RecurrencePattern | null;
  reminder_minutes: number | null;
  due_date_offset_minutes: number | null;
  subtasks_json: string | null;
  created_at: string;
}

export interface Holiday {
  id: number;
  date: string;
  name: string;
}

export interface CreateTodoInput {
  title: string;
  due_date?: string | null;
  priority?: Priority;
  is_recurring?: boolean;
  recurrence_pattern?: RecurrencePattern | null;
  reminder_minutes?: number | null;
  tag_ids?: number[];
}

export interface UpdateTodoInput extends Partial<CreateTodoInput> {
  completed?: boolean;
  last_notification_sent?: string | null;
}

// ---------------------------------------------------------------------------
// Connection + schema
// ---------------------------------------------------------------------------

const DB_PATH = process.env.DATABASE_PATH ?? path.join(process.cwd(), 'todos.db');

// Reuse one connection across hot reloads in dev.
const globalForDb = globalThis as unknown as { __todoDb?: Database.Database };
const db = globalForDb.__todoDb ?? new Database(DB_PATH);
globalForDb.__todoDb = db;

// Wait instead of failing when another process (e.g. parallel `next build` workers that
// each load this module) holds the lock while creating the schema.
db.pragma('busy_timeout = 5000');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    due_date TEXT,
    priority TEXT NOT NULL DEFAULT 'medium',
    is_recurring INTEGER NOT NULL DEFAULT 0,
    recurrence_pattern TEXT,
    reminder_minutes INTEGER,
    last_notification_sent TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_todos_user_id ON todos(user_id);
  CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date);

  CREATE TABLE IF NOT EXISTS authenticators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id TEXT UNIQUE NOT NULL,
    credential_public_key BLOB NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_authenticators_user_id ON authenticators(user_id);

  CREATE TABLE IF NOT EXISTS subtasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_subtasks_todo_id ON subtasks(todo_id);

  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#3B82F6',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, name)
  );

  CREATE TABLE IF NOT EXISTS todo_tags (
    todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (todo_id, tag_id)
  );
  CREATE INDEX IF NOT EXISTS idx_todo_tags_tag_id ON todo_tags(tag_id);

  CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT,
    title_template TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'medium',
    is_recurring INTEGER NOT NULL DEFAULT 0,
    recurrence_pattern TEXT,
    reminder_minutes INTEGER,
    due_date_offset_minutes INTEGER,
    subtasks_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS holidays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date);
`);

export { db };

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

interface TodoRow {
  id: number;
  user_id: number;
  title: string;
  completed: number;
  due_date: string | null;
  priority: string;
  is_recurring: number;
  recurrence_pattern: string | null;
  reminder_minutes: number | null;
  last_notification_sent: string | null;
  created_at: string;
  updated_at: string | null;
}

// SQLite's datetime('now') yields "YYYY-MM-DD HH:MM:SS" in UTC; normalize to ISO.
function sqliteToISO(value: string | null): string | null {
  if (!value) return value;
  return value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
}

function mapTodo(row: TodoRow): Todo {
  return {
    id: row.id,
    user_id: row.user_id,
    title: row.title,
    completed: row.completed === 1,
    due_date: row.due_date,
    priority: row.priority as Priority,
    is_recurring: row.is_recurring === 1,
    recurrence_pattern: (row.recurrence_pattern as RecurrencePattern | null) ?? null,
    reminder_minutes: row.reminder_minutes ?? null,
    last_notification_sent: row.last_notification_sent ?? null,
    created_at: sqliteToISO(row.created_at)!,
    updated_at: sqliteToISO(row.updated_at),
  };
}

interface SubtaskRow {
  id: number;
  todo_id: number;
  title: string;
  completed: number;
  position: number;
  created_at: string;
}

function mapSubtask(row: SubtaskRow): Subtask {
  return { ...row, completed: row.completed === 1, created_at: sqliteToISO(row.created_at)! };
}

/** Loads subtasks (by position) and tags (by name) for the given todos in two queries. */
function attachRelations(todos: Todo[]): Todo[] {
  if (todos.length === 0) return todos;
  const ids = todos.map((t) => t.id);
  const placeholders = ids.map(() => '?').join(',');

  const subtasks = db
    .prepare(`SELECT * FROM subtasks WHERE todo_id IN (${placeholders}) ORDER BY position, id`)
    .all(...ids) as SubtaskRow[];
  const tags = db
    .prepare(
      `SELECT tt.todo_id, t.* FROM todo_tags tt JOIN tags t ON t.id = tt.tag_id
       WHERE tt.todo_id IN (${placeholders}) ORDER BY t.name COLLATE NOCASE`
    )
    .all(...ids) as (Tag & { todo_id: number })[];

  const byTodo = new Map(todos.map((t) => [t.id, { ...t, subtasks: [] as Subtask[], tags: [] as Tag[] }]));
  for (const s of subtasks) byTodo.get(s.todo_id)!.subtasks.push(mapSubtask(s));
  for (const { todo_id, ...tag } of tags) {
    byTodo.get(todo_id)!.tags.push({ ...tag, created_at: sqliteToISO(tag.created_at)! });
  }
  return todos.map((t) => byTodo.get(t.id)!);
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const userDB = {
  findById(id: number): User | undefined {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
  },
  findByUsername(username: string): User | undefined {
    return db.prepare('SELECT * FROM users WHERE username = ?').get(username) as User | undefined;
  },
  create(username: string): User {
    const info = db.prepare('INSERT INTO users (username) VALUES (?)').run(username);
    return this.findById(Number(info.lastInsertRowid))!;
  },
};

// ---------------------------------------------------------------------------
// Authenticators (WebAuthn credentials; a user may have several)
// ---------------------------------------------------------------------------

export interface NewAuthenticator {
  credential_id: string;
  credential_public_key: Uint8Array;
  counter?: number;
  transports?: string[];
}

export const authenticatorDB = {
  findByCredentialId(credentialId: string): Authenticator | undefined {
    return db.prepare('SELECT * FROM authenticators WHERE credential_id = ?').get(credentialId) as
      | Authenticator
      | undefined;
  },
  findByUserId(userId: number): Authenticator[] {
    return db.prepare('SELECT * FROM authenticators WHERE user_id = ? ORDER BY id').all(userId) as Authenticator[];
  },
  create(input: NewAuthenticator & { user_id: number }): void {
    db.prepare(
      `INSERT INTO authenticators (user_id, credential_id, credential_public_key, counter, transports)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      input.user_id,
      input.credential_id,
      Buffer.from(input.credential_public_key),
      input.counter ?? 0,
      input.transports?.length ? JSON.stringify(input.transports) : null
    );
  },
  updateCounter(id: number, counter: number | undefined): void {
    db.prepare('UPDATE authenticators SET counter = ? WHERE id = ?').run(counter ?? 0, id);
  },
};

/** Creates a user and their first authenticator atomically. */
export const registerUserWithAuthenticator = db.transaction(
  (username: string, credential: NewAuthenticator): User => {
    const user = userDB.create(username);
    authenticatorDB.create({ ...credential, user_id: user.id });
    return user;
  }
);

// ---------------------------------------------------------------------------
// Tags (per-user; todo_tags rows cascade when either side is deleted)
// ---------------------------------------------------------------------------

export class DuplicateTagError extends Error {
  constructor() {
    super('A tag with this name already exists');
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === 'SQLITE_CONSTRAINT_UNIQUE';
}

function mapTag(row: Tag): Tag {
  return { ...row, created_at: sqliteToISO(row.created_at)! };
}

export const tagDB = {
  findAllByUser(userId: number): Tag[] {
    return (db.prepare('SELECT * FROM tags WHERE user_id = ? ORDER BY name COLLATE NOCASE').all(userId) as Tag[]).map(mapTag);
  },

  findById(id: number, userId: number): Tag | undefined {
    const row = db.prepare('SELECT * FROM tags WHERE id = ? AND user_id = ?').get(id, userId) as Tag | undefined;
    return row ? mapTag(row) : undefined;
  },

  /** Case-insensitive lookup, used by import to reuse existing tags. */
  findByName(userId: number, name: string): Tag | undefined {
    const row = db
      .prepare('SELECT * FROM tags WHERE user_id = ? AND name = ? COLLATE NOCASE')
      .get(userId, name) as Tag | undefined;
    return row ? mapTag(row) : undefined;
  },

  /** @throws DuplicateTagError when the user already has a tag with this name. */
  create(userId: number, input: { name: string; color?: string }): Tag {
    try {
      const info = db
        .prepare('INSERT INTO tags (user_id, name, color) VALUES (?, ?, ?)')
        .run(userId, input.name, input.color ?? DEFAULT_TAG_COLOR);
      return this.findById(Number(info.lastInsertRowid), userId)!;
    } catch (err) {
      if (isUniqueViolation(err)) throw new DuplicateTagError();
      throw err;
    }
  },

  /** @throws DuplicateTagError when renaming onto an existing name. */
  update(id: number, userId: number, input: { name?: string; color?: string }): Tag | undefined {
    try {
      if (input.name !== undefined) {
        db.prepare('UPDATE tags SET name = ? WHERE id = ? AND user_id = ?').run(input.name, id, userId);
      }
      if (input.color !== undefined) {
        db.prepare('UPDATE tags SET color = ? WHERE id = ? AND user_id = ?').run(input.color, id, userId);
      }
    } catch (err) {
      if (isUniqueViolation(err)) throw new DuplicateTagError();
      throw err;
    }
    return this.findById(id, userId);
  },

  delete(id: number, userId: number): void {
    db.prepare('DELETE FROM tags WHERE id = ? AND user_id = ?').run(id, userId);
  },

  /** Idempotent: attaching an already-attached tag is a no-op. */
  attachToTodo(todoId: number, tagId: number): void {
    db.prepare('INSERT OR IGNORE INTO todo_tags (todo_id, tag_id) VALUES (?, ?)').run(todoId, tagId);
  },

  /** Idempotent: detaching a tag that isn't attached is a no-op. */
  detachFromTodo(todoId: number, tagId: number): void {
    db.prepare('DELETE FROM todo_tags WHERE todo_id = ? AND tag_id = ?').run(todoId, tagId);
  },

  /** Replaces the todo's tag set. */
  setTodoTags: db.transaction((todoId: number, tagIds: number[]) => {
    db.prepare('DELETE FROM todo_tags WHERE todo_id = ?').run(todoId);
    for (const tagId of tagIds) tagDB.attachToTodo(todoId, tagId);
  }),

  /** True if every id is a tag owned by `userId`. */
  allOwned(tagIds: number[], userId: number): boolean {
    return tagIds.every((id) => this.findById(id, userId));
  },
};

// ---------------------------------------------------------------------------
// Templates (no tags, no concrete due date — only a relative offset)
// ---------------------------------------------------------------------------

interface TemplateRow extends Omit<Template, 'is_recurring' | 'priority' | 'recurrence_pattern'> {
  is_recurring: number;
  priority: string;
  recurrence_pattern: string | null;
}

export type TemplateInput = Omit<Template, 'id' | 'user_id' | 'created_at'>;

function mapTemplate(row: TemplateRow): Template {
  return {
    ...row,
    priority: row.priority as Priority,
    is_recurring: row.is_recurring === 1,
    recurrence_pattern: (row.recurrence_pattern as RecurrencePattern | null) ?? null,
    created_at: sqliteToISO(row.created_at)!,
  };
}

export const templateDB = {
  findAllByUser(userId: number): Template[] {
    const rows = db
      .prepare('SELECT * FROM templates WHERE user_id = ? ORDER BY name COLLATE NOCASE, id')
      .all(userId) as TemplateRow[];
    return rows.map(mapTemplate);
  },

  findById(id: number, userId: number): Template | undefined {
    const row = db.prepare('SELECT * FROM templates WHERE id = ? AND user_id = ?').get(id, userId) as
      | TemplateRow
      | undefined;
    return row ? mapTemplate(row) : undefined;
  },

  create(userId: number, input: TemplateInput): Template {
    const info = db
      .prepare(
        `INSERT INTO templates (user_id, name, description, category, title_template, priority, is_recurring,
           recurrence_pattern, reminder_minutes, due_date_offset_minutes, subtasks_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        userId,
        input.name,
        input.description,
        input.category,
        input.title_template,
        input.priority,
        input.is_recurring ? 1 : 0,
        input.recurrence_pattern,
        input.reminder_minutes,
        input.due_date_offset_minutes,
        input.subtasks_json
      );
    return this.findById(Number(info.lastInsertRowid), userId)!;
  },

  update(id: number, userId: number, input: TemplateInput): Template | undefined {
    db.prepare(
      `UPDATE templates SET name = ?, description = ?, category = ?, title_template = ?, priority = ?,
         is_recurring = ?, recurrence_pattern = ?, reminder_minutes = ?, due_date_offset_minutes = ?, subtasks_json = ?
       WHERE id = ? AND user_id = ?`
    ).run(
      input.name,
      input.description,
      input.category,
      input.title_template,
      input.priority,
      input.is_recurring ? 1 : 0,
      input.recurrence_pattern,
      input.reminder_minutes,
      input.due_date_offset_minutes,
      input.subtasks_json,
      id,
      userId
    );
    return this.findById(id, userId);
  },

  delete(id: number, userId: number): void {
    db.prepare('DELETE FROM templates WHERE id = ? AND user_id = ?').run(id, userId);
  },
};

/** Creates a todo plus its subtasks in one transaction (template "use", import). */
export const createTodoWithSubtasks = db.transaction(
  (input: CreateTodoInput & { user_id: number }, subtasks: { title: string; completed?: boolean }[]): Todo => {
    const todo = todoDB.create(input);
    for (const s of subtasks) subtaskDB.create(todo.id, s.title, s.completed ?? false);
    return todoDB.findById(todo.id)!;
  }
);

/**
 * Imports todos with their subtasks and tags in ONE transaction (all or nothing). Always
 * creates new rows with new ids; never merges. Tags are matched case-insensitively and an
 * existing tag keeps its own color.
 */
export const importTodos = db.transaction(
  (
    userId: number,
    items: {
      title: string;
      completed: boolean;
      due_date: string | null;
      priority: string;
      is_recurring: boolean;
      recurrence_pattern: string | null;
      reminder_minutes: number | null;
      subtasks: { title: string; completed: boolean; position: number }[];
      tags: { name: string; color: string }[];
    }[]
  ): { imported: number; tagsCreated: number; tagsReused: number } => {
    let tagsCreated = 0;
    let tagsReused = 0;
    for (const item of items) {
      const todo = todoDB.create({
        user_id: userId,
        title: item.title.trim(),
        due_date: item.due_date ? toSingaporeISO(new Date(item.due_date)) : null,
        priority: item.priority as Priority,
        is_recurring: item.is_recurring,
        recurrence_pattern: item.is_recurring ? (item.recurrence_pattern as RecurrencePattern) : null,
        reminder_minutes: item.reminder_minutes,
      });
      if (item.completed) db.prepare('UPDATE todos SET completed = 1 WHERE id = ?').run(todo.id);

      // Positions are re-normalized to file order (gaps/duplicates in the file aren't trusted).
      [...item.subtasks]
        .sort((a, b) => a.position - b.position)
        .forEach((s) => subtaskDB.create(todo.id, s.title.trim(), s.completed));

      for (const t of item.tags) {
        const name = t.name.trim();
        let tag = tagDB.findByName(userId, name);
        if (tag) {
          tagsReused++;
        } else {
          tag = tagDB.create(userId, { name, color: t.color.toUpperCase() });
          tagsCreated++;
        }
        tagDB.attachToTodo(todo.id, tag.id);
      }
    }
    return { imported: items.length, tagsCreated, tagsReused };
  }
);

// ---------------------------------------------------------------------------
// Holidays (global, not user-scoped; dates are Singapore YYYY-MM-DD)
// ---------------------------------------------------------------------------

export const holidayDB = {
  findAll(): Holiday[] {
    return db.prepare('SELECT id, date, name FROM holidays ORDER BY date').all() as Holiday[];
  },

  /** Inclusive date range, YYYY-MM-DD strings compare correctly as text. */
  findBetween(from: string, to: string): Holiday[] {
    return db
      .prepare('SELECT id, date, name FROM holidays WHERE date BETWEEN ? AND ? ORDER BY date')
      .all(from, to) as Holiday[];
  },

  /** Inserts or renames the holiday on that date (idempotent seeding). */
  upsert(date: string, name: string): void {
    db.prepare('INSERT INTO holidays (date, name) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET name = excluded.name').run(
      date,
      name
    );
  },
};

// ---------------------------------------------------------------------------
// Subtasks
// ---------------------------------------------------------------------------

export const subtaskDB = {
  findById(id: number): Subtask | undefined {
    const row = db.prepare('SELECT * FROM subtasks WHERE id = ?').get(id) as SubtaskRow | undefined;
    return row ? mapSubtask(row) : undefined;
  },

  /** The subtask only if its parent todo belongs to `userId`. */
  findOwned(id: number, userId: number): Subtask | undefined {
    const row = db
      .prepare('SELECT s.* FROM subtasks s JOIN todos t ON t.id = s.todo_id WHERE s.id = ? AND t.user_id = ?')
      .get(id, userId) as SubtaskRow | undefined;
    return row ? mapSubtask(row) : undefined;
  },

  /** Appends at max(position) + 1; deletes never renumber, so gaps are expected. */
  create(todoId: number, title: string, completed = false): Subtask {
    const info = db
      .prepare(
        `INSERT INTO subtasks (todo_id, title, completed, position)
         VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM subtasks WHERE todo_id = ?))`
      )
      .run(todoId, title, completed ? 1 : 0, todoId);
    return this.findById(Number(info.lastInsertRowid))!;
  },

  update(id: number, input: { title?: string; completed?: boolean }): Subtask | undefined {
    if (input.title !== undefined) db.prepare('UPDATE subtasks SET title = ? WHERE id = ?').run(input.title, id);
    if (input.completed !== undefined) {
      db.prepare('UPDATE subtasks SET completed = ? WHERE id = ?').run(input.completed ? 1 : 0, id);
    }
    return this.findById(id);
  },

  delete(id: number): void {
    db.prepare('DELETE FROM subtasks WHERE id = ?').run(id);
  },
};

// ---------------------------------------------------------------------------
// Todos
// ---------------------------------------------------------------------------

export const todoDB = {
  findById(id: number): Todo | undefined {
    const row = db.prepare('SELECT * FROM todos WHERE id = ?').get(id) as TodoRow | undefined;
    return row ? attachRelations([mapTodo(row)])[0] : undefined;
  },

  /** Incomplete todos with a reminder that hasn't fired yet (window check happens in JS). */
  findPendingReminders(userId: number): Todo[] {
    const rows = db
      .prepare(
        `SELECT * FROM todos
         WHERE user_id = ? AND completed = 0 AND due_date IS NOT NULL
           AND reminder_minutes IS NOT NULL AND last_notification_sent IS NULL`
      )
      .all(userId) as TodoRow[];
    return rows.map(mapTodo);
  },

  /** Atomically marks a reminder as sent. Returns false if it was already claimed (e.g. by another tab). */
  claimReminder(id: number, userId: number): boolean {
    const info = db
      .prepare(
        'UPDATE todos SET last_notification_sent = ? WHERE id = ? AND user_id = ? AND last_notification_sent IS NULL'
      )
      .run(toSingaporeISO(getSingaporeNow()), id, userId);
    return info.changes === 1;
  },

  findAllByUser(userId: number): Todo[] {
    const rows = db
      .prepare('SELECT * FROM todos WHERE user_id = ? ORDER BY created_at DESC, id DESC')
      .all(userId) as TodoRow[];
    return attachRelations(rows.map(mapTodo));
  },

  create(input: CreateTodoInput & { user_id: number }): Todo {
    const info = db
      .prepare(
        `INSERT INTO todos (user_id, title, due_date, priority, is_recurring, recurrence_pattern, reminder_minutes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.user_id,
        input.title,
        input.due_date ?? null,
        input.priority ?? 'medium',
        input.is_recurring ? 1 : 0,
        input.recurrence_pattern ?? null,
        input.reminder_minutes ?? null
      );
    return this.findById(Number(info.lastInsertRowid))!;
  },

  update(id: number, input: UpdateTodoInput): Todo | undefined {
    const sets: string[] = [];
    const values: unknown[] = [];
    const set = (column: string, value: unknown) => {
      sets.push(`${column} = ?`);
      values.push(value);
    };

    if (input.title !== undefined) set('title', input.title);
    if (input.completed !== undefined) set('completed', input.completed ? 1 : 0);
    if (input.due_date !== undefined) set('due_date', input.due_date);
    if (input.priority !== undefined) set('priority', input.priority);
    if (input.is_recurring !== undefined) set('is_recurring', input.is_recurring ? 1 : 0);
    if (input.recurrence_pattern !== undefined) set('recurrence_pattern', input.recurrence_pattern);
    if (input.reminder_minutes !== undefined) set('reminder_minutes', input.reminder_minutes);
    if (input.last_notification_sent !== undefined) set('last_notification_sent', input.last_notification_sent);

    sets.push(`updated_at = ?`);
    values.push(toSingaporeISO(getSingaporeNow()));
    db.prepare(`UPDATE todos SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
    return this.findById(id);
  },

  delete(id: number): void {
    db.prepare('DELETE FROM todos WHERE id = ?').run(id);
  },

  /**
   * Marks a recurring todo complete and spawns its next instance (copying tags) in one
   * transaction. The `completed = 0` guard makes a duplicate submit a no-op: only the
   * request that actually flips false → true creates the next instance.
   */
  completeRecurring: db.transaction(
    (id: number, nextDueDate: string): { todo: Todo; nextInstance: Todo | null } => {
      const flipped = db
        .prepare('UPDATE todos SET completed = 1, updated_at = ? WHERE id = ? AND completed = 0')
        .run(toSingaporeISO(getSingaporeNow()), id);
      const current = todoDB.findById(id)!;
      if (flipped.changes === 0) return { todo: current, nextInstance: null };

      const next = todoDB.create({
        user_id: current.user_id,
        title: current.title,
        due_date: nextDueDate,
        priority: current.priority,
        is_recurring: true,
        recurrence_pattern: current.recurrence_pattern,
        reminder_minutes: current.reminder_minutes ?? null,
      });
      db.prepare('INSERT INTO todo_tags (todo_id, tag_id) SELECT ?, tag_id FROM todo_tags WHERE todo_id = ?').run(
        next.id,
        id
      );
      return { todo: current, nextInstance: todoDB.findById(next.id)! };
    }
  ),
};
