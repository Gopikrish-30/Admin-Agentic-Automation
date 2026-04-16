/**
 * Permission API Server
 *
 * HTTP server that local runtime tools call to request user input.
 * This bridges separate tool processes with the Electron UI.
 */

import http from 'http';
import type { BrowserWindow } from 'electron';
import {
  PERMISSION_API_PORT,
  QUESTION_API_PORT,
  isFilePermissionRequest,
  isQuestionRequest,
  createPermissionHandler,
  type PermissionHandlerAPI,
  type PermissionFileRequestData as FilePermissionRequestData,
  type PermissionQuestionRequestData as QuestionRequestData,
  type PermissionQuestionResponseData as QuestionResponseData,
} from '@navigator_ai/agent-core';

export { PERMISSION_API_PORT, QUESTION_API_PORT, isFilePermissionRequest, isQuestionRequest };

// Singleton permission request handler
const permissionHandler: PermissionHandlerAPI = createPermissionHandler();

// Store reference to main window and task manager
let mainWindow: BrowserWindow | null = null;
let getActiveTaskId: (() => string | null) | null = null;

// Track pending request IDs by task so we can deny them on cancel
const pendingPermissionsByTask = new Map<string, string>();
const pendingQuestionsByTask = new Map<string, string>();

// Question request listener for external integrations (e.g., Telegram)
type QuestionRequestListener = (questionRequest: {
  id: string;
  taskId: string;
  question?: string;
  header?: string;
  options?: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
}) => void;
let questionRequestListener: QuestionRequestListener | null = null;

const LOCAL_API_AUTH_TOKEN = process.env.LOCAL_API_AUTH_TOKEN || '';

function isRequestAuthorized(req: http.IncomingMessage): boolean {
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
 * Register a listener that is called when question requests arrive.
 */
export function setQuestionRequestListener(listener: QuestionRequestListener | null): void {
  questionRequestListener = listener;
}

/**
 * Deny all pending permission and question requests for a specific task.
 * Called when a task is cancelled/interrupted to unblock the MCP tool processes.
 */
export function denyPendingRequestsForTask(taskId: string): void {
  const permReqId = pendingPermissionsByTask.get(taskId);
  if (permReqId) {
    resolvePermission(permReqId, false);
    pendingPermissionsByTask.delete(taskId);
  }

  const questionReqId = pendingQuestionsByTask.get(taskId);
  if (questionReqId) {
    resolveQuestion(questionReqId, { denied: true });
    pendingQuestionsByTask.delete(taskId);
  }
}

/**
 * Initialize the permission API with dependencies
 */
export function initPermissionApi(window: BrowserWindow, taskIdGetter: () => string | null): void {
  mainWindow = window;
  getActiveTaskId = taskIdGetter;
}

/**
 * Resolve a pending permission request from the MCP server
 * Called when user responds via the UI
 */
export function resolvePermission(requestId: string, allowed: boolean): boolean {
  return permissionHandler.resolvePermissionRequest(requestId, allowed);
}

/**
 * Resolve a pending question request from the MCP server
 * Called when user responds via the UI
 */
export function resolveQuestion(requestId: string, response: QuestionResponseData): boolean {
  return permissionHandler.resolveQuestionRequest(requestId, response);
}

/**
 * Create and start the HTTP server for permission requests
 */
export function startPermissionApiServer(): http.Server {
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

    // Only handle POST /permission
    if (req.method !== 'POST' || req.url !== '/permission') {
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

    let data: FilePermissionRequestData;

    try {
      data = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    // Validate request using core handler
    const validation = permissionHandler.validateFilePermissionRequest(data);
    if (!validation.valid) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: validation.error }));
      return;
    }

    // Check if we have the necessary dependencies
    if (!mainWindow || mainWindow.isDestroyed() || !getActiveTaskId) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Permission API not initialized' }));
      return;
    }

    const taskId = getActiveTaskId();
    if (!taskId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No active task' }));
      return;
    }

    // Create request using core handler
    const { requestId, promise } = permissionHandler.createPermissionRequest();
    pendingPermissionsByTask.set(taskId, requestId);

    // Build permission request for the UI
    const permissionRequest = permissionHandler.buildFilePermissionRequest(requestId, taskId, data);

    // Send to renderer (Electron-specific)
    mainWindow.webContents.send('permission:request', permissionRequest);

    // Wait for user response
    try {
      const allowed = await promise;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ allowed }));
    } catch (_error) {
      res.writeHead(408, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request timed out', allowed: false }));
    } finally {
      pendingPermissionsByTask.delete(taskId);
    }
  });

  server.listen(PERMISSION_API_PORT, '127.0.0.1', () => {
    console.log(`[Permission API] Server listening on port ${PERMISSION_API_PORT}`);
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.warn(
        `[Permission API] Port ${PERMISSION_API_PORT} already in use, skipping server start`,
      );
    } else {
      console.error('[Permission API] Server error:', error);
    }
  });

  return server;
}

/**
 * Create and start the HTTP server for question requests
 */
export function startQuestionApiServer(): http.Server {
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

    // Only handle POST /question
    if (req.method !== 'POST' || req.url !== '/question') {
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

    let data: QuestionRequestData;

    try {
      data = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    // Validate request using core handler
    const validation = permissionHandler.validateQuestionRequest(data);
    if (!validation.valid) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: validation.error }));
      return;
    }

    // Check if we have the necessary dependencies
    if (!mainWindow || mainWindow.isDestroyed() || !getActiveTaskId) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Question API not initialized' }));
      return;
    }

    const taskId = getActiveTaskId();
    if (!taskId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No active task' }));
      return;
    }

    // Create request using core handler
    const { requestId, promise } = permissionHandler.createQuestionRequest();
    pendingQuestionsByTask.set(taskId, requestId);

    // Build question request for the UI
    const questionRequest = permissionHandler.buildQuestionRequest(requestId, taskId, data);

    // Send to renderer (Electron-specific)
    mainWindow.webContents.send('permission:request', questionRequest);

    // Also notify external listener (e.g., Telegram bridge)
    if (questionRequestListener) {
      questionRequestListener(questionRequest);
    }

    // Wait for user response
    try {
      const response = await promise;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    } catch (_error) {
      res.writeHead(408, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request timed out', denied: true }));
    } finally {
      pendingQuestionsByTask.delete(taskId);
    }
  });

  server.listen(QUESTION_API_PORT, '127.0.0.1', () => {
    console.log(`[Question API] Server listening on port ${QUESTION_API_PORT}`);
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.warn(
        `[Question API] Port ${QUESTION_API_PORT} already in use, skipping server start`,
      );
    } else {
      console.error('[Question API] Server error:', error);
    }
  });

  return server;
}
