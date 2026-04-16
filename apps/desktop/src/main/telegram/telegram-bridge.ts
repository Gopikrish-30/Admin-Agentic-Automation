import { BrowserWindow } from 'electron';
import type {
  TaskConfig,
  TaskMessage,
  TaskResult,
  TaskStatus,
  TodoItem,
} from '@navigator_ai/agent-core';
import {
  createTaskId,
  createMessageId,
  validateTaskConfig,
  mapResultToStatus,
} from '@navigator_ai/agent-core';
import { getTaskManager } from '../opencode';
import { getStorage } from '../store/storage';
import {
  resolvePermission,
  resolveQuestion,
  setQuestionRequestListener,
  denyPendingRequestsForTask,
} from '../permission-api';
import type { TelegramBot } from './telegram-bot';
import { createPendingPairing } from './telegram-auth';
import {
  formatTaskStarted,
  formatTaskProgress,
  formatTaskComplete,
  formatTaskError,
  formatMessages,
  formatTodos,
  formatPermissionRequest,
  formatTaskList,
  formatQuestionRequest,
} from './telegram-formatter';

interface ActiveTelegramTask {
  taskId: string;
  chatId: number;
  statusMessageId?: number;
  lastUpdateTime: number;
}

const UPDATE_THROTTLE_MS = 2000; // Don't send Telegram updates more often than every 2s

export class TelegramBridge {
  private activeTasks = new Map<string, ActiveTelegramTask>();
  private bot: TelegramBot | null = null;
  /** Maps taskId → chatId for routing question requests */
  private taskChatMap = new Map<string, number>();

  setBot(bot: TelegramBot): void {
    this.bot = bot;
    // Register for question requests from the question API server
    setQuestionRequestListener((questionRequest) => {
      this.handleQuestionRequest(questionRequest);
    });
  }

  /**
   * Create a pending pairing request and notify all Electron windows.
   * Called by TelegramBot when a valid PIN is entered from Telegram.
   */
  requestPairingApproval(
    chatId: number,
    userId: number,
    username: string | undefined,
    firstName: string | undefined,
  ): void {
    const pending = createPendingPairing(chatId, userId, username, firstName);

    // Notify all Electron windows about the pending pairing request
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('telegram:pairing-request', {
          id: pending.id,
          chatId: pending.chatId,
          userId: pending.userId,
          username: pending.username,
          firstName: pending.firstName,
          requestedAt: new Date(pending.requestedAt).toISOString(),
          expiresAt: new Date(pending.expiresAt).toISOString(),
        });
      }
    }
  }

  async startTask(chatId: number, prompt: string): Promise<string> {
    const storage = getStorage();
    const taskManager = getTaskManager();

    if (!storage.hasReadyProvider()) {
      throw new Error(
        'No AI provider is configured. Please set up a provider in Admin settings first.',
      );
    }

    const config: TaskConfig = { prompt };
    const validatedConfig = validateTaskConfig(config);

    const activeModel = storage.getActiveProviderModel();
    const selectedModel = activeModel || storage.getSelectedModel();
    if (selectedModel?.model) {
      validatedConfig.modelId = selectedModel.model;
    }

    const taskId = createTaskId();

    const telegramTask: ActiveTelegramTask = {
      taskId,
      chatId,
      lastUpdateTime: 0,
    };
    this.activeTasks.set(taskId, telegramTask);
    this.taskChatMap.set(taskId, chatId);

    // Send initial message to Telegram
    const startMsg = formatTaskStarted(taskId, prompt);
    const sentMessage = await this.bot?.sendHtml(chatId, startMsg);
    if (sentMessage) {
      telegramTask.statusMessageId = sentMessage.message_id;
    }

    const callbacks = this.createTelegramCallbacks(taskId, chatId);

    const task = await taskManager.startTask(taskId, validatedConfig, callbacks);

    const initialUserMessage: TaskMessage = {
      id: createMessageId(),
      type: 'user',
      content: validatedConfig.prompt,
      timestamp: new Date().toISOString(),
    };
    task.messages = [initialUserMessage];

    storage.saveTask(task);

    // Also forward to any open Electron windows
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('task:status-change', { taskId, status: 'running' });
      }
    }

    return taskId;
  }

  async respondToPermission(requestId: string, allowed: boolean): Promise<void> {
    resolvePermission(requestId, allowed);
  }

  async respondToQuestion(
    requestId: string,
    response: { selectedOptions?: string[]; customText?: string; denied?: boolean },
  ): Promise<void> {
    resolveQuestion(requestId, response);
  }

  private handleQuestionRequest(questionRequest: {
    id: string;
    taskId: string;
    question?: string;
    header?: string;
    options?: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  }): void {
    // Find the chat associated with this task
    const chatId = this.taskChatMap.get(questionRequest.taskId);
    if (!chatId || !this.bot) {
      return;
    }

    const text = formatQuestionRequest(questionRequest.taskId, questionRequest);
    const hasOptions = questionRequest.options && questionRequest.options.length > 0;

    if (hasOptions) {
      void this.bot
        .sendQuestionRequest(
          chatId,
          text,
          questionRequest.id,
          questionRequest.options!,
          questionRequest.multiSelect ?? false,
        )
        .catch((err: unknown) => {
          console.warn('[TelegramBridge] Failed to send question request:', err);
        });
    } else {
      // Free-text question — send and wait for text reply
      void this.bot
        .sendQuestionRequest(chatId, text, questionRequest.id, [], false)
        .catch((err: unknown) => {
          console.warn('[TelegramBridge] Failed to send question request:', err);
        });
    }
  }

  async getTaskStatus(taskId: string): Promise<string> {
    const storage = getStorage();
    const task = storage.getTask(taskId);
    if (!task) {
      return 'Task not found.';
    }
    return formatTaskList([task]);
  }

  async getRecentTasks(): Promise<string> {
    const storage = getStorage();
    const tasks = storage.getTasks();
    return formatTaskList(tasks.slice(0, 10));
  }

  /**
   * Get the active task ID for a given chat, or null if none.
   */
  getActiveTaskForChat(chatId: number): string | null {
    for (const [taskId, mappedChatId] of this.taskChatMap.entries()) {
      if (mappedChatId === chatId && this.activeTasks.has(taskId)) {
        return taskId;
      }
    }
    return null;
  }

  async cancelTask(taskId: string): Promise<boolean> {
    const taskManager = getTaskManager();
    const storage = getStorage();

    // Deny any pending permission/question requests so the CLI unblocks
    denyPendingRequestsForTask(taskId);

    if (taskManager.isTaskQueued(taskId)) {
      taskManager.cancelQueuedTask(taskId);
      storage.updateTaskStatus(taskId, 'cancelled', new Date().toISOString());
      this.activeTasks.delete(taskId);
      this.taskChatMap.delete(taskId);
      return true;
    }

    if (taskManager.hasActiveTask(taskId)) {
      await taskManager.cancelTask(taskId);
      storage.updateTaskStatus(taskId, 'cancelled', new Date().toISOString());
      this.activeTasks.delete(taskId);
      this.taskChatMap.delete(taskId);
      return true;
    }

    return false;
  }

  /**
   * Find a task by partial ID (first 8 chars).
   */
  resolveTaskId(shortId: string): string | null {
    const storage = getStorage();
    const tasks = storage.getTasks();
    const match = tasks.find((t) => t.id.startsWith(shortId));
    return match?.id ?? null;
  }

  private createTelegramCallbacks(taskId: string, chatId: number) {
    const storage = getStorage();
    const taskManager = getTaskManager();

    return {
      onBatchedMessages: (messages: TaskMessage[]) => {
        for (const msg of messages) {
          storage.addTaskMessage(taskId, msg);
        }

        // Forward to Electron windows too
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send('task:update:batch', { taskId, messages });
          }
        }

        // Throttled Telegram update
        const telegramTask = this.activeTasks.get(taskId);
        if (!telegramTask || !this.bot) {
          return;
        }

        const now = Date.now();
        if (now - telegramTask.lastUpdateTime < UPDATE_THROTTLE_MS) {
          return;
        }
        telegramTask.lastUpdateTime = now;

        const formatted = formatMessages(messages);
        if (formatted) {
          void this.bot.sendHtml(chatId, formatted).catch((err: unknown) => {
            console.warn('[TelegramBridge] Failed to send message update:', err);
          });
        }
      },

      onProgress: (progress: { stage: string; message?: string }) => {
        const text = formatTaskProgress(progress.stage, progress.message);

        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send('task:progress', { taskId, ...progress });
          }
        }

        void this.bot?.sendHtml(chatId, text).catch((err: unknown) => {
          console.warn('[TelegramBridge] Failed to send progress:', err);
        });
      },

      onPermissionRequest: (request: unknown) => {
        // Forward to Electron windows
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send('permission:request', request);
          }
        }

        // Send permission request to Telegram with inline keyboard
        const req = request as {
          requestId: string;
          taskId: string;
          operationType: string;
          filePath?: string;
          reason?: string;
        };
        const text = formatPermissionRequest(taskId, req);
        void this.bot?.sendPermissionRequest(chatId, text, req.requestId).catch((err: unknown) => {
          console.warn('[TelegramBridge] Failed to send permission request:', err);
        });
      },

      onComplete: (result: TaskResult) => {
        // Forward to Electron windows
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send('task:update', { taskId, type: 'complete', result });
          }
        }

        const taskStatus = mapResultToStatus(result);
        storage.updateTaskStatus(taskId, taskStatus, new Date().toISOString());

        const sessionId = result.sessionId || taskManager.getSessionId(taskId);
        if (sessionId) {
          storage.updateTaskSessionId(taskId, sessionId);
        }

        if (result.status === 'success') {
          storage.clearTodosForTask(taskId);
        }

        const text = formatTaskComplete(taskId, result);
        void this.bot?.sendHtml(chatId, text).catch((err: unknown) => {
          console.warn('[TelegramBridge] Failed to send completion:', err);
        });

        this.activeTasks.delete(taskId);
        this.taskChatMap.delete(taskId);
      },

      onError: (error: Error) => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send('task:update', { taskId, type: 'error', error: error.message });
          }
        }

        storage.updateTaskStatus(taskId, 'failed', new Date().toISOString());

        const text = formatTaskError(taskId, error.message);
        void this.bot?.sendHtml(chatId, text).catch((err: unknown) => {
          console.warn('[TelegramBridge] Failed to send error:', err);
        });

        this.activeTasks.delete(taskId);
        this.taskChatMap.delete(taskId);
      },

      onDebug: (log: { type: string; message: string; data?: unknown }) => {
        if (storage.getDebugMode()) {
          for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) {
              win.webContents.send('debug:log', {
                taskId,
                timestamp: new Date().toISOString(),
                ...log,
              });
            }
          }
        }
      },

      onStatusChange: (status: TaskStatus) => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send('task:status-change', { taskId, status });
          }
        }
        storage.updateTaskStatus(taskId, status, new Date().toISOString());
      },

      onTodoUpdate: (todos: TodoItem[]) => {
        storage.saveTodosForTask(taskId, todos);
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send('todo:update', { taskId, todos });
          }
        }

        const text = formatTodos(taskId, todos);
        void this.bot?.sendHtml(chatId, text).catch((err: unknown) => {
          console.warn('[TelegramBridge] Failed to send todo update:', err);
        });
      },

      onAuthError: (error: { providerId: string; message: string }) => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send('auth:error', error);
          }
        }
      },

      onToolCallComplete: () => {
        // No special handling needed for Telegram
      },
    };
  }
}
