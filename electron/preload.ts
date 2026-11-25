import { contextBridge, ipcRenderer } from 'electron';
import type {
  SelectDirectoryOptions,
  SelectDirectoryResult,
  SelectFileOptions,
  SelectFileResult,
} from '../src/shared/folderPickerTypes';

export type SelectFolderOptions = SelectDirectoryOptions;

export interface ElectronAPI {
  isElectron: boolean;
  platform: string;
  selectDirectory: (options?: SelectDirectoryOptions) => Promise<SelectDirectoryResult>;
  selectFile: (options?: SelectFileOptions) => Promise<SelectFileResult>;
  selectFolder: (options?: SelectFolderOptions) => Promise<string | null>;
  getAppPaths: () => Promise<{
    userData: string;
    documents: string;
    appPath: string;
    defaultCompaniesRoot: string;
  }>;
}

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  selectDirectory: (options?: SelectDirectoryOptions): Promise<SelectDirectoryResult> => {
    return ipcRenderer.invoke('dialog:selectDirectory', options || {});
  },
  selectFile: (options?: SelectFileOptions): Promise<SelectFileResult> => {
    return ipcRenderer.invoke('dialog:selectFile', options || {});
  },
  selectFolder: (options?: SelectFolderOptions): Promise<string | null> => {
    return ipcRenderer.invoke('dialog:selectFolder', options || {});
  },
  getAppPaths: (): Promise<any> => {
    return ipcRenderer.invoke('app:getPaths');
  },
} satisfies ElectronAPI);

