const fs = require("fs");
const path = require("path");

class MidsImportService {
  constructor(db) {
    this.db = db;
  }

  async importBuild(filePath, characterId) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== ".json") {
      return {
        ok: false,
        error:
          "MVP importer currently supports local JSON exports from Mids-compatible tools."
      };
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    if (!Array.isArray(data.levels)) {
      return { ok: false, error: "Invalid build JSON. Expected { levels: [...] }." };
    }
    const created = await this.db.run(
      "INSERT INTO build_plans (character_id, source_file) VALUES (?, ?)",
      [Number(characterId), filePath]
    );
    for (const levelRow of data.levels) {
      await this.db.run(
        `INSERT INTO build_plan_levels (build_plan_id, level, power_name, enhancement_slots)
         VALUES (?, ?, ?, ?)`,
        [
          created.lastID,
          Number(levelRow.level) || 0,
          String(levelRow.power || "Unknown Power"),
          Number(levelRow.slots) || 0
        ]
      );
    }
    return { ok: true, importedLevels: data.levels.length };
  }
}

module.exports = {
  MidsImportService
};
