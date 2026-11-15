"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('exer', { droppedFilePath: (file) => electron_1.webUtils.getPathForFile(file), call: (name, payload) => electron_1.ipcRenderer.invoke('exer', name, payload), on: (event, callback) => { if (!['progress', 'log', 'game-log', 'launcher-update', 'navigate', 'join-request'].includes(event))
        throw Error('Invalid event'); const listener = (_, value) => callback(value); electron_1.ipcRenderer.on(event, listener); return () => electron_1.ipcRenderer.removeListener(event, listener); } });
