const fs = require("fs");
const path = require("path");

class SettingsService {
  constructor(userDataPath) {
    this.settingsPath = path.join(userDataPath, "ParagonLedger", "settings.json");
    this.legacySettingsPath = path.join(userDataPath, "HeroLedger", "settings.json");
    this.settings = this.load();
  }

  load() {
    if (fs.existsSync(this.settingsPath)) {
      const parsed = JSON.parse(fs.readFileSync(this.settingsPath, "utf8"));
      const migrated = this.migrateSettings(parsed);
      this.settings = migrated;
      this.save();
      return migrated;
    }
    if (fs.existsSync(this.legacySettingsPath)) {
      fs.mkdirSync(path.dirname(this.settingsPath), { recursive: true });
      fs.copyFileSync(this.legacySettingsPath, this.settingsPath);
      const parsed = JSON.parse(fs.readFileSync(this.settingsPath, "utf8"));
      const migrated = this.migrateSettings(parsed);
      this.settings = migrated;
      this.save();
      return migrated;
    }
    const defaults = {
      accountLogs: [],
      activeAccountName: null,
      selectedCharacterId: null
    };
    fs.mkdirSync(path.dirname(this.settingsPath), { recursive: true });
    fs.writeFileSync(this.settingsPath, JSON.stringify(defaults, null, 2), "utf8");
    return defaults;
  }

  migrateSettings(input) {
    if (!input || typeof input !== "object") {
      return {
        accountLogs: [],
        activeAccountName: null,
        selectedCharacterId: null
      };
    }

    if (Array.isArray(input.accountLogs)) {
      return {
        accountLogs: input.accountLogs
          .filter((entry) => entry && entry.logsDir)
          .map((entry) => ({
            accountName:
              entry.accountName || this.inferAccountNameFromLogsDir(entry.logsDir),
            logsDir: entry.logsDir
          })),
        activeAccountName: input.activeAccountName || null,
        selectedCharacterId: input.selectedCharacterId || null
      };
    }

    if (input.logsDir) {
      const accountName = this.inferAccountNameFromLogsDir(input.logsDir);
      return {
        accountLogs: [{ accountName, logsDir: input.logsDir }],
        activeAccountName: accountName,
        selectedCharacterId: input.selectedCharacterId || null
      };
    }

    return {
      accountLogs: [],
      activeAccountName: null,
      selectedCharacterId: input.selectedCharacterId || null
    };
  }

  inferAccountNameFromLogsDir(logsDir) {
    const normalized = path.normalize(logsDir);
    const segments = normalized.split(path.sep).filter(Boolean);
    const accountsIdx = segments.findIndex(
      (segment) => segment.toLowerCase() === "accounts"
    );
    if (accountsIdx >= 0 && segments[accountsIdx + 1]) {
      return segments[accountsIdx + 1];
    }
    const leaf = path.basename(normalized).toLowerCase();
    if (leaf === "logs") {
      return path.basename(path.dirname(normalized)) || "DefaultAccount";
    }
    return path.basename(normalized) || "DefaultAccount";
  }

  save() {
    fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2), "utf8");
  }

  getSettings() {
    return this.settings;
  }

  setLogsDir(logsDir, explicitAccountName) {
    const accountName = explicitAccountName || this.inferAccountNameFromLogsDir(logsDir);
    const existing = this.settings.accountLogs.findIndex(
      (entry) => entry.accountName === accountName
    );
    if (existing >= 0) {
      this.settings.accountLogs[existing].logsDir = logsDir;
    } else {
      this.settings.accountLogs.push({ accountName, logsDir });
    }
    this.settings.activeAccountName = accountName;
    this.save();
    return this.settings;
  }

  setActiveAccount(accountName, logsDir = "") {
    const existing = this.settings.accountLogs.find(
      (entry) => entry.accountName === accountName
    );
    if (!existing && logsDir) {
      this.settings.accountLogs.push({ accountName, logsDir });
    } else if (existing && logsDir && existing.logsDir !== logsDir) {
      existing.logsDir = logsDir;
    }
    this.settings.activeAccountName = accountName;
    this.save();
    return this.settings;
  }

  getActiveAccount() {
    if (!this.settings.activeAccountName) {
      return null;
    }
    const found = this.settings.accountLogs.find(
      (entry) => entry.accountName === this.settings.activeAccountName
    );
    if (!found) {
      return null;
    }
    return {
      accountName: found.accountName,
      logsDir: found.logsDir
    };
  }
}

module.exports = {
  SettingsService
};
