const fs = require("fs");

class ExportService {
  constructor(db) {
    this.db = db;
  }

  async snapshot() {
    const [characters, badges, badgeUnlocks, enemyDefeats, influenceEvents] =
      await Promise.all([
        this.db.all("SELECT * FROM characters ORDER BY name"),
        this.db.all("SELECT * FROM badges ORDER BY badge_name"),
        this.db.all("SELECT * FROM badge_unlocks ORDER BY timestamp"),
        this.db.all("SELECT * FROM enemy_defeats ORDER BY timestamp"),
        this.db.all("SELECT * FROM influence_events ORDER BY timestamp")
      ]);
    return {
      exportedAt: new Date().toISOString(),
      characters,
      badges,
      badgeUnlocks,
      enemyDefeats,
      influenceEvents
    };
  }

  async exportTo(format, filePath) {
    const data = await this.snapshot();
    if (format === "json") {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
      return { ok: true, filePath };
    }
    if (format === "csv") {
      const rows = ["character_name,enemies_defeated,badges_earned,influence_earned"];
      for (const character of data.characters) {
        const enemyCount = data.enemyDefeats.filter(
          (x) => x.character_id === character.id
        ).length;
        const badgeCount = data.badgeUnlocks.filter(
          (x) => x.character_id === character.id
        ).length;
        const influence = data.influenceEvents
          .filter((x) => x.character_id === character.id)
          .reduce((sum, x) => sum + x.amount, 0);
        rows.push(
          `${escapeCsv(character.name)},${enemyCount},${badgeCount},${influence}`
        );
      }
      fs.writeFileSync(filePath, rows.join("\n"), "utf8");
      return { ok: true, filePath };
    }
    return { ok: false, error: "Unsupported format." };
  }
}

function escapeCsv(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

module.exports = {
  ExportService
};
