import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { CompanyManager } from './companyManager';

export class CompanyStorageService {
  static async getCompanyRoot(companyId: string): Promise<string> {
    const manifest = await CompanyManager.getCompanyManifest(companyId);
    if (!manifest) {
      throw new Error(`COMPANY_NOT_FOUND: ${companyId}`);
    }
    return manifest.location;
  }

  static async getDocumentsPath(companyId: string): Promise<string> {
    const root = await this.getCompanyRoot(companyId);
    const docsPath = path.join(root, 'documents');
    try {
      await fs.mkdir(docsPath, { recursive: true });
    } catch (err: any) {
      throw new Error(`DOCUMENT_LOCATION_UNAVAILABLE: The configured document folder is inaccessible (${docsPath}). Please verify the drive is connected or choose another location. Error: ${err.message}`);
    }
    return docsPath;
  }

  static async getBackupsPath(companyId: string): Promise<string> {
    const manifest = await CompanyManager.getCompanyManifest(companyId);
    if (!manifest) {
      throw new Error(`COMPANY_NOT_FOUND: ${companyId}`);
    }
    const backupsPath = manifest.backupLocation || path.join(manifest.location, 'backups');
    
    try {
      await fs.mkdir(backupsPath, { recursive: true });
    } catch (err: any) {
      throw new Error(`BACKUP_LOCATION_UNAVAILABLE: The configured backup folder is inaccessible (${backupsPath}). Please verify the drive is connected or choose another location. Error: ${err.message}`);
    }
    
    return backupsPath;
  }

  static async getExportsPath(companyId: string): Promise<string> {
    const root = await this.getCompanyRoot(companyId);
    const exportsPath = path.join(root, 'exports');
    await fs.mkdir(exportsPath, { recursive: true });
    return exportsPath;
  }

  static async resolveDocumentPath(companyId: string, filename: string): Promise<string> {
    const safeFilename = path.basename(filename);
    if (!safeFilename || safeFilename === '.' || safeFilename === '..') {
      throw new Error('INVALID_FILENAME');
    }
    const docsPath = await this.getDocumentsPath(companyId);
    return path.join(docsPath, safeFilename);
  }

  static async resolveBackupPath(companyId: string, filename: string): Promise<string> {
    const safeFilename = path.basename(filename);
    if (!safeFilename || safeFilename === '.' || safeFilename === '..') {
      throw new Error('INVALID_FILENAME');
    }
    const backupsPath = await this.getBackupsPath(companyId);
    return path.join(backupsPath, safeFilename);
  }

  static async resolveExportPath(companyId: string, filename: string): Promise<string> {
    const safeFilename = path.basename(filename);
    if (!safeFilename || safeFilename === '.' || safeFilename === '..') {
      throw new Error('INVALID_FILENAME');
    }
    const exportsPath = await this.getExportsPath(companyId);
    return path.join(exportsPath, safeFilename);
  }

  static async writeDocument(companyId: string, originalFilename: string, buffer: Buffer | string): Promise<{ id: string, filePath: string, safeFilename: string }> {
    const id = crypto.randomUUID();
    const ext = path.extname(originalFilename);
    const safeFilename = `${id}${ext}`;
    
    const filePath = await this.resolveDocumentPath(companyId, safeFilename);
    await fs.writeFile(filePath, buffer);
    
    return { id, filePath, safeFilename };
  }
}
