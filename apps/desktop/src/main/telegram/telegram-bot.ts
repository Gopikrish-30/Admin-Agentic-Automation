import { Bot, InlineKeyboard } from 'grammy';
import type { Context } from 'grammy';
import type { TelegramBridge } from './telegram-bridge';
import { validatePairingPin, isSessionValid, touchSession } from './telegram-auth';
import { formatWelcome, formatHelp } from './telegram-formatter';
import type { TelegramPairing } from './telegram-auth';

export class TelegramBot {
  private bot: Bot;
  private bridge: TelegramBridge;
  private pairing: TelegramPairing | null;
  private onPairingChange: (pairing: TelegramPairing | null) => void;
  private isRunning = false;
  /** Pending question per chat (only one at a time) */
  private pendingQuestions = new Map<
    number,
    {
      requestId: string;
      options: Array<{ label: string; description?: string }>;
      multiSelect: boolean;
      selectedOptions: Set<string>;
      messageId: number;
    }
  >();

  constructor(
    token: string,
    bridge: TelegramBridge,
    pairing: TelegramPairing | null,
    onPairingChange: (pairing: TelegramPairing | null) => void,
  ) {
    // Use native fetch instead of Grammy's default node-fetch (node-fetch fails in Electron main process)
    this.bot = new Bot(token, { client: { fetch: globalThis.fetch } });
    this.bridge = bridge;
    this.pairing = pairing;
    this.onPairingChange = onPairingChange;

    bridge.setBot(this);
    this.registerHandlers();
  }

  private isAuthorized(ctx: Context): boolean {
    if (!this.pairing) {
      return false;
    }
    if (ctx.chat?.id !== this.pairing.chatId) {
      return false;
    }
    if (!isSessionValid(this.pairing)) {
      return false;
    }
    // Update last active timestamp
    this.pairing = touchSession(this.pairing);
    this.onPairingChange(this.pairing);
    return true;
  }

  private registerHandlers(): void {
    // /start — welcome or pairing
    this.bot.command('start', async (ctx) => {
      const args = ctx.match?.trim();

      // If already paired to this chat, show welcome
      if (this.isAuthorized(ctx)) {
        await ctx.reply(formatWelcome(), { parse_mode: 'HTML' });
        return;
      }

      // Try pairing with PIN — requires desktop-side approval
      if (args) {
        const pinResult = validatePairingPin(args);

        if (pinResult === 'rate_limited') {
          await ctx.reply(
            '🚫 <b>Too many failed attempts.</b>\n\n' +
              'Pairing is temporarily locked. Please try again later.',
            { parse_mode: 'HTML' },
          );
          return;
        }

        if (pinResult === 'valid') {
          // PIN is correct — create pending pairing request for desktop approval
          const chatId = ctx.chat.id;
          const userId = ctx.from?.id ?? 0;
          const username = ctx.from?.username;
          const firstName = ctx.from?.first_name;

          this.bridge.requestPairingApproval(chatId, userId, username, firstName);

          await ctx.reply(
            '⏳ <b>Pairing request sent!</b>\n\n' +
              'Please approve this pairing on your Admin desktop app.\n' +
              'The request will expire in 2 minutes.',
            { parse_mode: 'HTML' },
          );
          return;
        }

        // Invalid PIN
        await ctx.reply(
          '❌ <b>Invalid or expired PIN.</b>\n\n' +
            'Please check the PIN in Admin Settings and try again.',
          { parse_mode: 'HTML' },
        );
        return;
      }

      // Not paired — show instructions
      await ctx.reply(
        '🔑 <b>Pairing Required</b>\n\n' +
          'To link this bot to your Admin app:\n' +
          '1. Open Admin Settings → Telegram\n' +
          '2. Click "Generate Pairing PIN"\n' +
          '3. Scan the QR code or send: <code>/start YOUR_PIN</code>\n' +
          '4. <b>Approve the pairing</b> on your desktop app',
        { parse_mode: 'HTML' },
      );
    });

    // /help
    this.bot.command('help', async (ctx) => {
      if (!this.isAuthorized(ctx)) {
        await ctx.reply('🔑 Please pair first. Send /start for instructions.');
        return;
      }
      await ctx.reply(formatHelp(), { parse_mode: 'HTML' });
    });

    // /task <prompt>
    this.bot.command('task', async (ctx) => {
      if (!this.isAuthorized(ctx)) {
        await ctx.reply('🔑 Please pair first. Send /start for instructions.');
        return;
      }

      const prompt = ctx.match?.trim();
      if (!prompt) {
        await ctx.reply(
          '❌ Please provide a prompt. Example: <code>/task Build a REST API</code>',
          {
            parse_mode: 'HTML',
          },
        );
        return;
      }

      try {
        await this.bridge.startTask(ctx.chat.id, prompt);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        await ctx.reply(`❌ Failed to start task: ${message}`);
      }
    });

    // /status [taskId]
    this.bot.command('status', async (ctx) => {
      if (!this.isAuthorized(ctx)) {
        await ctx.reply('🔑 Please pair first. Send /start for instructions.');
        return;
      }

      const shortId = ctx.match?.trim();
      if (shortId) {
        const fullId = this.bridge.resolveTaskId(shortId);
        if (!fullId) {
          await ctx.reply(`❌ Task not found: <code>${shortId}</code>`, { parse_mode: 'HTML' });
          return;
        }
        const status = await this.bridge.getTaskStatus(fullId);
        await ctx.reply(status, { parse_mode: 'HTML' });
      } else {
        const status = await this.bridge.getRecentTasks();
        await ctx.reply(status, { parse_mode: 'HTML' });
      }
    });

    // /cancel [taskId] — cancel running task (current if no ID given)
    this.bot.command('cancel', async (ctx) => {
      if (!this.isAuthorized(ctx)) {
        await ctx.reply('🔑 Please pair first. Send /start for instructions.');
        return;
      }

      const shortId = ctx.match?.trim();

      // No task ID: cancel the active task for this chat
      if (!shortId) {
        const chatId = ctx.chat.id;
        const activeTaskId = this.bridge.getActiveTaskForChat(chatId);
        if (!activeTaskId) {
          await ctx.reply('ℹ️ No running task to cancel.', { parse_mode: 'HTML' });
          return;
        }
        // Clean up any pending question for this chat
        this.pendingQuestions.delete(chatId);
        const cancelled = await this.bridge.cancelTask(activeTaskId);
        if (cancelled) {
          await ctx.reply(`✅ Task <code>${activeTaskId.slice(0, 8)}</code> cancelled.`, {
            parse_mode: 'HTML',
          });
        } else {
          await ctx.reply('⚠️ Task could not be cancelled.', { parse_mode: 'HTML' });
        }
        return;
      }

      const fullId = this.bridge.resolveTaskId(shortId);
      if (!fullId) {
        await ctx.reply(`❌ Task not found: <code>${shortId}</code>`, { parse_mode: 'HTML' });
        return;
      }

      // Clean up any pending question for this chat
      this.pendingQuestions.delete(ctx.chat.id);

      const cancelled = await this.bridge.cancelTask(fullId);
      if (cancelled) {
        await ctx.reply(`✅ Task <code>${shortId}</code> cancelled.`, { parse_mode: 'HTML' });
      } else {
        await ctx.reply(`⚠️ Task <code>${shortId}</code> is not running or queued.`, {
          parse_mode: 'HTML',
        });
      }
    });

    // /stop — alias for /cancel (no ID)
    this.bot.command('stop', async (ctx) => {
      if (!this.isAuthorized(ctx)) {
        await ctx.reply('🔑 Please pair first. Send /start for instructions.');
        return;
      }

      const chatId = ctx.chat.id;
      const activeTaskId = this.bridge.getActiveTaskForChat(chatId);
      if (!activeTaskId) {
        await ctx.reply('ℹ️ No running task to stop.', { parse_mode: 'HTML' });
        return;
      }
      this.pendingQuestions.delete(chatId);
      const cancelled = await this.bridge.cancelTask(activeTaskId);
      if (cancelled) {
        await ctx.reply(`✅ Task <code>${activeTaskId.slice(0, 8)}</code> stopped.`, {
          parse_mode: 'HTML',
        });
      } else {
        await ctx.reply('⚠️ Task could not be stopped.', { parse_mode: 'HTML' });
      }
    });

    // /unpair — disconnect this Telegram account
    this.bot.command('unpair', async (ctx) => {
      if (!this.isAuthorized(ctx)) {
        await ctx.reply('🔑 Not paired to any Admin instance.');
        return;
      }

      this.pairing = null;
      this.onPairingChange(null);
      await ctx.reply('🔓 <b>Unpaired.</b> This chat is no longer linked to Admin.', {
        parse_mode: 'HTML',
      });
    });

    // Handle callback queries for permission and question inline buttons
    this.bot.on('callback_query:data', async (ctx) => {
      if (!this.pairing || ctx.chat?.id !== this.pairing.chatId) {
        await ctx.answerCallbackQuery({ text: 'Not authorized.' });
        return;
      }

      const data = ctx.callbackQuery.data;
      const chatId = ctx.chat.id;

      // Permission buttons
      if (data.startsWith('perm_allow:') || data.startsWith('perm_deny:')) {
        const allowed = data.startsWith('perm_allow:');
        const requestId = data.split(':')[1];

        try {
          await this.bridge.respondToPermission(requestId, allowed);
          await ctx.answerCallbackQuery({
            text: allowed ? '✅ Permission granted' : '❌ Permission denied',
          });
          await ctx.editMessageReplyMarkup({ reply_markup: undefined });
          const statusText = allowed
            ? '✅ Permission <b>granted</b>'
            : '❌ Permission <b>denied</b>';
          await ctx.editMessageText((ctx.callbackQuery.message?.text || '') + `\n\n${statusText}`, {
            parse_mode: 'HTML',
          });
        } catch (_error) {
          await ctx.answerCallbackQuery({ text: 'Failed to respond to permission.' });
        }
        return;
      }

      // Question option select (single-select)
      if (data.startsWith('q_sel:')) {
        const parts = data.split(':');
        const requestId = parts[1];
        const optionIndex = parseInt(parts[2], 10);
        const pending = this.pendingQuestions.get(chatId);

        if (!pending || pending.requestId !== requestId) {
          await ctx.answerCallbackQuery({ text: 'Question expired.' });
          return;
        }

        const option = pending.options[optionIndex];
        if (!option) {
          await ctx.answerCallbackQuery({ text: 'Invalid option.' });
          return;
        }

        if (pending.multiSelect) {
          // Toggle selection
          if (pending.selectedOptions.has(option.label)) {
            pending.selectedOptions.delete(option.label);
          } else {
            pending.selectedOptions.add(option.label);
          }
          await ctx.answerCallbackQuery({
            text: pending.selectedOptions.has(option.label)
              ? `✅ Selected: ${option.label}`
              : `Deselected: ${option.label}`,
          });

          // Update keyboard to show selections
          const keyboard = this.buildQuestionKeyboard(
            requestId,
            pending.options,
            true,
            pending.selectedOptions,
          );
          try {
            await ctx.editMessageReplyMarkup({ reply_markup: keyboard });
          } catch (_err) {
            // Message may not have changed
          }
        } else {
          // Single select — submit immediately
          try {
            await this.bridge.respondToQuestion(requestId, {
              selectedOptions: [option.label],
            });
            this.pendingQuestions.delete(chatId);
            await ctx.answerCallbackQuery({ text: `✅ Selected: ${option.label}` });
            await ctx.editMessageReplyMarkup({ reply_markup: undefined });
          } catch (_error) {
            await ctx.answerCallbackQuery({ text: 'Failed to submit answer.' });
          }
        }
        return;
      }

      // Multi-select submit button
      if (data.startsWith('q_submit:')) {
        const requestId = data.split(':')[1];
        const pending = this.pendingQuestions.get(chatId);

        if (!pending || pending.requestId !== requestId) {
          await ctx.answerCallbackQuery({ text: 'Question expired.' });
          return;
        }

        const selected = Array.from(pending.selectedOptions);
        try {
          await this.bridge.respondToQuestion(requestId, {
            selectedOptions: selected.length > 0 ? selected : undefined,
            denied: selected.length === 0,
          });
          this.pendingQuestions.delete(chatId);
          await ctx.answerCallbackQuery({ text: '✅ Submitted' });
          await ctx.editMessageReplyMarkup({ reply_markup: undefined });
        } catch (_error) {
          await ctx.answerCallbackQuery({ text: 'Failed to submit answer.' });
        }
        return;
      }

      // Question skip/deny
      if (data.startsWith('q_skip:')) {
        const requestId = data.split(':')[1];
        const pending = this.pendingQuestions.get(chatId);

        if (!pending || pending.requestId !== requestId) {
          await ctx.answerCallbackQuery({ text: 'Question expired.' });
          return;
        }

        try {
          await this.bridge.respondToQuestion(requestId, { denied: true });
          this.pendingQuestions.delete(chatId);
          await ctx.answerCallbackQuery({ text: '⏭ Skipped' });
          await ctx.editMessageReplyMarkup({ reply_markup: undefined });
        } catch (_error) {
          await ctx.answerCallbackQuery({ text: 'Failed to skip.' });
        }
      }
    });

    // Plain text messages — answer pending question or treat as task prompt
    this.bot.on('message:text', async (ctx) => {
      if (!this.isAuthorized(ctx)) {
        await ctx.reply('🔑 Please pair first. Send /start for instructions.');
        return;
      }

      const text = ctx.message.text.trim();
      if (!text) {
        return;
      }

      // If there's a pending question for this chat, treat text as the answer
      const chatId = ctx.chat.id;
      const pending = this.pendingQuestions.get(chatId);
      if (pending) {
        try {
          await this.bridge.respondToQuestion(pending.requestId, {
            customText: text,
          });
          this.pendingQuestions.delete(chatId);
          await ctx.reply('✅ Answer submitted.');
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          await ctx.reply(`❌ Failed to submit answer: ${message}`);
        }
        return;
      }

      try {
        await this.bridge.startTask(chatId, text);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        await ctx.reply(`❌ Failed to start task: ${message}`);
      }
    });
  }

  async sendHtml(chatId: number, text: string) {
    return this.bot.api.sendMessage(chatId, text, { parse_mode: 'HTML' });
  }

  async sendPermissionRequest(chatId: number, text: string, requestId: string) {
    const keyboard = new InlineKeyboard()
      .text('✅ Allow', `perm_allow:${requestId}`)
      .text('❌ Deny', `perm_deny:${requestId}`);

    return this.bot.api.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  }

  async sendQuestionRequest(
    chatId: number,
    text: string,
    requestId: string,
    options: Array<{ label: string; description?: string }>,
    multiSelect: boolean,
  ) {
    let sentMessage;

    if (options.length > 0) {
      const keyboard = this.buildQuestionKeyboard(requestId, options, multiSelect, new Set());
      sentMessage = await this.bot.api.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } else {
      // Free-text question — use ForceReply to prompt input
      sentMessage = await this.bot.api.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_markup: { force_reply: true, selective: true },
      });
    }

    // Track pending question
    this.pendingQuestions.set(chatId, {
      requestId,
      options,
      multiSelect,
      selectedOptions: new Set(),
      messageId: sentMessage.message_id,
    });

    return sentMessage;
  }

  private buildQuestionKeyboard(
    requestId: string,
    options: Array<{ label: string; description?: string }>,
    multiSelect: boolean,
    selectedOptions: Set<string>,
  ): InlineKeyboard {
    const keyboard = new InlineKeyboard();

    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      const isSelected = selectedOptions.has(opt.label);
      const prefix = multiSelect ? (isSelected ? '✅ ' : '⬜ ') : '';
      // Truncate label to fit Telegram's 64-byte callback_data limit
      keyboard.text(`${prefix}${opt.label}`.slice(0, 40), `q_sel:${requestId}:${i}`);
      keyboard.row();
    }

    if (multiSelect) {
      keyboard.text('📤 Submit', `q_submit:${requestId}`);
      keyboard.text('⏭ Skip', `q_skip:${requestId}`);
    } else {
      keyboard.text('⏭ Skip', `q_skip:${requestId}`);
    }

    return keyboard;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    console.log('[TelegramBot] Starting long polling...');
    this.isRunning = true;

    // Set bot commands for menu
    await this.bot.api.setMyCommands([
      { command: 'task', description: 'Start a new task with a prompt' },
      { command: 'status', description: 'View recent tasks' },
      { command: 'stop', description: 'Stop the current running task' },
      { command: 'cancel', description: 'Cancel a running task by ID' },
      { command: 'help', description: 'Show help' },
      { command: 'unpair', description: 'Disconnect from Admin' },
    ]);

    // Use long polling (no webhook needed, works behind NAT)
    this.bot.start({
      onStart: () => {
        console.log('[TelegramBot] Bot is running');
      },
    });
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }
    console.log('[TelegramBot] Stopping...');
    this.isRunning = false;
    await this.bot.stop();
  }

  getIsRunning(): boolean {
    return this.isRunning;
  }

  updatePairing(pairing: TelegramPairing | null): void {
    this.pairing = pairing;
  }

  /** Notify Telegram user that pairing was approved */
  async notifyPairingApproved(chatId: number): Promise<void> {
    try {
      await this.bot.api.sendMessage(
        chatId,
        '✅ <b>Pairing approved!</b>\n\n' +
          'This Telegram account is now linked to your Admin instance.\n\n' +
          formatWelcome(),
        { parse_mode: 'HTML' },
      );
    } catch (error) {
      console.error('[TelegramBot] Failed to notify pairing approval:', error);
    }
  }

  /** Notify Telegram user that pairing was denied */
  async notifyPairingDenied(chatId: number): Promise<void> {
    try {
      await this.bot.api.sendMessage(
        chatId,
        '❌ <b>Pairing denied.</b>\n\nThe desktop user denied your pairing request.',
        { parse_mode: 'HTML' },
      );
    } catch (error) {
      console.error('[TelegramBot] Failed to notify pairing denial:', error);
    }
  }

  /** Notify Telegram user that their session has expired */
  async notifySessionExpired(chatId: number): Promise<void> {
    try {
      await this.bot.api.sendMessage(
        chatId,
        '🔒 <b>Session expired.</b>\n\n' +
          'Your session has expired due to inactivity.\n' +
          'Please re-pair using /start YOUR_PIN from Admin Settings.',
        { parse_mode: 'HTML' },
      );
    } catch (error) {
      console.error('[TelegramBot] Failed to notify session expiry:', error);
    }
  }

  async getBotInfo(): Promise<{ username: string; firstName: string } | null> {
    try {
      const me = await this.bot.api.getMe();
      return { username: me.username, firstName: me.first_name };
    } catch {
      return null;
    }
  }
}
