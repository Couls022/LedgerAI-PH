import fs from 'fs';
import path from 'path';
import { paths } from './paths';
import { DatabaseEncryptionService } from './databaseEncryptionService';
import { OperationalLogger } from './operationalLogger';
import { AntiRollbackService } from './antiRollbackService';

export class StartupValidator {
  public static validate(): { success: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Validate Master Encryption Key configuration
    const masterKey = process.env.LEDGERAI_MASTER_KEY;
    if (!masterKey) {
      warnings.push("LEDGERAI_MASTER_KEY environment variable not set. Falling back to default secure enterprise master key.");
    } else if (masterKey.length < 16) {
      errors.push("LEDGERAI_MASTER_KEY is too short (minimum 16 characters required for secure encryption).");
    }

    // 2. Validate temporary directory writability
    try {
      const tempDir = paths.getTempDir();
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      const testFilePath = path.join(tempDir, `startup-test-${Date.now()}.tmp`);
      fs.writeFileSync(testFilePath, 'OK');
      fs.unlinkSync(testFilePath);
    } catch (err: any) {
      errors.push(`Temporary directory is not writable: ${err.message}`);
    }

    // 3. Validate workspace root and data directory existence
    try {
      const dataDir = paths.getDataDir();
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
    } catch (err: any) {
      errors.push(`Data directory cannot be created or accessed: ${err.message}`);
    }

    // 4. Validate system clock integrity via Anti-Rollback check
    try {
      const fsTime = AntiRollbackService.getFilesystemMaxTimestamp();
      const now = Date.now();
      if (fsTime > 0 && now < fsTime - 60000) {
        warnings.push(`System clock rollback warning: Local system time (${new Date(now).toISOString()}) is earlier than recorded system filesystem state (${new Date(fsTime).toISOString()}).`);
      }
    } catch (err: any) {
      // Non-fatal
    }

    // 5. Node environment check
    const nodeEnv = process.env.NODE_ENV || 'development';
    OperationalLogger.info('Startup validation executed', { nodeEnv, warningCount: warnings.length, criticalCount: errors.length });

    return {
      success: errors.length === 0,
      errors,
      warnings
    };
  }
}
