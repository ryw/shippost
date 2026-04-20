import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from 'crypto';
import { hostname, userInfo } from 'os';

/**
 * Encrypted token storage format
 */
export interface EncryptedData {
  version: number;
  encrypted: string;
}

/**
 * SecureTokenStorage provides encryption-at-rest for sensitive data like OAuth tokens.
 *
 * Uses AES-256-GCM encryption with a key derived from machine-specific identifiers.
 * This ensures tokens are only decryptable on the same machine by the same user.
 */
export class SecureTokenStorage {
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly KEY_LENGTH = 32;
  private static readonly IV_LENGTH = 16;
  private static readonly AUTH_TAG_LENGTH = 16;
  private static readonly VERSION = 1;
  private static readonly SALT = 'shippost-token-encryption-v1';

  /**
   * Get a machine-specific encryption key.
   *
   * The key is derived from machine and user identifiers, making tokens
   * only decryptable on the same machine by the same user.
   */
  private getEncryptionKey(): Buffer {
    // Combine multiple machine/user identifiers for key derivation
    // This ensures tokens can't be decrypted if the file is copied to another machine
    const machineId = this.getMachineIdentifier();
    return scryptSync(machineId, SecureTokenStorage.SALT, SecureTokenStorage.KEY_LENGTH);
  }

  /**
   * Generate a machine-specific identifier for key derivation.
   *
   * Uses a combination of:
   * - Hostname
   * - Username
   * - Home directory
   *
   * This isn't meant to be unguessable - it's defense in depth.
   * The primary security comes from file permissions (0o600).
   */
  private getMachineIdentifier(): string {
    const user = userInfo();
    const components = [
      hostname(),
      user.username,
      user.homedir,
      // Add a constant to make the key unique to this application
      'shippost-oauth-v1',
    ];

    // Hash the components to get a consistent length identifier
    const hash = createHash('sha256');
    hash.update(components.join('|'));
    return hash.digest('hex');
  }

  /**
   * Encrypt data using AES-256-GCM.
   *
   * @param data - The data object to encrypt
   * @returns Encrypted data wrapper with version info
   */
  encrypt<T>(data: T): EncryptedData {
    const key = this.getEncryptionKey();
    const iv = randomBytes(SecureTokenStorage.IV_LENGTH);
    const cipher = createCipheriv(SecureTokenStorage.ALGORITHM, key, iv);

    const plaintext = JSON.stringify(data);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    // Combine IV + auth tag + ciphertext into a single base64 string
    const combined = Buffer.concat([iv, authTag, encrypted]);

    return {
      version: SecureTokenStorage.VERSION,
      encrypted: combined.toString('base64'),
    };
  }

  /**
   * Decrypt data that was encrypted with encrypt().
   *
   * @param encryptedData - The encrypted data wrapper
   * @returns The decrypted data object, or null if decryption fails
   */
  decrypt<T>(encryptedData: EncryptedData): T | null {
    try {
      if (encryptedData.version !== SecureTokenStorage.VERSION) {
        // Unknown version - can't decrypt
        return null;
      }

      const key = this.getEncryptionKey();
      const combined = Buffer.from(encryptedData.encrypted, 'base64');

      // Extract IV, auth tag, and ciphertext
      const iv = combined.subarray(0, SecureTokenStorage.IV_LENGTH);
      const authTag = combined.subarray(
        SecureTokenStorage.IV_LENGTH,
        SecureTokenStorage.IV_LENGTH + SecureTokenStorage.AUTH_TAG_LENGTH
      );
      const ciphertext = combined.subarray(
        SecureTokenStorage.IV_LENGTH + SecureTokenStorage.AUTH_TAG_LENGTH
      );

      const decipher = createDecipheriv(SecureTokenStorage.ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);

      return JSON.parse(decrypted.toString('utf8')) as T;
    } catch {
      // Decryption failed - likely wrong key (different machine/user)
      // or corrupted data
      return null;
    }
  }

  /**
   * Check if data looks like it's in encrypted format.
   *
   * @param data - The data to check
   * @returns true if the data appears to be encrypted
   */
  isEncrypted(data: unknown): data is EncryptedData {
    return (
      typeof data === 'object' &&
      data !== null &&
      'version' in data &&
      'encrypted' in data &&
      typeof (data as EncryptedData).version === 'number' &&
      typeof (data as EncryptedData).encrypted === 'string'
    );
  }
}
