import type { TaskMessage, TaskResult, TodoItem } from '@navigator_ai/agent-core';

const MAX_TELEGRAM_LENGTH = 4000; // Telegram max is 4096, leave room for formatting

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 3) + '...';
}

export function formatTaskStarted(taskId: string, prompt: string): string {
  const shortId = taskId.slice(0, 8);
  return (
    '🚀 <b>Task Started</b>\n' +
    '━━━━━━━━━━━━━━━\n' +
    `🆔 <code>${shortId}</code>\n\n` +
    `📋 ${escapeHtml(truncate(prompt, 500))}\n` +
    '━━━━━━━━━━━━━━━'
  );
}

export function formatTaskProgress(stage: string, message?: string): string {
  const icon = stage === 'complete' ? '✅' : '⏳';
  let text = `${icon} ${escapeHtml(stage)}`;
  if (message) {
    text += `: ${escapeHtml(truncate(message, 200))}`;
  }
  return text;
}

export function formatTaskComplete(taskId: string, result: TaskResult): string {
  const shortId = taskId.slice(0, 8);
  const icon = result.status === 'success' ? '✅' : '❌';
  const statusText = result.status === 'success' ? 'Completed' : 'Failed';

  let text = `${icon} <b>Task ${statusText}</b>\n`;
  text += '━━━━━━━━━━━━━━━\n';
  text += `🆔 <code>${shortId}</code>`;

  if (result.durationMs) {
    const seconds = Math.round(result.durationMs / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const duration = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    text += `  ⏱ ${duration}`;
  }

  if (result.error) {
    text += `\n\n⚠️ <b>Error:</b>\n<blockquote>${escapeHtml(truncate(result.error, 400))}</blockquote>`;
  }

  text += '\n━━━━━━━━━━━━━━━';

  return truncate(text, MAX_TELEGRAM_LENGTH);
}

export function formatTaskError(taskId: string, error: string): string {
  const shortId = taskId.slice(0, 8);
  return (
    '❌ <b>Task Failed</b>\n' +
    '━━━━━━━━━━━━━━━\n' +
    `🆔 <code>${shortId}</code>\n\n` +
    `⚠️ <blockquote>${escapeHtml(truncate(error, 400))}</blockquote>\n` +
    '━━━━━━━━━━━━━━━'
  );
}

export function formatMessages(messages: TaskMessage[]): string {
  const parts: string[] = [];

  for (const msg of messages) {
    if (msg.type === 'assistant' && msg.content) {
      parts.push(`💬 ${escapeHtml(msg.content)}`);
    } else if (msg.type === 'tool' && msg.toolName) {
      parts.push(`🔧 <code>${escapeHtml(msg.toolName)}</code>`);
    }
  }

  if (parts.length === 0) {
    return '';
  }

  const combined = parts.join('\n\n');
  return truncate(combined, MAX_TELEGRAM_LENGTH);
}

export function formatTaskList(
  tasks: Array<{ id: string; prompt: string; status: string; summary?: string }>,
): string {
  if (tasks.length === 0) {
    return '📭 No tasks found.';
  }

  const lines = tasks.slice(0, 10).map((task) => {
    const shortId = task.id.slice(0, 8);
    const icon = task.status === 'completed' ? '✅' : task.status === 'running' ? '🔄' : '⏸';
    const label = task.summary || truncate(task.prompt, 50);
    return `${icon} <code>${shortId}</code>  ${escapeHtml(label)}`;
  });

  return (
    '📋 <b>Recent Tasks</b>\n' + '━━━━━━━━━━━━━━━\n' + lines.join('\n') + '\n━━━━━━━━━━━━━━━'
  );
}

export function formatTodos(taskId: string, todos: TodoItem[]): string {
  const shortId = taskId.slice(0, 8);
  if (todos.length === 0) {
    return `📝 <b>Todos</b> <code>${shortId}</code>: None`;
  }

  const lines = todos.map((todo) => {
    const icon = todo.status === 'completed' ? '✅' : todo.status === 'in_progress' ? '🔄' : '⬜';
    return `  ${icon} ${escapeHtml(todo.content)}`;
  });

  return truncate(
    '📝 <b>Todos</b>\n' +
      '━━━━━━━━━━━━━━━\n' +
      `🆔 <code>${shortId}</code>\n\n` +
      lines.join('\n') +
      '\n━━━━━━━━━━━━━━━',
    MAX_TELEGRAM_LENGTH,
  );
}

export function formatPermissionRequest(
  taskId: string,
  request: { operationType: string; filePath?: string; reason?: string },
): string {
  const shortId = taskId.slice(0, 8);
  let text =
    '🔐 <b>Permission Request</b>\n' +
    '━━━━━━━━━━━━━━━\n' +
    `🆔 <code>${shortId}</code>\n\n` +
    `📁 <b>Operation:</b> ${escapeHtml(request.operationType)}\n`;

  if (request.filePath) {
    text += `📄 <b>Path:</b> <code>${escapeHtml(request.filePath)}</code>\n`;
  }
  if (request.reason) {
    text += `\n💬 ${escapeHtml(truncate(request.reason, 300))}\n`;
  }

  text += '━━━━━━━━━━━━━━━';
  return text;
}

export function formatWelcome(): string {
  return (
    '🤖 <b>Admin Bot</b>\n' +
    '━━━━━━━━━━━━━━━\n\n' +
    "Send me any prompt and I'll run it as a task.\n\n" +
    '<b>Commands:</b>\n' +
    '  /task &lt;prompt&gt; — Start a new task\n' +
    '  /status — List recent tasks\n' +
    '  /stop — Stop the current running task\n' +
    '  /cancel &lt;id&gt; — Cancel a task by ID\n' +
    '  /help — Show help\n' +
    '━━━━━━━━━━━━━━━'
  );
}

export function formatHelp(): string {
  return (
    '📖 <b>Admin Bot Help</b>\n' +
    '━━━━━━━━━━━━━━━\n\n' +
    '<b>Commands:</b>\n' +
    '  /task &lt;prompt&gt; — Start a new task with the given prompt\n' +
    '  /status — Show recent tasks and their status\n' +
    '  /status &lt;id&gt; — Get details of a specific task\n' +
    '  /stop — Stop the current running task\n' +
    '  /cancel &lt;id&gt; — Cancel a task by ID\n' +
    '  /help — Show this help message\n\n' +
    '💡 <b>Tip:</b> You can also just send a plain text message to start a task!\n' +
    '━━━━━━━━━━━━━━━'
  );
}

export function formatQuestionRequest(
  taskId: string,
  request: {
    question?: string;
    header?: string;
    options?: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  },
): string {
  const shortId = taskId.slice(0, 8);
  let text = `❓ <b>Question</b> <code>${shortId}</code>\n`;
  text += '━━━━━━━━━━━━━━━\n';

  if (request.header) {
    text += `\n<b>${escapeHtml(request.header)}</b>\n`;
  }

  if (request.question) {
    text += `\n${escapeHtml(request.question)}\n`;
  }

  if (request.options && request.options.length > 0) {
    text += '\n';
    for (let i = 0; i < request.options.length; i++) {
      const opt = request.options[i];
      text += `  <b>${i + 1}.</b> ${escapeHtml(opt.label)}`;
      if (opt.description) {
        text += `\n      <i>${escapeHtml(opt.description)}</i>`;
      }
      text += '\n';
    }
    if (request.multiSelect) {
      text += '\n<i>ℹ️ Tap options to toggle, then press Submit.</i>';
    } else {
      text += '\n<i>ℹ️ Tap an option below to respond.</i>';
    }
  } else {
    text += '\n💬 <i>Type your answer and send it as a reply.</i>';
  }

  text += '\n━━━━━━━━━━━━━━━';

  return truncate(text, MAX_TELEGRAM_LENGTH);
}
