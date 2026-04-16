import { config } from 'dotenv';
import {
  app,
  BrowserWindow,
  shell,
  ipcMain,
  dialog,
  nativeTheme,
  Menu,
} from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const APP_DATA_NAME = 'Admin';
app.setPath('userData', path.join(app.getPath('appData'), APP_DATA_NAME));

if (!app.isPackaged) {
  process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';
}

if (process.platform === 'win32') {
  app.setAppUserModelId('ai.navigator.desktop');
}

import { registerIPCHandlers } from './ipc/handlers';
import { FutureSchemaError } from '@navigator_ai/agent-core';
import { initThoughtStreamApi, startThoughtStreamServer } from './thought-stream-api';
import { getTelegramService, disposeTelegramService } from './telegram';
import type { ProviderId } from '@navigator_ai/agent-core';
import { disposeTaskManager, cleanupVertexServiceAccountKey } from './opencode';
import { oauthBrowserFlow } from './opencode/auth-browser';
import { migrateLegacyData } from './store/legacyMigration';
import { validateGeneralExternalUrl } from './security/url-validation';
import {
  initializeStorage,
  closeStorage,
  getStorage,
  resetStorageSingleton,
} from './store/storage';
import { getApiKey, clearSecureStorage } from './store/secureStorage';
import { initializeLogCollector, shutdownLogCollector, getLogCollector } from './logging';
import { skillsManager } from './skills';

if (process.argv.includes('--e2e-skip-auth')) {
  (global as Record<string, unknown>).E2E_SKIP_AUTH = true;
}

if (process.env.CLEAN_START === '1') {
  const userDataPath = app.getPath('userData');
  console.log('[Clean Mode] Clearing userData directory:', userDataPath);
  try {
    if (fs.existsSync(userDataPath)) {
      fs.rmSync(userDataPath, { recursive: true, force: true });
      console.log('[Clean Mode] Successfully cleared userData');
    }
  } catch (err) {
    console.error('[Clean Mode] Failed to clear userData:', err);
  }
  // Clear secure storage first (while singleton still exists), then null the reference.
  // Reversing this order would cause getStorage() to re-create the singleton.
  clearSecureStorage();
  resetStorageSingleton();
  console.log('[Clean Mode] All singletons reset');
}

app.setName('Admin');

// Optional: disable hardware acceleration to reduce GPU helper processes / memory.
// Enable by setting DISABLE_HW_ACCELERATION=1 in the environment (or true).
const _disableHw =
  process.env.DISABLE_HW_ACCELERATION === '1' || process.env.DISABLE_HW_ACCELERATION === 'true';
if (_disableHw) {
  try {
    app.disableHardwareAcceleration();
    console.log('[Main] Hardware acceleration disabled by DISABLE_HW_ACCELERATION');
  } catch (err) {
    console.warn('[Main] Failed to disable hardware acceleration:', err);
  }
}

// Optional: enable periodic memory logging to help detect leaks.
// Turn on with ENABLE_MEMORY_LOGGING=1.
let __memoryLogInterval: NodeJS.Timeout | null = null;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const envPath = app.isPackaged
  ? path.join(process.resourcesPath, '.env')
  : path.join(__dirname, '../../.env');
config({ path: envPath });

process.env.APP_ROOT = path.join(__dirname, '../..');

export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron');

const ROUTER_URL = process.env.NAVIGATOR_ROUTER_URL;

// In production, web's build output is packaged as an extraResource.
const WEB_DIST = app.isPackaged
  ? path.join(process.resourcesPath, 'web-ui')
  : path.join(process.env.APP_ROOT, '../web/dist/client');

let mainWindow: BrowserWindow | null = null;

function getPreloadPath(): string {
  return path.join(__dirname, '../preload/index.cjs');
}

function createWindow() {
  console.log('[Main] Creating main application window');

  const preloadPath = getPreloadPath();
  console.log('[Main] Using preload script:', preloadPath);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Admin',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#171717' : '#f9f9f9',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: true,
    },
  });

  mainWindow.webContents.on('context-menu', (_event, params) => {
    if (!params.misspelledWord) {
      return;
    }

    const menuItems: Electron.MenuItemConstructorOptions[] = params.dictionarySuggestions.map(
      (suggestion) => ({
        label: suggestion,
        click: () => mainWindow?.webContents.replaceMisspelling(suggestion),
      }),
    );

    if (menuItems.length > 0) {
      menuItems.push({ type: 'separator' });
    }

    menuItems.push({
      label: 'Add to Dictionary',
      click: () =>
        mainWindow?.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
    });

    Menu.buildFromTemplate(menuItems).popup();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      try {
        validateGeneralExternalUrl(url);
        shell.openExternal(url);
      } catch (error) {
        console.error('[Security] Blocked external URL:', error instanceof Error ? error.message : error);
      }
    }
    return { action: 'deny' };
  });

  mainWindow.maximize();

  const isE2EMode = (global as Record<string, unknown>).E2E_SKIP_AUTH === true;
  const isTestEnv = process.env.NODE_ENV === 'test';
  if (!app.isPackaged && !isE2EMode && !isTestEnv) {
    mainWindow.webContents.openDevTools({ mode: 'right' });
  }

  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const isLocalDevRoute =
      !app.isPackaged &&
      typeof ROUTER_URL === 'string' &&
      ROUTER_URL.startsWith('http://localhost');

    const contentSecurityPolicy = isLocalDevRoute
      ? "default-src 'self' http: https: ws: wss: data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' http: https:; style-src 'self' 'unsafe-inline' http: https:; img-src 'self' data: blob: http: https:; connect-src 'self' http: https: ws: wss:; font-src 'self' data: http: https:"
      : "default-src 'self' https:; script-src 'self'; style-src 'self'; img-src 'self' data: https:; connect-src 'self' https: ws: wss:; font-src 'self' https: data:";

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [contentSecurityPolicy],
      },
    });
  });

  if (ROUTER_URL) {
    console.log('[Main] Loading from router URL:', ROUTER_URL);
    mainWindow.loadURL(ROUTER_URL);
  } else {
    const indexPath = path.join(WEB_DIST, 'index.html');
    console.log('[Main] Loading from file:', indexPath);
    mainWindow.loadFile(indexPath);
  }
}

process.on('uncaughtException', (error) => {
  try {
    const collector = getLogCollector();
    collector.log('ERROR', 'main', `Uncaught exception: ${error.message}`, {
      name: error.name,
      stack: error.stack,
    });
  } catch {
    // ignore - log collector may not be initialized
  }
});

process.on('unhandledRejection', (reason) => {
  try {
    const collector = getLogCollector();
    collector.log('ERROR', 'main', 'Unhandled promise rejection', { reason });
  } catch {
    // ignore - log collector may not be initialized
  }
});

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('[Main] Second instance attempted; quitting');
  app.quit();
} else {
  initializeLogCollector();
  getLogCollector().logEnv('INFO', 'App starting', {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
  });

  app.on('second-instance', (_event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      console.log('[Main] Focused existing instance after second-instance event');

      if (process.platform === 'win32') {
        const protocolUrl = commandLine.find((arg) => arg.startsWith('navigator://'));
        if (protocolUrl) {
          console.log('[Main] Received protocol URL from second-instance:', protocolUrl);
          if (protocolUrl.startsWith('navigator://callback/mcp')) {
            mainWindow.webContents.send('auth:mcp-callback', protocolUrl);
          } else if (protocolUrl.startsWith('navigator://callback')) {
            mainWindow.webContents.send('auth:callback', protocolUrl);
          }
        }
      }
    }
  });

  app.whenReady().then(async () => {
    console.log('[Main] Electron app ready, version:', app.getVersion());

    if (process.env.CLEAN_START !== '1') {
      try {
        const didMigrate = migrateLegacyData();
        if (didMigrate) {
          console.log('[Main] Migrated data from legacy userData path');
        }
      } catch (err) {
        console.error('[Main] Legacy data migration failed:', err);
      }
    }

    try {
      initializeStorage();
    } catch (err) {
      if (err instanceof FutureSchemaError) {
        await dialog.showMessageBox({
          type: 'error',
          title: 'Update Required',
          message: `This data was created by a newer version of Admin (schema v${err.storedVersion}).`,
          detail: `Your app supports up to schema v${err.appVersion}. Please update Admin to continue.`,
          buttons: ['Quit'],
        });
        app.quit();
        return;
      }
      throw err;
    }

    try {
      const storage = getStorage();
      const settings = storage.getProviderSettings();
      for (const [id, provider] of Object.entries(settings.connectedProviders)) {
        const providerId = id as ProviderId;
        const credType = provider?.credentials?.type;
        if (!credType || credType === 'api_key') {
          const key = getApiKey(providerId);
          if (!key) {
            console.warn(
              `[Main] Provider ${providerId} has api_key auth but key not found in secure storage`,
            );
            storage.removeConnectedProvider(providerId);
            console.log(`[Main] Removed provider ${providerId} due to missing API key`);
          }
        }
      }
    } catch (err) {
      console.error('[Main] Provider validation failed:', err);
    }

    await skillsManager.initialize();

    // Must run before createWindow() so backgroundColor matches the theme
    try {
      const storage = getStorage();
      nativeTheme.themeSource = storage.getTheme();
    } catch {
      // First launch or corrupt DB — nativeTheme stays 'system'
    }

    registerIPCHandlers();
    console.log('[Main] IPC handlers registered');

    createWindow();

    if (mainWindow) {
      initThoughtStreamApi(mainWindow);
      startThoughtStreamServer();
    }

    // Initialize Telegram bot (auto-starts if previously configured)
    getTelegramService()
      .initialize()
      .catch((err) => {
        console.error('[Main] Telegram service initialization failed:', err);
      });

    // Start optional memory logging (env: ENABLE_MEMORY_LOGGING=1)
    if (process.env.ENABLE_MEMORY_LOGGING === '1') {
      try {
        const collector = getLogCollector();
        __memoryLogInterval = setInterval(() => {
          try {
            const metrics = app.getAppMetrics();
            for (const metric of metrics) {
              collector.log(
                'INFO',
                'main',
                `[memory] pid=${metric.pid} type=${metric.type} workingSetSize=${metric.memory.workingSetSize}kB`,
              );
            }
          } catch (err) {
            console.error('[Main] Memory log failed:', err);
          }
        }, 30000);
        console.log('[Main] Periodic memory logging enabled (30s)');
      } catch (err) {
        console.error('[Main] Failed to start memory logging:', err);
      }
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
        console.log('[Main] Application reactivated; recreated window');
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  disposeTelegramService();
  disposeTaskManager(); // Also cleans up proxies internally
  cleanupVertexServiceAccountKey();
  oauthBrowserFlow.dispose();
  closeStorage();
  shutdownLogCollector();
  if (__memoryLogInterval) {
    clearInterval(__memoryLogInterval);
    __memoryLogInterval = null;
    console.log('[Main] Cleared memory logging interval');
  }
});

if (process.platform === 'win32' && !app.isPackaged) {
  app.setAsDefaultProtocolClient('navigator', process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient('navigator');
}

function handleProtocolUrlFromArgs(): void {
  if (process.platform === 'win32') {
    const protocolUrl = process.argv.find((arg) => arg.startsWith('navigator://'));
    if (protocolUrl) {
      app.whenReady().then(() => {
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            if (protocolUrl.startsWith('navigator://callback/mcp')) {
              mainWindow.webContents.send('auth:mcp-callback', protocolUrl);
            } else if (protocolUrl.startsWith('navigator://callback')) {
              mainWindow.webContents.send('auth:callback', protocolUrl);
            }
          }
        }, 1000);
      });
    }
  }
}

handleProtocolUrlFromArgs();

app.on('open-url', (event, url) => {
  event.preventDefault();
  if (url.startsWith('navigator://callback/mcp')) {
    mainWindow?.webContents?.send('auth:mcp-callback', url);
  } else if (url.startsWith('navigator://callback')) {
    mainWindow?.webContents?.send('auth:callback', url);
  }
});

ipcMain.handle('app:version', () => {
  return app.getVersion();
});

ipcMain.handle('app:platform', () => {
  return process.platform;
});
