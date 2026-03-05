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
  reorderCharacters: (accountId, characterIds) =>
    window.heroLedgerApi.reorderCharacters(accountId, characterIds),
  getDashboard: (characterId) => window.heroLedgerApi.getDashboard(characterId),
  getBadgeTimeline: (characterId) => window.heroLedgerApi.getBadgeTimeline(characterId),
  getBadgeBrowser: (characterId) => window.heroLedgerApi.getBadgeBrowser(characterId),
  unlockBadge: (characterId, badgeId, unlockedAt = null) =>
    window.heroLedgerApi.unlockBadge(characterId, badgeId, unlockedAt),
  importBuild: (characterId) => window.heroLedgerApi.importBuild(characterId),
  getLatestBuild: (characterId) => window.heroLedgerApi.getLatestBuild(characterId)
};
