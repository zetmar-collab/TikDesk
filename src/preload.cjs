const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tikdesk', {
  command: (name, value) => ipcRenderer.invoke('command', name, value),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('state', listener);
    return () => ipcRenderer.removeListener('state', listener);
  }
});
