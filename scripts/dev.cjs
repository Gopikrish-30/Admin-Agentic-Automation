const {
  clearPort,
  formatChildExit,
  killChildProcess,
  resolveExitCode,
  spawnPnpm,
  waitForResources,
} = require('./dev-runtime.cjs');

const args = new Set(process.argv.slice(2));
const isClean = args.has('--clean') || process.env.CLEAN_START === '1';
const isCheck = args.has('--check');
const env = { ...process.env };
const WEB_DEV_URL = 'http://localhost:5173';
const MOCK_ADMIN_PANEL_URL = env.MOCK_ADMIN_PANEL_URL || 'http://127.0.0.1:4010';
const mockAdminOnlyGuardValue = (env.NAVIGATOR_MOCK_ADMIN_ONLY || '').toLowerCase();
const isMockAdminOnlyMode = mockAdminOnlyGuardValue !== '0' && mockAdminOnlyGuardValue !== 'false';
if (isClean) {
  env.CLEAN_START = '1';
}

let web;
let mockAdmin;
let electron;
let shuttingDown = false;
let ownsWebServer = false;
let ownsMockAdminServer = false;

function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;

  killChildProcess(electron, { force: true });
  if (ownsMockAdminServer) {
    killChildProcess(mockAdmin, { force: true });
  }
  if (ownsWebServer) {
    killChildProcess(web, { force: true });
    clearPort(5173);
  }

  process.exit(resolveExitCode(reason));
}

function handleChildError(label, error) {
  if (shuttingDown) return;
  console.error(`[dev] ${label} failed to start: ${error.message}`);
  shutdown(error);
}

function handleChildExit(label, code, signal) {
  if (shuttingDown) return;
  const message = `[dev] ${label} exited (${formatChildExit(code, signal)})`;
  if (typeof code === 'number' && code === 0) {
    console.log(message);
  } else {
    console.error(message);
  }
  shutdown(typeof code === 'number' ? code : 1);
}

async function launchDesktopRuntime() {
  if (shuttingDown) return;

  const electronCommand = isClean ? 'dev:clean' : 'dev';
  const electronArgs = ['-F', '@navigator/desktop', electronCommand];
  if (isCheck) {
    electronArgs.push('--', '--check');
  }

  electron = spawnPnpm(electronArgs, { env });
  electron.on('error', (error) => handleChildError('desktop dev runtime', error));
  electron.on('exit', (code, signal) => {
    if (shuttingDown) return;
    if (isCheck && code === 0) {
      console.log('[dev] Check mode passed');
      shutdown(0);
      return;
    }
    handleChildExit('desktop dev runtime', code, signal);
  });
}

async function launchMockAdminRuntime() {
  if (shuttingDown) return;

  try {
    await waitForResources([MOCK_ADMIN_PANEL_URL], 1200);
    console.log(`[dev] Reusing existing mock admin panel at ${MOCK_ADMIN_PANEL_URL}`);
    return;
  } catch {
    // No mock admin panel detected - start one.
  }

  ownsMockAdminServer = true;
  mockAdmin = spawnPnpm(['-F', '@navigator/mock-admin', 'dev'], { env });
  mockAdmin.on('error', (error) => handleChildError('mock admin panel', error));
  mockAdmin.on('exit', (code, signal) => handleChildExit('mock admin panel', code, signal));

  await waitForResources([MOCK_ADMIN_PANEL_URL], 30000);
  console.log(`[dev] Mock admin panel is available at ${MOCK_ADMIN_PANEL_URL}`);
}

async function start() {
  if (isMockAdminOnlyMode) {
    await launchMockAdminRuntime();
  }

  try {
    await waitForResources([WEB_DEV_URL], 1200);
    console.log(`[dev] Reusing existing web dev server at ${WEB_DEV_URL}`);
    await launchDesktopRuntime();
    return;
  } catch {
    // No web dev server detected - start one.
  }

  const clearedPortCount = clearPort(5173);
  if (clearedPortCount > 0) {
    console.log(`[dev] Cleared ${clearedPortCount} process(es) from port 5173`);
  }

  ownsWebServer = true;
  web = spawnPnpm(['-F', '@navigator/web', 'dev'], { env });
  web.on('error', (error) => handleChildError('web dev server', error));
  web.on('exit', (code, signal) => handleChildExit('web dev server', code, signal));

  await waitForResources([WEB_DEV_URL], 30000);
  await launchDesktopRuntime();
}

start().catch((error) => {
  if (shuttingDown) return;
  console.error(`[dev] Failed during startup: ${error.message}`);
  shutdown(error);
});

process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));
process.on('uncaughtException', (error) => {
  console.error(error);
  shutdown(error);
});
process.on('unhandledRejection', (reason) => {
  console.error(reason);
  shutdown(reason);
});
