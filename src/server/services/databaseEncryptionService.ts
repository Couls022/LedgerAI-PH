import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';

const LAIS_MAGIC_HEADER = Buffer.from('LAISENC1', 'ascii'); // 8 bytes
const MASTER_SECRET = process.env.LEDGERAI_MASTER_KEY || 'ledgerai-ph-enterprise-secure-master-encryption-key-2026';

export class DatabaseEncryptionService {
  /**
   * Derives a 32-byte encryption key using PBKDF2 with a salt.
   */
  private static deriveKey(salt: Buffer): Buffer {
    return crypto.pbkdf2Sync(MASTER_SECRET, salt, 100000, 32, 'sha256');
  }

  /**
   * Checks if a file is an encrypted LedgerAI database container (starts with LAISENC1).
   */
  public static async isEncryptedLai(filePath: string): Promise<boolean> {
    try {
      const handle = await fs.open(filePath, 'r');
      const headerBuf = Buffer.alloc(8);
      await handle.read(headerBuf, 0, 8, 0);
      await handle.close();
      return headerBuf.equals(LAIS_MAGIC_HEADER);
    } catch {
      return false;
    }
  }

  /**
   * Synchronously checks if a file is an encrypted LedgerAI database container.
   */
  public static isEncryptedLaiSync(filePath: string): boolean {
    try {
      const fd = fsSync.openSync(filePath, 'r');
      const headerBuf = Buffer.alloc(8);
      fsSync.readSync(fd, headerBuf, 0, 8, 0);
      fsSync.closeSync(fd);
      return headerBuf.equals(LAIS_MAGIC_HEADER);
    } catch {
      return false;
    }
  }

  /**
   * Safely replaces target destination file with tempPath, handling Windows file locking and transient replacement errors.
   */
  private static async safeReplaceFile(tempPath: string, destPath: string): Promise<void> {
    try {
      let lastError: any = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await fs.rename(tempPath, destPath);
          return;
        } catch (err: any) {
          lastError = err;
          if (['EPERM', 'EBUSY', 'EACCES', 'EEXIST'].includes(err.code)) {
            await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
            if (attempt >= 2) {
              try {
                await fs.unlink(destPath);
              } catch {}
            }
          } else {
            break;
          }
        }
      }

      // Fallback: copyFile + unlink tempPath
      try {
        await fs.copyFile(tempPath, destPath);
        await fs.unlink(tempPath).catch(() => {});
        return;
      } catch (copyErr) {
        throw lastError || copyErr;
      }
    } catch (err) {
      await fs.unlink(tempPath).catch(() => {});
      throw err;
    }
  }

  /**
   * Synchronously and safely replaces target destination file with tempPath on Windows.
   */
  private static safeReplaceFileSync(tempPath: string, destPath: string): void {
    try {
      let lastError: any = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          fsSync.renameSync(tempPath, destPath);
          return;
        } catch (err: any) {
          lastError = err;
          if (['EPERM', 'EBUSY', 'EACCES', 'EEXIST'].includes(err.code)) {
            const start = Date.now();
            while (Date.now() - start < 25 * (attempt + 1)) {}
            if (attempt >= 2) {
              try {
                fsSync.unlinkSync(destPath);
              } catch {}
            }
          } else {
            break;
          }
        }
      }

      // Fallback: copyFileSync + unlinkSync tempPath
      try {
        fsSync.copyFileSync(tempPath, destPath);
        try { fsSync.unlinkSync(tempPath); } catch {}
        return;
      } catch (copyErr) {
        throw lastError || copyErr;
      }
    } catch (err) {
      try { fsSync.unlinkSync(tempPath); } catch {}
      throw err;
    }
  }

  /**
   * Encrypts a plaintext SQLite database file into an encrypted .lai container.
   */
  public static async encryptDatabaseFile(sourceSqlitePath: string, destLaiPath: string): Promise<void> {
    const tempPath = `${destLaiPath}.tmp`;
    try {
      const sqliteBuffer = await fs.readFile(sourceSqlitePath);
      
      const salt = crypto.randomBytes(16);
      const iv = crypto.randomBytes(12);
      const key = this.deriveKey(salt);

      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(sqliteBuffer), cipher.final()]);
      const authTag = cipher.getAuthTag();

      // Format: Magic (8) + Salt (16) + IV (12) + AuthTag (16) + Ciphertext
      const finalBuffer = Buffer.concat([
        LAIS_MAGIC_HEADER,
        salt,
        iv,
        authTag,
        encrypted
      ]);

      await fs.writeFile(tempPath, finalBuffer);
      await this.safeReplaceFile(tempPath, destLaiPath);
    } catch (err) {
      await fs.unlink(tempPath).catch(() => {});
      throw err;
    }
  }

  /**
   * Decrypts an encrypted .lai container into a plaintext SQLite database file.
   */
  public static async decryptDatabaseFile(sourceLaiPath: string, destSqlitePath: string): Promise<boolean> {
    const fileBuffer = await fs.readFile(sourceLaiPath);

    if (fileBuffer.length < 52) {
      throw new Error("INVALID_ENCRYPTED_DATABASE: File is too small to be a valid encrypted .lai container.");
    }

    const magic = fileBuffer.subarray(0, 8);
    if (!magic.equals(LAIS_MAGIC_HEADER)) {
      // Not encrypted, might be legacy plaintext SQLite or unencrypted .lai
      return false;
    }

    const salt = fileBuffer.subarray(8, 24);
    const iv = fileBuffer.subarray(24, 36);
    const authTag = fileBuffer.subarray(36, 52);
    const ciphertext = fileBuffer.subarray(52);

    const key = this.deriveKey(salt);

    const tempPath = `${destSqlitePath}.tmp`;
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

      await fs.writeFile(tempPath, decrypted);
      await this.safeReplaceFile(tempPath, destSqlitePath);
      return true;
    } catch (err: any) {
      await fs.unlink(tempPath).catch(() => {});
      if (err.message && err.message.startsWith("INVALID_ENCRYPTED_DATABASE")) {
        throw err;
      }
      throw new Error(`DECRYPTION_FAILED: Failed to decrypt workspace database. Key mismatch or corrupted/tampered file: ${err.message}`);
    }
  }

  /**
   * Synchronous decryption for startup/opening
   */
  public static decryptDatabaseFileSync(sourceLaiPath: string, destSqlitePath: string): boolean {
    const fileBuffer = fsSync.readFileSync(sourceLaiPath);

    if (fileBuffer.length < 52) {
      throw new Error("INVALID_ENCRYPTED_DATABASE: File is too small to be a valid encrypted .lai container.");
    }

    const magic = fileBuffer.subarray(0, 8);
    if (!magic.equals(LAIS_MAGIC_HEADER)) {
      return false;
    }

    const salt = fileBuffer.subarray(8, 24);
    const iv = fileBuffer.subarray(24, 36);
    const authTag = fileBuffer.subarray(36, 52);
    const ciphertext = fileBuffer.subarray(52);

    const key = this.deriveKey(salt);

    const tempPath = `${destSqlitePath}.tmp`;
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

      fsSync.writeFileSync(tempPath, decrypted);
      this.safeReplaceFileSync(tempPath, destSqlitePath);
      return true;
    } catch (err: any) {
      try { fsSync.unlinkSync(tempPath); } catch {}
      if (err.message && err.message.startsWith("INVALID_ENCRYPTED_DATABASE")) {
        throw err;
      }
      throw new Error(`DECRYPTION_FAILED: Failed to decrypt workspace database. Key mismatch or corrupted/tampered file: ${err.message}`);
    }
  }

  /**
   * Synchronous encryption for shutdown/saving
   */
  public static encryptDatabaseFileSync(sourceSqlitePath: string, destLaiPath: string): void {
    const tempPath = `${destLaiPath}.tmp`;
    try {
      const sqliteBuffer = fsSync.readFileSync(sourceSqlitePath);
      
      const salt = crypto.randomBytes(16);
      const iv = crypto.randomBytes(12);
      const key = this.deriveKey(salt);

      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(sqliteBuffer), cipher.final()]);
      const authTag = cipher.getAuthTag();

      const finalBuffer = Buffer.concat([
        LAIS_MAGIC_HEADER,
        salt,
        iv,
        authTag,
        encrypted
      ]);

      fsSync.writeFileSync(tempPath, finalBuffer);
      this.safeReplaceFileSync(tempPath, destLaiPath);
    } catch (err) {
      try { fsSync.unlinkSync(tempPath); } catch {}
      throw err;
    }
  }
}
