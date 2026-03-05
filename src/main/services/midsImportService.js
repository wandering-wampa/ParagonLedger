const fs = require("fs");
const path = require("path");

const UID_PREFIX_TOKENS = new Set([
  "crafted",
  "attuned",
  "superior",
  "boosted",
  "invention",
  "common",
  "uncommon",
  "rare",
  "very",
  "standard",
  "training",
  "dual",
  "single",
  "origin"
]);

function titleCase(value) {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word, idx) => {
      const lower = word.toLowerCase();
      if (idx > 0 && (lower === "of" || lower === "the" || lower === "and")) {
        return lower;
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

class MidsImportService {
  constructor(db) {
    this.db = db;
  }

  powerNameFromUid(value) {
    const raw = String(value || "").trim();
    if (!raw) {
      return "Unknown Power";
    }
    const lastSegment = raw.split(".").pop() || raw;
    return lastSegment.replace(/_/g, " ").trim();
  }

  powerSetFromUid(value) {
    const raw = String(value || "").trim();
    if (!raw) {
      return "";
    }
    const segments = raw.split(".").filter(Boolean);
    if (segments.length < 2) {
      return "";
    }
    return String(segments[segments.length - 2] || "").replace(/_/g, " ").trim();
  }

  parseEnhancementUid(uid) {
    const raw = String(uid || "").trim();
    if (!raw) {
      return {
        display: "",
        setName: "Unknown",
        setPiece: null
      };
    }
    const tokens = raw.split("_").filter(Boolean);
    let setPiece = null;
    if (tokens.length && /^[A-Z]$/i.test(tokens[tokens.length - 1])) {
      setPiece = tokens.pop().toUpperCase();
    }

    while (tokens.length && UID_PREFIX_TOKENS.has(tokens[0].toLowerCase())) {
      tokens.shift();
    }
    const setTokens = tokens.length ? tokens : raw.split("_");
    const setName = titleCase(setTokens.join(" ").replace(/\s+/g, " "));
    const display = setPiece ? `${setName} (${setPiece})` : setName;
    return {
      display,
      setName: setName || "Unknown",
      setPiece
    };
  }

  normalizeBuildRows(data) {
    if (Array.isArray(data?.levels)) {
      return data.levels.map((levelRow) => ({
        level: Number(levelRow.level) || 0,
        powerUid: "",
        powerSet: "",
        powerName: String(levelRow.power || "Unknown Power"),
        statInclude: true,
        procInclude: false,
        variableValue: 0,
        inherentSlotsUsed: 0,
        enhancements: [],
        slots: Number(levelRow.slots) || 0
      }));
    }

    if (!Array.isArray(data?.PowerEntries)) {
      return [];
    }

    return data.PowerEntries.map((entry) => {
      const powerUid = String(entry.PowerName || "");
      const enhancements = Array.isArray(entry.SlotEntries)
        ? entry.SlotEntries
            .map((slot) => {
              const uid = String(slot?.Enhancement?.Uid || "").trim();
              const parsed = this.parseEnhancementUid(uid);
              return {
                slotLevel: Number(slot?.Level) || 0,
                isInherent: Boolean(slot?.IsInherent),
                enhancementUid: uid,
                enhancementDisplay: parsed.display,
                enhancementSet: parsed.setName,
                setPiece: parsed.setPiece,
                grade: String(slot?.Enhancement?.Grade || ""),
                ioLevel:
                  slot?.Enhancement?.IoLevel !== undefined
                    ? Number(slot.Enhancement.IoLevel) || 0
                    : null,
                relativeLevel: String(slot?.Enhancement?.RelativeLevel || ""),
                obtained: Boolean(slot?.Enhancement?.Obtained)
              };
            })
            .filter((slot) => slot.enhancementUid)
        : [];

      return {
        level: Number(entry.Level) || 0,
        powerUid,
        powerSet: this.powerSetFromUid(powerUid),
        powerName: this.powerNameFromUid(powerUid),
        statInclude: Boolean(entry.StatInclude),
        procInclude: Boolean(entry.ProcInclude),
        variableValue: Number(entry.VariableValue) || 0,
        inherentSlotsUsed: Number(entry.InherentSlotsUsed) || 0,
        enhancements,
        slots: enhancements.length
      };
    });
  }

  async importBuild(filePath, characterId) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== ".json" && ext !== ".mbd") {
      return {
        ok: false,
        error: "Importer supports .mbd (Mids Reborn) and .json build files."
      };
    }

    let data;
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      data = JSON.parse(raw);
    } catch (_error) {
      return {
        ok: false,
        error: "Unable to read build file. Expected a valid JSON-based .mbd/.json file."
      };
    }

    const rows = this.normalizeBuildRows(data);
    if (!rows.length) {
      return {
        ok: false,
        error: "Unsupported build structure. Expected PowerEntries or levels array."
      };
    }

    const created = await this.db.run(
      `INSERT INTO build_plans (
        character_id, source_file, build_name, class_name, origin, alignment,
        target_level, mids_app, mids_version, mids_database, mids_database_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(characterId),
        filePath,
        String(data?.Name || ""),
        String(data?.Class || ""),
        String(data?.Origin || ""),
        String(data?.Alignment || ""),
        Number(data?.Level) || 0,
        String(data?.BuiltWith?.App || ""),
        String(data?.BuiltWith?.Version || ""),
        String(data?.BuiltWith?.Database || ""),
        String(data?.BuiltWith?.DatabaseVersion || "")
      ]
    );

    const sortedRows = [...rows].sort((a, b) => a.level - b.level);
    let importedEnhancements = 0;
    for (const row of sortedRows) {
      const levelInsert = await this.db.run(
        `INSERT INTO build_plan_levels (
          build_plan_id, level, power_uid, power_set, power_name,
          stat_include, proc_include, variable_value, inherent_slots_used, enhancement_slots
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          created.lastID,
          Number(row.level) || 0,
          String(row.powerUid || ""),
          String(row.powerSet || ""),
          String(row.powerName || "Unknown Power"),
          row.statInclude ? 1 : 0,
          row.procInclude ? 1 : 0,
          Number(row.variableValue) || 0,
          Number(row.inherentSlotsUsed) || 0,
          Number(row.slots) || 0
        ]
      );

      for (const slot of row.enhancements || []) {
        await this.db.run(
          `INSERT INTO build_plan_enhancements (
            build_plan_level_id, slot_level, is_inherent, enhancement_uid, enhancement_display,
            enhancement_set, set_piece, grade, io_level, relative_level, obtained
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            levelInsert.lastID,
            Number(slot.slotLevel) || 0,
            slot.isInherent ? 1 : 0,
            String(slot.enhancementUid || ""),
            String(slot.enhancementDisplay || ""),
            String(slot.enhancementSet || ""),
            slot.setPiece ? String(slot.setPiece) : null,
            String(slot.grade || ""),
            slot.ioLevel === null ? null : Number(slot.ioLevel) || 0,
            String(slot.relativeLevel || ""),
            slot.obtained ? 1 : 0
          ]
        );
        importedEnhancements += 1;
      }
    }

    return {
      ok: true,
      importedLevels: sortedRows.length,
      importedEnhancements
    };
  }
}

module.exports = {
  MidsImportService
};
