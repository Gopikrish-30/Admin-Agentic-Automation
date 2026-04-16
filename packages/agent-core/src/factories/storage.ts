import {
  initializeDatabase,
  closeDatabase,
  isDatabaseInitialized,
  getDatabasePath,
} from '../storage/database.js';
import {
  getTasks,
  getTask,
  saveTask,
  updateTaskStatus,
  addTaskMessage,
  updateTaskSessionId,
  updateTaskSummary,
  deleteTask,
  clearHistory,
  getTodosForTask,
  saveTodosForTask,
  clearTodosForTask,
} from '../storage/repositories/taskHistory.js';
import {
  getDebugMode,
  setDebugMode,
  getOnboardingComplete,
  setOnboardingComplete,
  getSelectedModel,
  setSelectedModel,
  getOllamaConfig,
  setOllamaConfig,
  getLiteLLMConfig,
  setLiteLLMConfig,
  getAzureFoundryConfig,
  setAzureFoundryConfig,
  getLMStudioConfig,
  setLMStudioConfig,
  getOpenAiBaseUrl,
  setOpenAiBaseUrl,
  getTheme,
  setTheme,
  getAppSettings,
  clearAppSettings,
} from '../storage/repositories/appSettings.js';
import {
  getProviderSettings,
  setActiveProvider,
  getActiveProviderId,
  getConnectedProvider,
  setConnectedProvider,
  removeConnectedProvider,
  updateProviderModel,
  setProviderDebugMode,
  getProviderDebugMode,
  clearProviderSettings,
  getActiveProviderModel,
  hasReadyProvider,
  getConnectedProviderIds,
} from '../storage/repositories/providerSettings.js';
import {
  getAllConnectors as repoGetAllConnectors,
  getEnabledConnectors as repoGetEnabledConnectors,
  getConnectorById as repoGetConnectorById,
  upsertConnector as repoUpsertConnector,
  setConnectorEnabled as repoSetConnectorEnabled,
  setConnectorStatus as repoSetConnectorStatus,
  deleteConnector as repoDeleteConnector,
  clearAllConnectors as repoClearAllConnectors,
} from '../storage/repositories/connectors.js';
import { SecureStorage } from '../internal/classes/SecureStorage.js';
import type { McpConnector, OAuthTokens } from '../common/types/connector.js';
import type { StorageAPI, StorageOptions } from '../types/storage.js';

export function createStorage(options: StorageOptions = {}): StorageAPI {
  const {
    databasePath,
    runMigrations = true,
    userDataPath,
    secureStorageAppId = 'ai.navigator.desktop',
    secureStorageFileName,
    osEncrypt,
    osDecrypt,
  } = options;

  const storagePath = userDataPath || process.cwd();
  const secureStorage = new SecureStorage({
    storagePath,
    appId: secureStorageAppId,
    ...(secureStorageFileName && { fileName: secureStorageFileName }),
    ...(osEncrypt && { osEncrypt }),
    ...(osDecrypt && { osDecrypt }),
  });

  const connectorTokensKey = (connectorId: string): string => `connector-tokens:${connectorId}`;
  const connectorClientSecretKey = (connectorId: string): string =>
    `connector-client-secret:${connectorId}`;

  function stripClientSecret(connector: McpConnector): McpConnector {
    const clientRegistration = connector.clientRegistration;
    if (!clientRegistration?.clientSecret) {
      return connector;
    }

    const { clientSecret: _unused, ...sanitizedClientRegistration } = clientRegistration;

    return {
      ...connector,
      clientRegistration: sanitizedClientRegistration,
    };
  }

  function hydrateClientSecret(connector: McpConnector | null): McpConnector | null {
    if (!connector || !connector.clientRegistration) {
      return connector;
    }

    const storedSecret = secureStorage.get(connectorClientSecretKey(connector.id));
    if (!storedSecret) {
      return connector;
    }

    return {
      ...connector,
      clientRegistration: {
        ...connector.clientRegistration,
        clientSecret: storedSecret,
      },
    };
  }

  function migrateConnectorClientSecretsToSecureStorage(): void {
    const connectors = repoGetAllConnectors();
    let migratedCount = 0;

    for (const connector of connectors) {
      const clientSecret = connector.clientRegistration?.clientSecret;
      if (!clientSecret) {
        continue;
      }

      secureStorage.set(connectorClientSecretKey(connector.id), clientSecret);
      repoUpsertConnector(stripClientSecret(connector));
      migratedCount += 1;
    }

    if (migratedCount > 0) {
      console.log(`[Storage] Migrated ${migratedCount} connector client secret(s) to secure storage`);
    }
  }

  function clearConnectorSecretsFromSecureStorage(): void {
    const credentials = secureStorage.listStoredCredentials();
    for (const { account } of credentials) {
      if (
        account.startsWith('connector-client-secret:') ||
        account.startsWith('connector-tokens:')
      ) {
        secureStorage.delete(account);
      }
    }
  }

  let initialized = false;

  return {
    // Task History
    getTasks: () => getTasks(),
    getTask: (taskId) => getTask(taskId),
    saveTask: (task) => saveTask(task),
    updateTaskStatus: (taskId, status, completedAt) =>
      updateTaskStatus(taskId, status, completedAt),
    addTaskMessage: (taskId, message) => addTaskMessage(taskId, message),
    updateTaskSessionId: (taskId, sessionId) => updateTaskSessionId(taskId, sessionId),
    updateTaskSummary: (taskId, summary) => updateTaskSummary(taskId, summary),
    deleteTask: (taskId) => deleteTask(taskId),
    clearHistory: () => clearHistory(),
    getTodosForTask: (taskId) => getTodosForTask(taskId),
    saveTodosForTask: (taskId, todos) => saveTodosForTask(taskId, todos),
    clearTodosForTask: (taskId) => clearTodosForTask(taskId),

    // App Settings
    getDebugMode: () => getDebugMode(),
    setDebugMode: (enabled) => setDebugMode(enabled),
    getOnboardingComplete: () => getOnboardingComplete(),
    setOnboardingComplete: (complete) => setOnboardingComplete(complete),
    getSelectedModel: () => getSelectedModel(),
    setSelectedModel: (model) => setSelectedModel(model),
    getOllamaConfig: () => getOllamaConfig(),
    setOllamaConfig: (config) => setOllamaConfig(config),
    getLiteLLMConfig: () => getLiteLLMConfig(),
    setLiteLLMConfig: (config) => setLiteLLMConfig(config),
    getAzureFoundryConfig: () => getAzureFoundryConfig(),
    setAzureFoundryConfig: (config) => setAzureFoundryConfig(config),
    getLMStudioConfig: () => getLMStudioConfig(),
    setLMStudioConfig: (config) => setLMStudioConfig(config),
    getOpenAiBaseUrl: () => getOpenAiBaseUrl(),
    setOpenAiBaseUrl: (baseUrl) => setOpenAiBaseUrl(baseUrl),
    getTheme: () => getTheme(),
    setTheme: (theme) => setTheme(theme),
    getAppSettings: () => getAppSettings(),
    clearAppSettings: () => clearAppSettings(),

    // Provider Settings
    getProviderSettings: () => getProviderSettings(),
    setActiveProvider: (providerId) => setActiveProvider(providerId),
    getActiveProviderId: () => getActiveProviderId(),
    getConnectedProvider: (providerId) => getConnectedProvider(providerId),
    setConnectedProvider: (providerId, provider) => setConnectedProvider(providerId, provider),
    removeConnectedProvider: (providerId) => removeConnectedProvider(providerId),
    updateProviderModel: (providerId, modelId) => updateProviderModel(providerId, modelId),
    setProviderDebugMode: (enabled) => setProviderDebugMode(enabled),
    getProviderDebugMode: () => getProviderDebugMode(),
    clearProviderSettings: () => clearProviderSettings(),
    getActiveProviderModel: () => getActiveProviderModel(),
    hasReadyProvider: () => hasReadyProvider(),
    getConnectedProviderIds: () => getConnectedProviderIds(),

    // Connectors
    getAllConnectors: () => repoGetAllConnectors().map(stripClientSecret),
    getEnabledConnectors: () => repoGetEnabledConnectors().map(stripClientSecret),
    getConnectorById: (id) => hydrateClientSecret(repoGetConnectorById(id)),
    upsertConnector: (connector) => {
      const clientSecret = connector.clientRegistration?.clientSecret;
      if (clientSecret) {
        secureStorage.set(connectorClientSecretKey(connector.id), clientSecret);
      }
      repoUpsertConnector(stripClientSecret(connector));
    },
    setConnectorEnabled: (id, enabled) => repoSetConnectorEnabled(id, enabled),
    setConnectorStatus: (id, status) => repoSetConnectorStatus(id, status),
    deleteConnector: (id) => {
      secureStorage.delete(connectorClientSecretKey(id));
      secureStorage.delete(connectorTokensKey(id));
      repoDeleteConnector(id);
    },
    clearAllConnectors: () => {
      clearConnectorSecretsFromSecureStorage();
      repoClearAllConnectors();
    },
    storeConnectorTokens: (connectorId, tokens) =>
      secureStorage.set(connectorTokensKey(connectorId), JSON.stringify(tokens)),
    getConnectorTokens: (connectorId) => {
      const stored = secureStorage.get(connectorTokensKey(connectorId));
      if (!stored) return null;
      try {
        return JSON.parse(stored) as OAuthTokens;
      } catch {
        console.error(`Failed to parse connector tokens for ${connectorId}`);
        return null;
      }
    },
    deleteConnectorTokens: (connectorId) => secureStorage.delete(connectorTokensKey(connectorId)),

    // Secure Storage
    storeApiKey: (provider, apiKey) => secureStorage.storeApiKey(provider, apiKey),
    getApiKey: (provider) => secureStorage.getApiKey(provider),
    deleteApiKey: (provider) => secureStorage.deleteApiKey(provider),
    getAllApiKeys: () => secureStorage.getAllApiKeys(),
    storeBedrockCredentials: (credentials) => secureStorage.storeBedrockCredentials(credentials),
    getBedrockCredentials: () => secureStorage.getBedrockCredentials(),
    hasAnyApiKey: () => secureStorage.hasAnyApiKey(),
    listStoredCredentials: () => secureStorage.listStoredCredentials(),
    clearSecureStorage: () => secureStorage.clearSecureStorage(),

    // Lifecycle
    initialize() {
      if (initialized && isDatabaseInitialized()) {
        return;
      }
      const dbPath = databasePath || `${storagePath}/agent-core.db`;
      initializeDatabase({ databasePath: dbPath, runMigrations });
      migrateConnectorClientSecretsToSecureStorage();
      initialized = true;
    },
    close() {
      closeDatabase();
      initialized = false;
    },
    isDatabaseInitialized: () => isDatabaseInitialized(),
    getDatabasePath: () => getDatabasePath(),
  };
}

export type { StorageAPI, StorageOptions };
