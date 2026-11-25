import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { DatabaseEncryptionService } from '../../src/server/services/databaseEncryptionService';

describe('Phase G — LAISENC2 Envelope Metadata & Payload Tampering Adversarial Suite (DEF-ADV-003)', () => {
  let tempDir: string;
  const companyId = 'LGR-TAMPER-TEST-01';
  let sourceDbPath: string;
  let laiPath: string;
  let decryptedDbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledgerai-tamper-'));
    sourceDbPath = path.join(tempDir, 'source.sqlite');
    laiPath = path.join(tempDir, 'database.lai');
    decryptedDbPath = path.join(tempDir, 'decrypted.sqlite');

    const db = new Database(sourceDbPath);
    db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT);');
    db.exec("INSERT INTO test (val) VALUES ('tamper-proof-payload');");
    db.close();

    DatabaseEncryptionService.encryptDatabaseFileSync(sourceDbPath, laiPath, {
      companyId,
      classification: 'PRODUCTION',
      keyMode: 'OS_KEYCHAIN_STANDALONE',
    });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function tamperMetaField(mutator: (meta: any) => void): string {
    const fileBuffer = fs.readFileSync(laiPath);
    const magic = fileBuffer.subarray(0, 8);
    const metaLen = fileBuffer.readUInt32BE(8);
    const metaEnd = 12 + metaLen;
    const meta = JSON.parse(fileBuffer.subarray(12, metaEnd).toString('utf8'));
    const ciphertext = fileBuffer.subarray(metaEnd);

    mutator(meta);

    const newMetaBytes = Buffer.from(JSON.stringify(meta), 'utf8');
    const newMetaLenBuf = Buffer.alloc(4);
    newMetaLenBuf.writeUInt32BE(newMetaBytes.length, 0);

    const tamperedBuffer = Buffer.concat([magic, newMetaLenBuf, newMetaBytes, ciphertext]);
    const tamperedPath = path.join(tempDir, `tampered-${Date.now()}-${Math.random().toString(36).slice(2)}.lai`);
    fs.writeFileSync(tamperedPath, tamperedBuffer);
    return tamperedPath;
  }

  it('1. rejects decryption when companyId in envelope metadata is tampered', () => {
    const tamperedPath = tamperMetaField((m) => {
      m.companyId = 'LGR-TAMPERED-COMPANY-99';
    });
    expect(() => {
      DatabaseEncryptionService.decryptDatabaseFileSync(tamperedPath, decryptedDbPath);
    }).toThrow(/DECRYPTION_FAILED/);
    expect(fs.existsSync(decryptedDbPath)).toBe(false);
  });

  it('2. rejects decryption when keyVersion in envelope metadata is tampered', () => {
    const tamperedPath = tamperMetaField((m) => {
      m.keyVersion = 999;
    });
    expect(() => {
      DatabaseEncryptionService.decryptDatabaseFileSync(tamperedPath, decryptedDbPath);
    }).toThrow(/DECRYPTION_FAILED/);
  });

  it('3. rejects decryption when keyId in envelope metadata is tampered', () => {
    const tamperedPath = tamperMetaField((m) => {
      m.keyId = 'tampered-key-id-999';
    });
    expect(() => {
      DatabaseEncryptionService.decryptDatabaseFileSync(tamperedPath, decryptedDbPath);
    }).toThrow(/DECRYPTION_FAILED/);
  });

  it('4. rejects decryption when keyMode in envelope metadata is tampered', () => {
    const tamperedPath = tamperMetaField((m) => {
      m.keyMode = 'LEGACY_DEV_KEY';
    });
    expect(() => {
      DatabaseEncryptionService.decryptDatabaseFileSync(tamperedPath, decryptedDbPath);
    }).toThrow(/DECRYPTION_FAILED/);
  });

  it('5. rejects decryption when container version in envelope metadata is tampered', () => {
    const tamperedPath = tamperMetaField((m) => {
      m.version = 1;
    });
    expect(() => {
      DatabaseEncryptionService.decryptDatabaseFileSync(tamperedPath, decryptedDbPath);
    }).toThrow(/DECRYPTION_FAILED/);
  });

  it('6. rejects decryption when wrapIvHex is tampered', () => {
    const tamperedPath = tamperMetaField((m) => {
      const ivBuf = Buffer.from(m.wrapIvHex, 'hex');
      ivBuf[0] ^= 0xff;
      m.wrapIvHex = ivBuf.toString('hex');
    });
    expect(() => {
      DatabaseEncryptionService.decryptDatabaseFileSync(tamperedPath, decryptedDbPath);
    }).toThrow(/DECRYPTION_FAILED/);
  });

  it('7. rejects decryption when wrapTagHex is tampered', () => {
    const tamperedPath = tamperMetaField((m) => {
      const tagBuf = Buffer.from(m.wrapTagHex, 'hex');
      tagBuf[0] ^= 0xff;
      m.wrapTagHex = tagBuf.toString('hex');
    });
    expect(() => {
      DatabaseEncryptionService.decryptDatabaseFileSync(tamperedPath, decryptedDbPath);
    }).toThrow(/DECRYPTION_FAILED/);
  });

  it('8. rejects decryption when wrappedDekHex is tampered', () => {
    const tamperedPath = tamperMetaField((m) => {
      const dekBuf = Buffer.from(m.wrappedDekHex, 'hex');
      dekBuf[0] ^= 0xff;
      m.wrappedDekHex = dekBuf.toString('hex');
    });
    expect(() => {
      DatabaseEncryptionService.decryptDatabaseFileSync(tamperedPath, decryptedDbPath);
    }).toThrow(/DECRYPTION_FAILED/);
  });

  it('9. rejects decryption when dataIvHex is tampered', () => {
    const tamperedPath = tamperMetaField((m) => {
      const ivBuf = Buffer.from(m.dataIvHex, 'hex');
      ivBuf[0] ^= 0xff;
      m.dataIvHex = ivBuf.toString('hex');
    });
    expect(() => {
      DatabaseEncryptionService.decryptDatabaseFileSync(tamperedPath, decryptedDbPath);
    }).toThrow(/DECRYPTION_FAILED/);
  });

  it('10. rejects decryption when dataTagHex is tampered', () => {
    const tamperedPath = tamperMetaField((m) => {
      const tagBuf = Buffer.from(m.dataTagHex, 'hex');
      tagBuf[0] ^= 0xff;
      m.dataTagHex = tagBuf.toString('hex');
    });
    expect(() => {
      DatabaseEncryptionService.decryptDatabaseFileSync(tamperedPath, decryptedDbPath);
    }).toThrow(/DECRYPTION_FAILED/);
  });

  it('11. rejects decryption when encrypted payload ciphertext bytes are flipped', () => {
    const fileBuffer = Buffer.from(fs.readFileSync(laiPath));
    fileBuffer[fileBuffer.length - 16] ^= 0xff;
    const tamperedCiphertextPath = path.join(tempDir, 'tampered_ciphertext.lai');
    fs.writeFileSync(tamperedCiphertextPath, fileBuffer);

    expect(() => {
      DatabaseEncryptionService.decryptDatabaseFileSync(tamperedCiphertextPath, decryptedDbPath);
    }).toThrow(/DECRYPTION_FAILED/);
    expect(fs.existsSync(decryptedDbPath)).toBe(false);
  });

  it('12. rejects decryption when metadata length header (metaLen) is corrupted or out of bounds', () => {
    const fileBuffer = Buffer.from(fs.readFileSync(laiPath));
    fileBuffer.writeUInt32BE(0xffffffff, 8);
    const tamperedLenPath = path.join(tempDir, 'tampered_metalen.lai');
    fs.writeFileSync(tamperedLenPath, fileBuffer);

    expect(() => {
      DatabaseEncryptionService.decryptDatabaseFileSync(tamperedLenPath, decryptedDbPath);
    }).toThrow(/INVALID_ENCRYPTED_DATABASE|DECRYPTION_FAILED/);
    expect(fs.existsSync(decryptedDbPath)).toBe(false);
  });

  it('13. rejects decryption when aadVersion in envelope metadata is downgraded or tampered (DEF-CHAL-002)', () => {
    for (const badAadVer of [2, 1, 99, null, '3']) {
      const tamperedPath = tamperMetaField((m) => {
        m.aadVersion = badAadVer;
      });
      expect(() => {
        DatabaseEncryptionService.decryptDatabaseFileSync(tamperedPath, decryptedDbPath);
      }).toThrow(/DECRYPTION_FAILED/);
      expect(fs.existsSync(decryptedDbPath)).toBe(false);
    }
  });

  it('14. rejects decryption when recoveryEnvelope.ivHex, tagHex, or wrappedKekHex is tampered (DEF-CHAL-002)', () => {
    for (const field of ['ivHex', 'tagHex', 'wrappedKekHex'] as const) {
      const tamperedPath = tamperMetaField((m) => {
        const buf = Buffer.from(m.recoveryEnvelope[field], 'hex');
        buf[0] ^= 0xff;
        m.recoveryEnvelope[field] = buf.toString('hex');
      });
      expect(() => {
        DatabaseEncryptionService.decryptDatabaseFileSync(tamperedPath, decryptedDbPath);
      }).toThrow(/DECRYPTION_FAILED/);
      expect(fs.existsSync(decryptedDbPath)).toBe(false);
    }
  });

  it('15. rejects decryption when recoveryEnvelope is removed from OS_KEYCHAIN_STANDALONE container metadata (DEF-CHAL-002)', () => {
    const tamperedPath = tamperMetaField((m) => {
      delete m.recoveryEnvelope;
    });
    expect(() => {
      DatabaseEncryptionService.decryptDatabaseFileSync(tamperedPath, decryptedDbPath);
    }).toThrow(/DECRYPTION_FAILED/);
    expect(fs.existsSync(decryptedDbPath)).toBe(false);
  });

  it('16. rejects decryption when a valid recoveryEnvelope from another company is substituted into the container (DEF-CHAL-002)', () => {
    const otherCompanyRing = DatabaseEncryptionService.getOrProvisionCompanyKeyringSync(
      'LGR-OTHER-FOREIGN-COMPANY-99',
      'OS_KEYCHAIN_STANDALONE'
    );
    expect(otherCompanyRing.recoveryEnvelope).toBeDefined();

    const tamperedPath = tamperMetaField((m) => {
      m.recoveryEnvelope = otherCompanyRing.recoveryEnvelope;
    });
    expect(() => {
      DatabaseEncryptionService.decryptDatabaseFileSync(tamperedPath, decryptedDbPath);
    }).toThrow(/DECRYPTION_FAILED/);
    expect(fs.existsSync(decryptedDbPath)).toBe(false);
  });
});
