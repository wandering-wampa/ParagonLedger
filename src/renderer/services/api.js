export const api = {
  getSettings: () => window.heroLedgerApi.getSettings(),
  setLogsDir: (logsDir) => window.heroLedgerApi.setLogsDir(logsDir),
  setActiveAccount: (accountName, logsDir) =>
    window.heroLedgerApi.setActiveAccount(accountName, logsDir),
  pickLogsDir: () => window.heroLedgerApi.pickLogsDir(),
  startParser: () => window.heroLedgerApi.startParser(),
  stopParser: () => window.heroLedgerApi.stopParser(),
  getParserState: () => window.heroLedgerApi.getParserState(),
  getAccounts: () => window.heroLedgerApi.getAccounts(),
  getCharacters: (accountId) => window.heroLedgerApi.getCharacters(accountId),
  getDashboard: (characterId) => window.heroLedgerApi.getDashboard(characterId),
  getBadgeTimeline: (characterId) => window.heroLedgerApi.getBadgeTimeline(characterId),
  getBadgeBrowser: (characterId) => window.heroLedgerApi.getBadgeBrowser(characterId),
  exportData: (format) => window.heroLedgerApi.exportData(format),
  importBuild: (characterId) => window.heroLedgerApi.importBuild(characterId),
  getLatestBuild: (characterId) => window.heroLedgerApi.getLatestBuild(characterId)
};
