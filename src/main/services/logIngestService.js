const fs = require("fs");
const path = require("path");
const chokidar = require("chokidar");
const { parseLine } = require("../parsers/eventParsers");
const { FactionResolver } = require("./factionResolver");

const MAX_CHARACTER_CONTEXT_SCAN_BYTES = 8 * 1024 * 1024;
const LIVE_POLL_INTERVAL_MS = 1500;

class LogIngestService {
  constructor(db) {
    this.db = db;
    this.factionResolver = new FactionResolver();
    this.logsDirectory = "";
    this.accountName = "";
    this.currentAccountId = null;
    this.fileCharacterIds = new Map();
    this.fileRemainders = new Map();
    this.currentLogFilePath = null;
    this.currentCharacterName = "";
    this.fileParseLocks = new Map();
    this.watcher = null;
    this.pollTimer = null;
    this.running = false;
  }

  setAccountContext(accountName, logsDirectory) {
    this.accountName = accountName || "";
    this.logsDirectory = logsDirectory || "";
    this.currentAccountId = null;
    this.fileCharacterIds.clear();
    this.fileRemainders.clear();
    this.currentLogFilePath = null;
    this.currentCharacterName = "";
    this.fileParseLocks.clear();
  }

  async start() {
    if (this.running) {
      return this.getState({ ok: true, status: "already_running" });
    }
    if (!this.accountName) {
      return { ok: false, error: "Active account is not set." };
    }
    if (!this.logsDirectory || !fs.existsSync(this.logsDirectory)) {
      return { ok: false, error: "Logs directory is not set or does not exist." };
    }
    this.currentAccountId = await this.ensureAccount(this.accountName, this.logsDirectory);
    await this.backfillEnemyFactions();
    this.running = true;
    await this.parseHistoricalLogs();
    this.startWatch();
    this.startPolling();
    return this.getState({ ok: true, status: "running" });
  }

  async stop() {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.running = false;
    return this.getState({ ok: true, status: "stopped" });
  }

  getState(extra = {}) {
    return {
      ok: true,
      status: this.running ? "running" : "stopped",
      running: this.running,
      currentLogFilePath: this.currentLogFilePath || null,
      currentCharacterName: this.currentCharacterName || null,
      ...extra
    };
  }

  listLogFiles() {
    const found = [];
    const walk = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
          continue;
        }
        if (!entry.isFile()) {
          continue;
        }
        if (!/\.(txt|log)$/i.test(fullPath)) {
          continue;
        }
        found.push({ fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs });
      }
    };
    walk(this.logsDirectory);
    return found.sort((a, b) => a.mtimeMs - b.mtimeMs);
  }

  async parseHistoricalLogs() {
    const files = this.listLogFiles();
    for (const file of files) {
      await this.parseFileQueued(file.fullPath);
    }
    if (files.length) {
      this.currentLogFilePath = files[files.length - 1].fullPath;
    }
  }

  startWatch() {
    this.watcher = chokidar.watch(this.logsDirectory, {
      ignoreInitial: true,
      persistent: true
    });
    const handleChange = async (filePath) => {
      if (!/\.(txt|log)$/i.test(filePath)) {
        return;
      }
      await this.parseFileQueued(filePath);
    };
    this.watcher.on("add", handleChange);
    this.watcher.on("change", handleChange);
    this.watcher.on("error", () => {
      // Polling loop remains active as fallback if watcher errors occur.
    });
  }

  startPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }
    this.pollTimer = setInterval(() => {
      if (!this.running) {
        return;
      }
      this.pollForChanges().catch(() => {
        // Keep polling even if one pass fails.
      });
    }, LIVE_POLL_INTERVAL_MS);
  }

  async pollForChanges() {
    const files = this.listLogFiles();
    for (const file of files) {
      await this.parseFileQueued(file.fullPath);
    }
    if (files.length) {
      this.currentLogFilePath = files[files.length - 1].fullPath;
    }
  }

  async parseFileQueued(filePath) {
    const previous = this.fileParseLocks.get(filePath) || Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(() => this.parseFile(filePath))
      .catch(() => {});
    this.fileParseLocks.set(filePath, next);
    try {
      await next;
    } finally {
      if (this.fileParseLocks.get(filePath) === next) {
        this.fileParseLocks.delete(filePath);
      }
    }
  }

  async parseFile(filePath) {
    this.currentLogFilePath = filePath;
    const stats = fs.statSync(filePath);
    const state = await this.db.get(
      "SELECT last_offset FROM parser_state WHERE file_path = ?",
      [filePath]
    );
    let startOffset = state ? state.last_offset : 0;
    if (stats.size < startOffset) {
      startOffset = 0;
      this.fileRemainders.delete(filePath);
    }
    if (stats.size === startOffset) {
      return;
    }

    let fileCharacterId = await this.resolveCharacterIdForFile(filePath, stats.size);

    const fd = fs.openSync(filePath, "r");
    try {
      const bytesToRead = stats.size - startOffset;
      const buffer = Buffer.alloc(bytesToRead);
      fs.readSync(fd, buffer, 0, bytesToRead, startOffset);
      const previousRemainder = this.fileRemainders.get(filePath) || "";
      const chunk = previousRemainder + buffer.toString("utf8");
      const endsWithNewline = /\r?\n$/.test(chunk);
      const lines = chunk.split(/\r?\n/);
      if (!endsWithNewline) {
        this.fileRemainders.set(filePath, lines.pop() || "");
      } else {
        this.fileRemainders.set(filePath, "");
      }
      for (const line of lines) {
        const event = parseLine(line);
        if (!event) {
          continue;
        }
        if (event.type === "character_detected") {
          fileCharacterId = await this.ensureCharacter(event.payload.name);
          this.currentCharacterName = event.payload.name;
          this.fileCharacterIds.set(filePath, fileCharacterId);
          continue;
        }
        await this.handleEvent(event, fileCharacterId);
      }
      await this.db.run(
        `INSERT INTO parser_state (file_path, last_offset, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(file_path)
         DO UPDATE SET last_offset = excluded.last_offset, updated_at = CURRENT_TIMESTAMP`,
        [filePath, stats.size]
      );
    } finally {
      fs.closeSync(fd);
    }
  }

  inferCharacterNameFromFilePath(filePath) {
    const ext = path.extname(filePath);
    let stem = path.basename(filePath, ext).trim();
    stem = stem
      .replace(/^(chatlog|combatlog|chat|combat|coh|homecoming|log)[-_ ]*/i, "")
      .replace(/[_-]?(chat|combat|log)$/i, "")
      .replace(/[_-](\d{4}[-_]\d{2}[-_]\d{2}.*)$/i, "")
      .replace(/[_-](\d{8}.*)$/i, "")
      .replace(/[._]+/g, " ")
      .trim();
    if (!stem) {
      return null;
    }
    if (/^\d+$/.test(stem)) {
      return null;
    }
    if (/^\d{4}[-_]\d{2}[-_]\d{2}(?:\s+.*)?$/i.test(stem)) {
      return null;
    }
    if (/^(chat|combat)?\s*log(?:\s+\d{4}[-_]\d{2}[-_]\d{2}.*)?$/i.test(stem)) {
      return null;
    }
    if (/^(chat|combat|log|unknown)$/i.test(stem)) {
      return null;
    }
    return stem;
  }

  async resolveCharacterIdForFile(filePath, fileSize) {
    let fileCharacterId = this.fileCharacterIds.get(filePath) || null;
    if (fileCharacterId) {
      return fileCharacterId;
    }

    const inferredName = this.inferCharacterNameFromFilePath(filePath);
    if (inferredName) {
      fileCharacterId = await this.ensureCharacter(inferredName);
      this.fileCharacterIds.set(filePath, fileCharacterId);
      return fileCharacterId;
    }

    const bytesToScan = Math.min(fileSize, MAX_CHARACTER_CONTEXT_SCAN_BYTES);
    if (bytesToScan <= 0) {
      return null;
    }
    const fd = fs.openSync(filePath, "r");
    try {
      const buffer = Buffer.alloc(bytesToScan);
      fs.readSync(fd, buffer, 0, bytesToScan, 0);
      const scanText = buffer.toString("utf8");
      const detectedName = this.detectCharacterNameFromText(scanText);
      if (!detectedName) {
        return null;
      }
      fileCharacterId = await this.ensureCharacter(detectedName);
      this.fileCharacterIds.set(filePath, fileCharacterId);
      return fileCharacterId;
    } finally {
      fs.closeSync(fd);
    }
  }

  detectCharacterNameFromText(text) {
    const lines = text.split(/\r?\n/);
    let lastDetectedName = null;
    for (const line of lines) {
      const event = parseLine(line);
      if (event && event.type === "character_detected" && event.payload?.name) {
        lastDetectedName = event.payload.name.trim();
      }
    }
    return lastDetectedName;
  }

  async ensureAccount(name, logsDir) {
    await this.db.run(
      "INSERT OR IGNORE INTO accounts (name, logs_dir) VALUES (?, ?)",
      [name, logsDir]
    );
    await this.db.run("UPDATE accounts SET logs_dir = ? WHERE name = ?", [logsDir, name]);
    const account = await this.db.get("SELECT id FROM accounts WHERE name = ?", [name]);
    return account.id;
  }

  async ensureCharacter(name = "Unknown Hero") {
    const safeName = name.trim() || "Unknown Hero";
    const accountId =
      this.currentAccountId || (await this.ensureAccount(this.accountName, this.logsDirectory));
    const orderRow = await this.db.get(
      "SELECT IFNULL(MAX(display_order), 0) AS max_order FROM characters WHERE account_id = ?",
      [accountId]
    );
    const nextOrder = Number(orderRow?.max_order || 0) + 1;
    await this.db.run(
      "INSERT OR IGNORE INTO characters (account_id, name, archetype, display_order) VALUES (?, ?, ?, ?)",
      [accountId, safeName, "Unknown", nextOrder]
    );
    const character = await this.db.get(
      "SELECT id FROM characters WHERE account_id = ? AND name = ?",
      [accountId, safeName]
    );
    return character.id;
  }

  async backfillEnemyFactions() {
    if (!this.currentAccountId) {
      return;
    }
    const rows = await this.db.all(
      `
      SELECT ed.id, ed.enemy_name
      FROM enemy_defeats ed
      JOIN characters c ON c.id = ed.character_id
      WHERE c.account_id = ?
        AND (ed.enemy_faction IS NULL OR ed.enemy_faction = '' OR ed.enemy_faction = 'Unknown')
      `,
      [this.currentAccountId]
    );
    for (const row of rows) {
      const faction = this.factionResolver.infer(row.enemy_name);
      if (faction === "Unknown") {
        continue;
      }
      await this.db.run("UPDATE enemy_defeats SET enemy_faction = ? WHERE id = ?", [
        faction,
        row.id
      ]);
    }
  }

  async handleEvent(event, fileCharacterId = null) {
    if (!fileCharacterId) {
      return;
    }
    const characterId = fileCharacterId;
    switch (event.type) {
      case "badge_unlocked":
        await this.insertBadgeUnlock(characterId, event.payload.badgeName, event.timestamp);
        break;
      case "enemy_defeat":
        const faction = this.factionResolver.infer(event.payload.enemyName);
        await this.db.run(
          `INSERT INTO enemy_defeats (character_id, enemy_name, enemy_faction, timestamp)
           VALUES (?, ?, ?, ?)`,
          [characterId, event.payload.enemyName, faction, event.timestamp]
        );
        break;
      case "influence_gain":
        await this.db.run(
          "INSERT INTO influence_events (character_id, amount, timestamp) VALUES (?, ?, ?)",
          [characterId, event.payload.amount, event.timestamp]
        );
        break;
      case "zone_entry":
        await this.insertZoneActivity(characterId, event.payload.zoneName, event.timestamp);
        break;
      case "mission_complete":
        await this.db.run(
          "INSERT INTO missions (character_id, mission_name, timestamp) VALUES (?, ?, ?)",
          [characterId, event.payload.missionName, event.timestamp]
        );
        break;
      case "loot_received":
        await this.db.run(
          "INSERT INTO loot_events (character_id, item_name, timestamp) VALUES (?, ?, ?)",
          [characterId, event.payload.itemName, event.timestamp]
        );
        break;
      default:
        break;
    }
  }

  async insertZoneActivity(characterId, zoneName, timestamp) {
    await this.db.run("INSERT OR IGNORE INTO zones (zone_name) VALUES (?)", [zoneName]);
    const zone = await this.db.get("SELECT id FROM zones WHERE zone_name = ?", [zoneName]);
    await this.db.run(
      "INSERT INTO zone_activity (character_id, zone_id, timestamp) VALUES (?, ?, ?)",
      [characterId, zone.id, timestamp]
    );
  }

  async insertBadgeUnlock(characterId, badgeName, timestamp) {
    await this.db.run(
      "INSERT OR IGNORE INTO badges (badge_name, category, description, icon_path) VALUES (?, ?, ?, ?)",
      [badgeName, "Unknown", "", ""]
    );
    const badge = await this.db.get("SELECT id FROM badges WHERE badge_name = ?", [badgeName]);
    await this.db.run(
      "INSERT OR IGNORE INTO badge_unlocks (character_id, badge_id, timestamp) VALUES (?, ?, ?)",
      [characterId, badge.id, timestamp]
    );
  }

}

module.exports = {
  LogIngestService
};
