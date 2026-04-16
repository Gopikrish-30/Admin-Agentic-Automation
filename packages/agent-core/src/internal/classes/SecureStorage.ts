import * as crypto from 'crypto';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import type { ApiKeyProvider } from '../../common/types/provider.js';

/**
 * AES-256-GCM encryption using machine-derived keys. Less secure than OS Keychain
 * (key derivation is reversible) but avoids permission prompts on macOS.
 * Suitable for API keys that can be rotated if compromised.
 */
export interface SecureStorageOptions {
  storagePath: string;
  appId: string;
  fileName?: string;
  /**
   * Optional OS-level encryption for the master key (e.g., Electron safeStorage).
   * When provided, uses OS keychain/vault instead of machine-derived keys.
   */
  osEncrypt?: (plaintext: Buffer) => Buffer;
  osDecrypt?: (ciphertext: Buffer) => Buffer;
}

interface SecureStorageSchema {
  values: Record<string, string>;
  salt?: string;
  masterKeyEncrypted?: string; // Base64-encoded OS-encrypted master key
  keyVersion?: number; // 1 = machine-derived (legacy), 2 = OS-encrypted
}

export type { ApiKeyProvider };

export class SecureStorage {
  private storagePath: string;
  private appId: string;
  private filePath: string;
  private derivedKey: Buffer | null = null;
  private masterKey: Buffer | null = null;
  private data: SecureStorageSchema | null = null;
  private osEncrypt?: (plaintext: Buffer) => Buffer;
  private osDecrypt?: (ciphertext: Buffer) => Buffer;
  private vaultRecoveryAttempted = false;

  constructor(options: SecureStorageOptions) {
    this.storagePath = options.storagePath;
    this.appId = options.appId;
    this.filePath = path.join(this.storagePath, options.fileName || 'secure-storage.json');
    this.osEncrypt = options.osEncrypt;
    this.osDecrypt = options.osDecrypt;
  }

  private loadData(): SecureStorageSchema {
    if (this.data) {
      return this.data;
    }

    try {
      if (fs.existsSync(this.filePath)) {
        const content = fs.readFileSync(this.filePath, 'utf-8');
        this.data = JSON.parse(content) as SecureStorageSchema;
      } else {
        this.data = { values: {} };
      }
    } catch {
      this.data = { values: {} };
    }

    return this.data;
  }

  private saveData(): void {
    if (!this.data) return;

    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Atomic write: write to temp file, then rename
    // This prevents data loss if the process crashes mid-write
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    const content = JSON.stringify(this.data, null, 2);

    try {
      fs.writeFileSync(tempPath, content, { mode: 0o600 });
      fs.renameSync(tempPath, this.filePath);
    } catch (error) {
      // Clean up temp file if rename fails
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  private getSalt(): Buffer {
    const data = this.loadData();

    if (!data.salt) {
      const salt = crypto.randomBytes(32);
      data.salt = salt.toString('base64');
      this.saveData();
    }

    return Buffer.from(data.salt, 'base64');
  }

  private resetAfterVaultDecryptionFailure(data: SecureStorageSchema): Buffer {
    if (this.vaultRecoveryAttempted) {
      // Avoid repeated vault operations when the credential store is unavailable.
      this.osEncrypt = undefined;
      this.osDecrypt = undefined;
    }
    this.vaultRecoveryAttempted = true;

    console.warn(
      '[SecureStorage] Resetting secure storage after OS vault decryption failure. Stored secrets will need to be re-entered.',
    );

    data.values = {};
    delete data.masterKeyEncrypted;
    delete data.keyVersion;
    delete data.salt;
    this.masterKey = null;
    this.derivedKey = null;

    if (this.osEncrypt) {
      try {
        const newMasterKey = crypto.randomBytes(32);
        const encryptedMasterKey = this.osEncrypt(newMasterKey);
        data.masterKeyEncrypted = encryptedMasterKey.toString('base64');
        data.keyVersion = 2;
        this.masterKey = newMasterKey;
        this.saveData();
        return this.masterKey;
      } catch (error) {
        console.warn(
          '[SecureStorage] OS vault encryption unavailable during recovery. Falling back to machine-derived key.',
          error,
        );

        // Disable vault usage for this process so we do not repeatedly fail.
        this.osEncrypt = undefined;
        this.osDecrypt = undefined;
      }
    }

    const machineData = [os.platform(), os.homedir(), os.userInfo().username, this.appId].join(':');
    try {
      const salt = this.getSalt();
      this.derivedKey = crypto.pbkdf2Sync(machineData, salt, 100000, 32, 'sha256');
      this.saveData();
    } catch (error) {
      // Last-resort fallback: keep the app usable even if persistence is temporarily unavailable.
      console.warn('[SecureStorage] Failed to persist recovery state. Using in-memory key fallback.', error);
      const ephemeralSalt = crypto.randomBytes(32);
      this.derivedKey = crypto.pbkdf2Sync(machineData, ephemeralSalt, 100000, 32, 'sha256');
    }
    return this.derivedKey;
  }

  /**
   * Get the master encryption key - either from OS keychain or machine-derived fallback
   */
  private getMasterKey(): Buffer {
    if (this.masterKey) {
      return this.masterKey;
    }

    const data = this.loadData();

    // Version 2: OS-encrypted master key (existing storage)
    if (data.keyVersion === 2 && data.masterKeyEncrypted && this.osDecrypt) {
      try {
        const encryptedBuffer = Buffer.from(data.masterKeyEncrypted, 'base64');
        this.masterKey = this.osDecrypt(encryptedBuffer);
        return this.masterKey;
      } catch (error) {
        console.error('[SecureStorage] Failed to decrypt master key from OS vault:', error);
        return this.resetAfterVaultDecryptionFailure(data);
      }
    }

    // Initialize with OS encryption if available and no keys exist yet
    if (this.osEncrypt && !data.keyVersion && Object.keys(data.values).length === 0) {
      try {
        const newMasterKey = crypto.randomBytes(32);
        const encryptedMasterKey = this.osEncrypt(newMasterKey);
        data.masterKeyEncrypted = encryptedMasterKey.toString('base64');
        data.keyVersion = 2;
        this.masterKey = newMasterKey;
        this.saveData();
        return this.masterKey;
      } catch (error) {
        console.warn(
          '[SecureStorage] OS vault encryption unavailable during initialization. Falling back to machine-derived key.',
          error,
        );
        this.osEncrypt = undefined;
        this.osDecrypt = undefined;
      }
    }

    // Version 1 or no version (legacy): Machine-derived key
    if (this.derivedKey) {
      return this.derivedKey;
    }

    const machineData = [os.platform(), os.homedir(), os.userInfo().username, this.appId].join(':');
    const salt = this.getSalt();
    this.derivedKey = crypto.pbkdf2Sync(machineData, salt, 100000, 32, 'sha256');

    // Migrate to OS-encrypted storage if callbacks are available and not already migrated
    if (this.osEncrypt && !data.keyVersion && Object.keys(data.values).length > 0) {
      try {
        this.migrateToOSEncryption();
        return this.masterKey!; // After migration, masterKey is set
      } catch (error) {
        console.warn(
          '[SecureStorage] OS vault migration unavailable. Continuing with machine-derived key.',
          error,
        );
        this.osEncrypt = undefined;
        this.osDecrypt = undefined;
      }
    }

    return this.derivedKey;
  }

  /**
   * Migrate from machine-derived key to OS-encrypted master key
   */
  private migrateToOSEncryption(): void {
    if (!this.osEncrypt || !this.derivedKey) {
      return;
    }

    const data = this.loadData();
    if (data.keyVersion === 2) {
      return; // Already migrated
    }

    console.log('[SecureStorage] Migrating to OS-encrypted master key...');

    try {
      const legacyKey = this.derivedKey;

      // Generate new random master key
      const newMasterKey = crypto.randomBytes(32);

      // Re-encrypt all values with the new key
      const decryptedValues: Record<string, string> = {};
      for (const [key, encryptedValue] of Object.entries(data.values)) {
        const decrypted = this.decryptWithKey(encryptedValue, legacyKey);
        if (decrypted) {
          decryptedValues[key] = decrypted;
        }
      }

      // Encrypt master key with OS vault
      const encryptedMasterKey = this.osEncrypt(newMasterKey);
      data.masterKeyEncrypted = encryptedMasterKey.toString('base64');
      data.keyVersion = 2;

      // Switch to new master key
      this.masterKey = newMasterKey;
      this.derivedKey = null;

      // Re-encrypt all values
      data.values = {};
      for (const [key, value] of Object.entries(decryptedValues)) {
        data.values[key] = this.encryptWithKey(value, newMasterKey);
      }

      this.saveData();
      console.log('[SecureStorage] Successfully migrated to OS-encrypted master key');
      
      // Clear cache to force fresh load on next access
      this.data = null;
    } catch (error) {
      console.error('[SecureStorage] Migration to OS encryption failed:', error);
      // Revert to machine-derived key on error
      this.masterKey = null;
      throw error;
    }
  }

  private encryptWithKey(value: string, key: Buffer): string {
    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    let encrypted = cipher.update(value, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    const authTag = cipher.getAuthTag();

    return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
  }

  private decryptWithKey(encryptedData: string, key: Buffer): string | null {
    try {
      const parts = encryptedData.split(':');
      if (parts.length !== 3) {
        return null;
      }

      const [ivBase64, authTagBase64, ciphertext] = parts;
      const iv = Buffer.from(ivBase64, 'base64');
      const authTag = Buffer.from(authTagBase64, 'base64');

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch {
      return null;
    }
  }

  private encryptValue(value: string): string {
    const key = this.getMasterKey();
    return this.encryptWithKey(value, key);
  }

  private decryptValue(encryptedData: string): string | null {
    // Get master key outside try/catch so OS decryption errors are propagated
    const key = this.getMasterKey();
    return this.decryptWithKey(encryptedData, key);
  }

  storeApiKey(provider: string, apiKey: string): void {
    const data = this.loadData();
    const encrypted = this.encryptValue(apiKey);
    data.values[`apiKey:${provider}`] = encrypted;
    this.saveData();
  }

  getApiKey(provider: string): string | null {
    // Ensure key initialization/migration happens before reading ciphertext.
    this.getMasterKey();

    const data = this.loadData();
    const encrypted = data.values[`apiKey:${provider}`];
    if (!encrypted) {
      return null;
    }
    return this.decryptValue(encrypted);
  }

  deleteApiKey(provider: string): boolean {
    const data = this.loadData();
    const key = `apiKey:${provider}`;
    if (!(key in data.values)) {
      return false;
    }
    delete data.values[key];
    this.saveData();
    return true;
  }

  async getAllApiKeys(): Promise<Record<ApiKeyProvider, string | null>> {
    const providers: ApiKeyProvider[] = [
      'anthropic',
      'openai',
      'openrouter',
      'google',
      'xai',
      'deepseek',
      'moonshot',
      'zai',
      'azure-foundry',
      'custom',
      'bedrock',
      'litellm',
      'minimax',
      'lmstudio',
      'groq',
      'elevenlabs',
    ];

    const result: Record<string, string | null> = {};
    for (const provider of providers) {
      result[provider] = this.getApiKey(provider);
    }

    return result as Record<ApiKeyProvider, string | null>;
  }

  storeBedrockCredentials(credentials: string): void {
    this.storeApiKey('bedrock', credentials);
  }

  getBedrockCredentials(): Record<string, string> | null {
    const stored = this.getApiKey('bedrock');
    if (!stored) return null;
    try {
      return JSON.parse(stored);
    } catch {
      return null;
    }
  }

  async hasAnyApiKey(): Promise<boolean> {
    const keys = await this.getAllApiKeys();
    return Object.values(keys).some((k) => k !== null);
  }

  listStoredCredentials(): Array<{ account: string; password: string }> {
    const data = this.loadData();
    const credentials: Array<{ account: string; password: string }> = [];

    for (const key of Object.keys(data.values)) {
      const decrypted = this.decryptValue(data.values[key]);
      if (decrypted) {
        credentials.push({
          account: key,
          password: decrypted,
        });
      }
    }

    return credentials;
  }

  clearSecureStorage(): void {
    this.data = { values: {} };
    this.derivedKey = null;
      this.masterKey = null;
    this.saveData();
  }

  set(key: string, value: string): void {
    const data = this.loadData();
    data.values[key] = this.encryptValue(value);
    this.saveData();
  }

  get(key: string): string | null {
    const data = this.loadData();
    const encrypted = data.values[key];
    if (!encrypted) {
      return null;
    }
    return this.decryptValue(encrypted);
  }

  delete(key: string): boolean {
    const data = this.loadData();
    if (!(key in data.values)) {
      return false;
    }
    delete data.values[key];
    this.saveData();
    return true;
  }

  has(key: string): boolean {
    const data = this.loadData();
    return key in data.values;
  }
}

export function createSecureStorage(options: SecureStorageOptions): SecureStorage {
  return new SecureStorage(options);
}
