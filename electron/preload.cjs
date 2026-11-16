// 렌더러(화면)에 안전하게 노출하는 Windows 기능
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  newNote: () => ipcRenderer.send('note:new'),
  openNote: (id) => ipcRenderer.send('note:open', id),
  noteDeleted: (id) => ipcRenderer.send('note:deleted', id),
  openList: () => ipcRenderer.send('list:open'),
  closeWindow: () => ipcRenderer.send('window:close'),
  noteMissing: () => ipcRenderer.send('note:missing'),
  closeAllNotes: () => ipcRenderer.send('notes:closeAll'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  onRequestClose: (cb) => ipcRenderer.on('window:requestClose', () => cb()),
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggleMaximize'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onMaximizeChange: (cb) => ipcRenderer.on('window:maximized', (_e, v) => cb(v)),
  onFocusChange: (cb) => ipcRenderer.on('window:focus', (_e, v) => cb(v)),
});
