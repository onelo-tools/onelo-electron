import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('__oneloAuth', {
  getConfig: () => ipcRenderer.invoke('__onelo_auth_view:getConfig'),
  signIn: (email: string, password: string) => ipcRenderer.invoke('__onelo_auth_view:signIn', email, password),
  signUp: (email: string, password: string) => ipcRenderer.invoke('__onelo_auth_view:signUp', email, password),
})
