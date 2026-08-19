import { contextBridge, ipcRenderer } from 'electron';

export interface SelectFolderOptions {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
}

export interface ElectronAPI {
  isElectron: boolean;
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
  selectFolder: (options?: SelectFolderOptions): Promise<string | null> => {
    return ipcRenderer.invoke('dialog:selectFolder', options);
  },
  getAppPaths: (): Promise<any> => {
    return ipcRenderer.invoke('app:getPaths');
  }
});
