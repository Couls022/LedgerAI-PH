const { DatabaseEncryptionService } = require('./dist/server.cjs').DatabaseEncryptionService || {};
const fs = require('fs');

if (!DatabaseEncryptionService) {
    // If not exported, let's just write the code inline
    const crypto = require('crypto');
    const LAIS_MAGIC_HEADER = Buffer.from('LAISENC1', 'ascii');
    const MASTER_SECRET = process.env.LEDGERAI_MASTER_KEY || 'ledgerai-ph-enterprise-secure-master-encryption-key-2026';
    
    function deriveKey(salt) {
      return crypto.pbkdf2Sync(MASTER_SECRET, salt, 100000, 32, 'sha256');
    }
    
    function decryptDatabaseFileSync(sourceLaiPath, destSqlitePath) {
      const fileBuffer = fs.readFileSync(sourceLaiPath);
      const magic = fileBuffer.subarray(0, 8);
      const salt = fileBuffer.subarray(8, 24);
      const iv = fileBuffer.subarray(24, 36);
      const authTag = fileBuffer.subarray(36, 52);
      const ciphertext = fileBuffer.subarray(52);
      const key = deriveKey(salt);
      try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        fs.writeFileSync(destSqlitePath, decrypted);
        return true;
      } catch (err) {
        throw new Error(`DECRYPTION_FAILED: Failed to decrypt workspace database. Key mismatch or corrupted/tampered file: ${err.message}`);
      }
    }
    
    try {
        decryptDatabaseFileSync('data/companies/LGR-PH-2026-COR-00-59CEAD34/database.lai', 'data/companies/LGR-PH-2026-COR-00-59CEAD34/database.sqlite');
        console.log("Decrypted successfully!");
    } catch(e) {
        console.log("Error:", e.message);
    }
}
