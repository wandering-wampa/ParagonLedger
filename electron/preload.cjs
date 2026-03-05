const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("heroLedgerApi", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setLogsDir: (logsDir) => ipcRenderer.invoke("settings:setLogsDir", logsDir),
  setActiveAccount: (accountName, logsDir) =>
    ipcRenderer.invoke("settings:setActiveAccount", accountName, logsDir),
  pickLogsDir: () => ipcRenderer.invoke("dialog:pickLogsDir"),
  startParser: () => ipcRenderer.invoke("parser:start"),
  stopParser: () => ipcRenderer.invoke("parser:stop"),
  getParserState: () => ipcRenderer.invoke("parser:getState"),
  getAccounts: () => ipcRenderer.invoke("accounts:list"),
  getCharacters: (accountId) => ipcRenderer.invoke("characters:list", accountId),
  reorderCharacters: (accountId, characterIds) =>
    ipcRenderer.invoke("characters:reorder", accountId, characterIds),
  getDashboard: (characterId) => ipcRenderer.invoke("dashboard:get", characterId),
  getBadgeTimeline: (characterId) =>
    ipcRenderer.invoke("badges:getTimeline", characterId),
  getBadgeBrowser: (characterId) =>
    ipcRenderer.invoke("badges:getBrowser", characterId),
  unlockBadge: (characterId, badgeId, unlockedAt) =>
    ipcRenderer.invoke("badges:unlock", characterId, badgeId, unlockedAt),
  importBuild: (characterId) => ipcRenderer.invoke("build:import", characterId),
  getLatestBuild: (characterId) => ipcRenderer.invoke("build:getLatest", characterId)
});
