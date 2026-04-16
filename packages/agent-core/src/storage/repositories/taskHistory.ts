import type { Task, TaskMessage, TaskStatus, TaskAttachment } from '../../common/types/task.js';
import type { TodoItem } from '../../common/types/todo.js';
import { getDatabase } from '../database.js';
import { maskPii } from '../../utils/mask-pii.js';

export interface StoredTask {
  id: string;
  prompt: string;
  summary?: string;
  status: TaskStatus;
  messages: TaskMessage[];
  sessionId?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

interface TaskRow {
  id: string;
  prompt: string;
  summary: string | null;
  status: string;
  session_id: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface MessageRow {
  id: string;
  task_id: string;
  type: string;
  content: string;
  tool_name: string | null;
  tool_input: string | null;
  timestamp: string;
  sort_order: number;
}

interface AttachmentRow {
  id: number;
  message_id: string;
  type: string;
  data: string;
  label: string | null;
}

interface TodoRow {
  id: number;
  task_id: string;
  todo_id: string;
  content: string;
  status: string;
  priority: string;
  sort_order: number;
}

const MAX_HISTORY_ITEMS = 100;
const MOCK_ADMIN_PROMPT_PREFIX = 'You are executing a mock IT admin automation request against ';

function extractWrappedMockAdminUserRequest(content: string): string | null {
  if (!content.startsWith(MOCK_ADMIN_PROMPT_PREFIX)) {
    return null;
  }

  const match = content.match(/(?:\r?\n)User request:\s*([\s\S]*)$/i);
  if (!match?.[1]) {
    return null;
  }

  const extracted = match[1].trim();
  return extracted.length > 0 ? extracted : null;
}

function sanitizePromptForDisplay(prompt: string): string {
  return extractWrappedMockAdminUserRequest(prompt) ?? prompt;
}

function sanitizeUserMessageForDisplay(content: string): string {
  return extractWrappedMockAdminUserRequest(content) ?? content;
}

function getMessagesForTask(taskId: string): TaskMessage[] {
  const db = getDatabase();

  const messageRows = db
    .prepare('SELECT * FROM task_messages WHERE task_id = ? ORDER BY sort_order ASC')
    .all(taskId) as MessageRow[];

  const messages: TaskMessage[] = [];

  for (const row of messageRows) {
    const attachmentRows = db
      .prepare('SELECT * FROM task_attachments WHERE message_id = ?')
      .all(row.id) as AttachmentRow[];

    const attachments: TaskAttachment[] | undefined =
      attachmentRows.length > 0
        ? attachmentRows.map((a) => ({
            type: a.type as 'screenshot' | 'json',
            data: a.data,
            label: a.label || undefined,
          }))
        : undefined;

    let parsedToolInput: unknown;
    if (row.tool_input) {
      try {
        parsedToolInput = JSON.parse(row.tool_input);
      } catch {
        parsedToolInput = row.tool_input;
      }
    }

    messages.push({
      id: row.id,
      type: row.type as TaskMessage['type'],
      content: row.type === 'user' ? sanitizeUserMessageForDisplay(row.content) : row.content,
      toolName: row.tool_name || undefined,
      toolInput: parsedToolInput,
      timestamp: row.timestamp,
      attachments,
    });
  }

  return messages;
}

function rowToTask(row: TaskRow): StoredTask {
  return {
    id: row.id,
    prompt: sanitizePromptForDisplay(row.prompt),
    summary: row.summary || undefined,
    status: row.status as TaskStatus,
    sessionId: row.session_id || undefined,
    createdAt: row.created_at,
    startedAt: row.started_at || undefined,
    completedAt: row.completed_at || undefined,
    messages: getMessagesForTask(row.id),
  };
}

export function getTasks(): StoredTask[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?')
    .all(MAX_HISTORY_ITEMS) as TaskRow[];

  return rows.map(rowToTask);
}

export function getTask(taskId: string): StoredTask | undefined {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined;

  return row ? rowToTask(row) : undefined;
}

export function saveTask(task: Task): void {
  const db = getDatabase();

  db.transaction(() => {
    db.prepare(
      `INSERT OR REPLACE INTO tasks
        (id, prompt, summary, status, session_id, created_at, started_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      task.id,
      maskPii(task.prompt),
      task.summary ? maskPii(task.summary) : null,
      task.status,
      task.sessionId || null,
      task.createdAt,
      task.startedAt || null,
      task.completedAt || null,
    );

    db.prepare('DELETE FROM task_messages WHERE task_id = ?').run(task.id);

    const insertMessage = db.prepare(
      `INSERT INTO task_messages
        (id, task_id, type, content, tool_name, tool_input, timestamp, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const insertAttachment = db.prepare(
      `INSERT INTO task_attachments (message_id, type, data, label) VALUES (?, ?, ?, ?)`,
    );

    let sortOrder = 0;
    for (const msg of task.messages || []) {
      insertMessage.run(
        msg.id,
        task.id,
        msg.type,
        maskPii(msg.content),
        msg.toolName || null,
        msg.toolInput ? maskPii(JSON.stringify(msg.toolInput)) : null,
        msg.timestamp,
        sortOrder++,
      );

      if (msg.attachments) {
        for (const att of msg.attachments) {
          insertAttachment.run(msg.id, att.type, att.data, att.label || null);
        }
      }
    }

    db.prepare(
      `DELETE FROM tasks WHERE id NOT IN (
        SELECT id FROM tasks ORDER BY created_at DESC LIMIT ?
      )`,
    ).run(MAX_HISTORY_ITEMS);
  })();
}

export function updateTaskStatus(taskId: string, status: TaskStatus, completedAt?: string): void {
  const db = getDatabase();

  if (completedAt) {
    db.prepare('UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?').run(
      status,
      completedAt,
      taskId,
    );
  } else {
    db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(status, taskId);
  }
}

export function addTaskMessage(taskId: string, message: TaskMessage): void {
  const db = getDatabase();

  db.transaction(() => {
    const maxOrder = db
      .prepare('SELECT MAX(sort_order) as max FROM task_messages WHERE task_id = ?')
      .get(taskId) as { max: number | null };

    const sortOrder = (maxOrder.max ?? -1) + 1;

    db.prepare(
      `INSERT INTO task_messages
        (id, task_id, type, content, tool_name, tool_input, timestamp, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      message.id,
      taskId,
      message.type,
      maskPii(message.content),
      message.toolName || null,
      message.toolInput ? maskPii(JSON.stringify(message.toolInput)) : null,
      message.timestamp,
      sortOrder,
    );

    if (message.attachments) {
      const insertAttachment = db.prepare(
        `INSERT INTO task_attachments (message_id, type, data, label) VALUES (?, ?, ?, ?)`,
      );

      for (const att of message.attachments) {
        insertAttachment.run(message.id, att.type, att.data, att.label || null);
      }
    }
  })();
}

export function updateTaskSessionId(taskId: string, sessionId: string): void {
  const db = getDatabase();
  db.prepare('UPDATE tasks SET session_id = ? WHERE id = ?').run(sessionId, taskId);
}

export function updateTaskSummary(taskId: string, summary: string): void {
  const db = getDatabase();
  db.prepare('UPDATE tasks SET summary = ? WHERE id = ?').run(maskPii(summary), taskId);
}

export function deleteTask(taskId: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
}

export function clearHistory(): void {
  const db = getDatabase();
  db.prepare('DELETE FROM tasks').run();
}

export function setMaxHistoryItems(_max: number): void {}

export function clearTaskHistoryStore(): void {
  clearHistory();
}

export function sanitizeLegacyMockAdminPromptsInHistory(): number {
  const db = getDatabase();

  const taskRows = db
    .prepare('SELECT id, prompt FROM tasks WHERE prompt LIKE ?')
    .all(`${MOCK_ADMIN_PROMPT_PREFIX}%`) as Array<{ id: string; prompt: string }>;

  const messageRows = db
    .prepare("SELECT id, content FROM task_messages WHERE type = 'user' AND content LIKE ?")
    .all(`${MOCK_ADMIN_PROMPT_PREFIX}%`) as Array<{ id: string; content: string }>;

  if (taskRows.length === 0 && messageRows.length === 0) {
    return 0;
  }

  const updateTaskPrompt = db.prepare('UPDATE tasks SET prompt = ? WHERE id = ?');
  const updateMessageContent = db.prepare('UPDATE task_messages SET content = ? WHERE id = ?');

  let updated = 0;

  db.transaction(() => {
    for (const row of taskRows) {
      const sanitized = sanitizePromptForDisplay(row.prompt);
      if (sanitized !== row.prompt) {
        updateTaskPrompt.run(maskPii(sanitized), row.id);
        updated += 1;
      }
    }

    for (const row of messageRows) {
      const sanitized = sanitizeUserMessageForDisplay(row.content);
      if (sanitized !== row.content) {
        updateMessageContent.run(maskPii(sanitized), row.id);
        updated += 1;
      }
    }
  })();

  return updated;
}

export function flushPendingTasks(): void {}

export function getTodosForTask(taskId: string): TodoItem[] {
  const db = getDatabase();

  const rows = db
    .prepare('SELECT * FROM task_todos WHERE task_id = ? ORDER BY sort_order ASC')
    .all(taskId) as TodoRow[];

  return rows.map((row) => ({
    id: row.todo_id,
    content: row.content,
    status: row.status as TodoItem['status'],
    priority: row.priority as TodoItem['priority'],
  }));
}

export function saveTodosForTask(taskId: string, todos: TodoItem[]): void {
  const db = getDatabase();

  db.transaction(() => {
    db.prepare('DELETE FROM task_todos WHERE task_id = ?').run(taskId);

    const insert = db.prepare(
      `INSERT INTO task_todos (task_id, todo_id, content, status, priority, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    todos.forEach((todo, index) => {
      insert.run(taskId, todo.id, todo.content, todo.status, todo.priority, index);
    });
  })();
}

export function clearTodosForTask(taskId: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM task_todos WHERE task_id = ?').run(taskId);
}
