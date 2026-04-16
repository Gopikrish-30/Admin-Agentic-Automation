/**
 * Thought Stream API Server
 *
 * HTTP server for streaming thought/checkpoint events to the UI in real-time.
 * This bridges the automation runtime (separate process) with the Electron UI.
 */

import http from 'http';
import type { BrowserWindow } from 'electron';
import {
  THOUGHT_STREAM_PORT,
  createThoughtStreamHandler,
  type ThoughtStreamAPI,
  type ThoughtStreamEvent as ThoughtEvent,
  type ThoughtStreamCheckpointEvent as CheckpointEvent,
} from '@navigator_ai/agent-core';

// Re-export types and constant for backwards compatibility
export { THOUGHT_STREAM_PORT };
export type { ThoughtEvent, CheckpointEvent };

// Store reference to main window
let mainWindow: BrowserWindow | null = null;

// Singleton handler instance for task tracking and event validation
const thoughtStreamHandler: ThoughtStreamAPI = createThoughtStreamHandler();

function isRequestAuthorized(req: http.IncomingMessage): boolean {
  // Read auth token at request time to support testing
  const LOCAL_API_AUTH_TOKEN = process.env.LOCAL_API_AUTH_TOKEN || '';
  
  if (!LOCAL_API_AUTH_TOKEN) {
    return true;
  }

  const headerValue = req.headers['x-navigator-auth'];
  if (typeof headerValue === 'string') {
    return headerValue === LOCAL_API_AUTH_TOKEN;
  }
  if (Array.isArray(headerValue)) {
    return headerValue.includes(LOCAL_API_AUTH_TOKEN);
  }

  return false;
}

/**
 * Initialize the thought stream API with dependencies
 */
export function initThoughtStreamApi(window: BrowserWindow): void {
  mainWindow = window;
}

/**
 * Register a task ID as active (called when task starts)
 */
export function registerActiveTask(taskId: string): void {
  thoughtStreamHandler.registerTask(taskId);
}

/**
 * Unregister a task ID (called when task completes)
 */
export function unregisterActiveTask(taskId: string): void {
  thoughtStreamHandler.unregisterTask(taskId);
}

/**
 * Create and start the HTTP server for thought streaming
 */
export function startThoughtStreamServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    // CORS headers for local requests
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Auth');

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Only handle POST requests
    if (req.method !== 'POST') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    if (!isRequestAuthorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    // Parse request body
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    // Check endpoint exists first (before validating task)
    if (req.url !== '/thought' && req.url !== '/checkpoint') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    // Validate taskId exists and is active
    const taskId = data.taskId as string;
    if (!taskId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing taskId' }));
      return;
    }

    if (!thoughtStreamHandler.isTaskActive(taskId)) {
      console.warn(`[Thought Stream API] Received event for unknown/inactive task: ${taskId}`);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unknown or inactive task', taskId }));
      return;
    }

    // Route based on endpoint
    if (req.url === '/thought') {
      handleThought(data as unknown as ThoughtEvent, res);
    } else if (req.url === '/checkpoint') {
      handleCheckpoint(data as unknown as CheckpointEvent, res);
    }
  });

  server.listen(THOUGHT_STREAM_PORT, '127.0.0.1', () => {
    console.log(`[Thought Stream API] Server listening on port ${THOUGHT_STREAM_PORT}`);
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.warn(
        `[Thought Stream API] Port ${THOUGHT_STREAM_PORT} already in use, skipping server start`,
      );
    } else {
      console.error('[Thought Stream API] Server error:', error);
    }
  });

  return server;
}

function handleThought(event: ThoughtEvent, res: http.ServerResponse): void {
  // Forward to renderer via IPC
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('task:thought', event);
  }

  // Fire-and-forget: always return 200
  res.writeHead(200);
  res.end();
}

function handleCheckpoint(event: CheckpointEvent, res: http.ServerResponse): void {
  // Forward to renderer via IPC
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('task:checkpoint', event);
  }

  // Fire-and-forget: always return 200
  res.writeHead(200);
  res.end();
}
