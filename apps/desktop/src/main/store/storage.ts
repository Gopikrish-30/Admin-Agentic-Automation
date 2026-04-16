import * as electron from 'electron';
import path from 'path';
import { createStorage, type StorageAPI } from '@navigator_ai/agent-core';
// Deep import for legacy migration only — getDatabase is intentionally not part of StorageAPI
import { getDatabase as coreGetDatabase } from '@navigator_ai/agent-core/storage/database';
import type { Database } from 'better-sqlite3';
import { importLegacyElectronStoreData } from './electronStoreImport';

let _storage: StorageAPI | null = null;

export function getDatabasePath(): string {
  const dbName = electron.app.isPackaged ? 'navigator.db' : 'navigator-dev.db';
  return path.join(electron.app.getPath('userData'), dbName);
}

export function getStorage(): StorageAPI {
  if (!_storage) {
    // Use OS credential vault (Keychain/DPAPI/libsecret) when available.
    let safeStorage: typeof electron.safeStorage | undefined;
    try {
      safeStorage = (
        electron as unknown as {
          safeStorage?: typeof electron.safeStorage;
        }
      ).safeStorage;
    } catch {
      safeStorage = undefined;
    }

    const osEncryptionCallbacks =
      safeStorage &&
      typeof safeStorage.isEncryptionAvailable === 'function' &&
      typeof safeStorage.encryptString === 'function' &&
      typeof safeStorage.decryptString === 'function' &&
      safeStorage.isEncryptionAvailable()
        ? {
            osEncrypt: (plaintext: Buffer) => safeStorage.encryptString(plaintext.toString('base64')),
            osDecrypt: (ciphertext: Buffer) => {
              const decrypted = safeStorage.decryptString(ciphertext);
              return Buffer.from(decrypted, 'base64');
            },
          }
        : {};

    _storage = createStorage({
      databasePath: getDatabasePath(),
      runMigrations: true,
      userDataPath: electron.app.getPath('userData'),
      secureStorageFileName: electron.app.isPackaged
        ? 'secure-storage.json'
        : 'secure-storage-dev.json',
      ...osEncryptionCallbacks,
    });
  }
  return _storage;
}

/**
 * Initialize both the database and secure storage.
 * On first run, also imports data from the legacy electron-store format.
 */
export function initializeStorage(): void {
  const storage = getStorage();
  if (!storage.isDatabaseInitialized()) {
    storage.initialize();

    // One-time legacy data import from old electron-store format
    const db: Database = coreGetDatabase();
    importLegacyElectronStoreData(db);
  }
}

export function closeStorage(): void {
  if (_storage) {
    _storage.close();
    _storage = null;
  }
}

/**
 * Reset the storage singleton after CLEAN_START deletes the userData directory.
 * Closes the open database handle before nulling the reference.
 */
export function resetStorageSingleton(): void {
  if (_storage) {
    _storage.close();
    _storage = null;
  }
}
