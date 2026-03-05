const fs = require("fs");
const path = require("path");

const ZONES_PATH = path.resolve(__dirname, "..", "..", "..", "data", "zones.json");

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toDisplayClassName(raw) {
  const value = String(raw || "");
  if (!value) {
    return "";
  }
  return value
    .replace(/^Class_/i, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

class QueryService {
  constructor(db, { powerCatalog = null } = {}) {
    this.db = db;
    this.powerCatalog = powerCatalog;
    this.zoneCatalog = this.loadZoneCatalog();
  }

  loadZoneCatalog() {
    if (!fs.existsSync(ZONES_PATH)) {
      return [];
    }
    try {
      const raw = JSON.parse(fs.readFileSync(ZONES_PATH, "utf8"));
      const items = Array.isArray(raw)
        ? raw
        : Array.isArray(raw?.zones)
          ? raw.zones
          : [];
      const names = items
        .map((row) => (typeof row === "string" ? row : row?.name))
        .map((name) => String(name || "").trim())
        .filter(Boolean);
      const seen = new Set();
      const unique = [];
      for (const name of names) {
        const key = name.toLowerCase();
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        unique.push(name);
      }
      return unique.sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }

  async getAccounts() {
    return this.db.all(
      `
      SELECT
        a.id,
        a.name,
        a.logs_dir,
        COUNT(DISTINCT c.id) AS character_count
      FROM accounts a
      LEFT JOIN characters c ON c.account_id = a.id
      GROUP BY a.id, a.name, a.logs_dir
      ORDER BY a.name COLLATE NOCASE ASC
      `
    );
  }

  async getCharactersWithStats(accountId) {
    const hasAccountFilter =
      accountId !== null && accountId !== undefined && accountId !== "";
    const rows = await this.db.all(
      `
      SELECT
        c.id,
        c.account_id,
        a.name AS account_name,
        c.name,
        c.archetype,
        c.display_order,
        (SELECT COUNT(*) FROM badge_unlocks bu WHERE bu.character_id = c.id) AS badges_earned,
        (SELECT COUNT(*) FROM enemy_defeats ed WHERE ed.character_id = c.id) AS enemies_defeated,
        (SELECT COUNT(*) FROM missions m WHERE m.character_id = c.id) AS missions_completed,
        (SELECT IFNULL(SUM(ie.amount), 0) FROM influence_events ie WHERE ie.character_id = c.id) AS influence_earned
      FROM characters c
      JOIN accounts a ON a.id = c.account_id
      WHERE (? IS NULL OR c.account_id = ?)
      ORDER BY
        CASE WHEN IFNULL(c.display_order, 0) > 0 THEN 0 ELSE 1 END ASC,
        c.display_order ASC,
        c.name COLLATE NOCASE ASC
      `,
      hasAccountFilter ? [Number(accountId), Number(accountId)] : [null, null]
    );
    return rows.filter((row) => this.isDisplayableCharacterName(row.name));
  }

  async reorderCharacters(accountId, characterIds = []) {
    const aid = Number(accountId);
    if (!Number.isFinite(aid) || aid <= 0) {
      return { ok: false, error: "Invalid account id." };
    }
    if (!Array.isArray(characterIds) || !characterIds.length) {
      return { ok: false, error: "No characters provided for reordering." };
    }
    const orderedIds = characterIds
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0);
    if (!orderedIds.length) {
      return { ok: false, error: "Invalid character ids." };
    }

    const uniqueIds = [...new Set(orderedIds)];
    const placeholders = uniqueIds.map(() => "?").join(",");
    const rows = await this.db.all(
      `SELECT id FROM characters WHERE account_id = ? AND id IN (${placeholders})`,
      [aid, ...uniqueIds]
    );
    const found = new Set(rows.map((row) => Number(row.id)));
    if (found.size !== uniqueIds.length) {
      return { ok: false, error: "One or more characters do not belong to this account." };
    }

    await this.db.exec("BEGIN TRANSACTION");
    try {
      for (let idx = 0; idx < uniqueIds.length; idx += 1) {
        await this.db.run(
          "UPDATE characters SET display_order = ? WHERE account_id = ? AND id = ?",
          [idx + 1, aid, uniqueIds[idx]]
        );
      }
      await this.db.exec("COMMIT");
    } catch (error) {
      await this.db.exec("ROLLBACK");
      return { ok: false, error: error?.message || "Failed to reorder characters." };
    }

    return { ok: true, count: uniqueIds.length };
  }

  isDisplayableCharacterName(name) {
    if (!name || typeof name !== "string") {
      return false;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      return false;
    }
    const lower = trimmed.toLowerCase();
    if (lower === "unknown hero" || lower === "unknown") {
      return false;
    }
    if (/^(chat|combat)?\s*log\b/.test(lower)) {
      return false;
    }
    if (/^\d{4}[-_]\d{2}[-_]\d{2}(?:\s+.*)?$/.test(lower)) {
      return false;
    }
    return true;
  }

  async getDashboard(characterId) {
    const id = Number(characterId);
    const summary = await this.db.get(
      `
      SELECT
        (SELECT COUNT(*) FROM badge_unlocks WHERE character_id = ?) AS badges_earned,
        (SELECT COUNT(*) FROM enemy_defeats WHERE character_id = ?) AS enemies_defeated,
        (SELECT COUNT(*) FROM missions WHERE character_id = ?) AS missions_completed,
        (SELECT IFNULL(SUM(amount), 0) FROM influence_events WHERE character_id = ?) AS influence_earned
      `,
      [id, id, id, id]
    );

    const influenceByDay = await this.db.all(
      `
      SELECT DATE(timestamp) AS day, SUM(amount) AS total
      FROM influence_events
      WHERE character_id = ?
      GROUP BY DATE(timestamp)
      ORDER BY DATE(timestamp) ASC
      `,
      [id]
    );

    const enemiesByDay = await this.db.all(
      `
      SELECT DATE(timestamp) AS day, COUNT(*) AS total
      FROM enemy_defeats
      WHERE character_id = ?
      GROUP BY DATE(timestamp)
      ORDER BY DATE(timestamp) ASC
      `,
      [id]
    );

    const enemyFactions = await this.db.all(
      `
      SELECT
        COALESCE(NULLIF(enemy_faction, ''), 'Unknown') AS name,
        COUNT(*) AS defeats
      FROM enemy_defeats
      WHERE character_id = ?
      GROUP BY COALESCE(NULLIF(enemy_faction, ''), 'Unknown')
      ORDER BY defeats DESC, name ASC
      LIMIT 12
      `,
      [id]
    );

    const topZones = await this.db.all(
      `
      SELECT z.zone_name AS name, COUNT(*) AS visits
      FROM zone_activity za
      JOIN zones z ON z.id = za.zone_id
      WHERE za.character_id = ?
      GROUP BY z.zone_name
      ORDER BY visits DESC
      LIMIT 10
      `,
      [id]
    );

    return {
      summary,
      influenceByDay,
      enemiesByDay,
      enemyFactions,
      topZones
    };
  }

  async getKnownZones(characterId = null) {
    const cid = Number(characterId);
    const hasCharacter = Number.isFinite(cid) && cid > 0;
    const characterZones = hasCharacter
      ? await this.db.all(
          `
          SELECT z.zone_name AS name, COUNT(*) AS visits
          FROM zone_activity za
          JOIN zones z ON z.id = za.zone_id
          WHERE za.character_id = ?
          GROUP BY z.zone_name
          ORDER BY visits DESC, z.zone_name COLLATE NOCASE ASC
          LIMIT 200
          `,
          [cid]
        )
      : [];
    const allZones = await this.db.all(
      `
      SELECT zone_name AS name
      FROM zones
      ORDER BY zone_name COLLATE NOCASE ASC
      LIMIT 500
      `
    );

    const seen = new Set();
    const merged = [];
    const mergedSources = [
      ...this.zoneCatalog.map((name) => ({ name })),
      ...characterZones,
      ...allZones
    ];
    for (const row of mergedSources) {
      const name = String(row?.name || "").trim();
      if (!name) {
        continue;
      }
      const key = name.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(name);
    }
    return merged;
  }

  async addManualZoneEntry(characterId, zoneName, timestamp = null) {
    const cid = Number(characterId);
    if (!Number.isFinite(cid) || cid <= 0) {
      return { ok: false, error: "Invalid character id." };
    }
    const cleanZone = String(zoneName || "").trim();
    if (!cleanZone) {
      return { ok: false, error: "Zone name is required." };
    }

    const character = await this.db.get("SELECT id FROM characters WHERE id = ?", [cid]);
    if (!character) {
      return { ok: false, error: "Character not found." };
    }

    const eventTime =
      typeof timestamp === "string" && timestamp.trim()
        ? timestamp.trim()
        : new Date().toISOString();
    await this.db.run("INSERT OR IGNORE INTO zones (zone_name) VALUES (?)", [cleanZone]);
    const zone = await this.db.get("SELECT id FROM zones WHERE zone_name = ?", [cleanZone]);
    if (!zone?.id) {
      return { ok: false, error: "Failed to resolve zone id." };
    }
    await this.db.run(
      "INSERT INTO zone_activity (character_id, zone_id, timestamp) VALUES (?, ?, ?)",
      [cid, zone.id, eventTime]
    );
    return {
      ok: true,
      characterId: cid,
      zoneName: cleanZone,
      timestamp: eventTime
    };
  }

  async getBadgeTimeline(characterId) {
    return this.db.all(
      `
      SELECT
        b.badge_name,
        b.category,
        b.description,
        b.icon_path,
        bu.timestamp
      FROM badge_unlocks bu
      JOIN badges b ON b.id = bu.badge_id
      WHERE bu.character_id = ?
      ORDER BY bu.timestamp DESC
      `,
      [Number(characterId)]
    );
  }

  async getBadgeBrowser(characterId) {
    return this.db.all(
      `
      SELECT
        b.id,
        b.badge_name,
        b.category,
        b.description,
        b.icon_path,
        bu.timestamp AS unlocked_at,
        CASE WHEN bu.id IS NULL THEN 0 ELSE 1 END AS unlocked
      FROM badges b
      LEFT JOIN badge_unlocks bu
        ON bu.badge_id = b.id
       AND bu.character_id = ?
      ORDER BY b.category COLLATE NOCASE ASC, b.badge_name COLLATE NOCASE ASC
      `,
      [Number(characterId)]
    );
  }

  async unlockBadge(characterId, badgeId, unlockedAt = null) {
    const cid = Number(characterId);
    const bid = Number(badgeId);
    if (!Number.isFinite(cid) || cid <= 0) {
      return { ok: false, error: "Invalid character id." };
    }
    if (!Number.isFinite(bid) || bid <= 0) {
      return { ok: false, error: "Invalid badge id." };
    }

    const badge = await this.db.get(
      "SELECT id, badge_name FROM badges WHERE id = ?",
      [bid]
    );
    if (!badge) {
      return { ok: false, error: "Badge not found." };
    }

    const timestamp =
      typeof unlockedAt === "string" && unlockedAt.trim()
        ? unlockedAt.trim()
        : new Date().toISOString();
    const result = await this.db.run(
      `INSERT OR IGNORE INTO badge_unlocks (character_id, badge_id, timestamp)
       VALUES (?, ?, ?)`,
      [cid, bid, timestamp]
    );
    const row = await this.db.get(
      `SELECT timestamp FROM badge_unlocks
       WHERE character_id = ? AND badge_id = ?`,
      [cid, bid]
    );

    return {
      ok: true,
      created: result.changes > 0,
      badgeId: bid,
      badgeName: badge.badge_name,
      unlockedAt: row?.timestamp || timestamp
    };
  }

  buildInsights(build, levels) {
    const allEnhancements = levels.flatMap((row) => row.enhancements || []);
    const bySet = new Map();
    for (const enh of allEnhancements) {
      const setName = String(enh.enhancement_set || "Unknown").trim() || "Unknown";
      if (!bySet.has(setName)) {
        bySet.set(setName, {
          set_name: setName,
          slots: 0,
          pieces: new Set(),
          powers: new Set()
        });
      }
      const bucket = bySet.get(setName);
      bucket.slots += 1;
      if (enh.set_piece) {
        bucket.pieces.add(String(enh.set_piece));
      }
      if (enh.power_name) {
        bucket.powers.add(enh.power_name);
      }
    }

    const setRows = [...bySet.values()]
      .map((row) => ({
        set_name: row.set_name,
        slots: row.slots,
        unique_pieces: row.pieces.size,
        powers_using_set: row.powers.size
      }))
      .sort((a, b) => b.slots - a.slots);

    const setSummary = {
      total_sets: setRows.length,
      complete_sets: setRows.filter((x) => x.unique_pieces >= 6 || x.slots >= 6).length,
      partial_sets: setRows.filter((x) => x.unique_pieces >= 2 && x.unique_pieces < 6).length,
      likely_unique_ios: setRows.filter((x) => x.slots === 1 && x.unique_pieces <= 1).length,
      purple_sets: setRows.filter((x) => /(apocalypse|armageddon|nucleolus|ragnarok|winter)/i.test(x.set_name))
        .length,
      ato_sets: setRows.filter((x) => /(supremacy|archetype|command of the mastermind|scrapper|blaster|tanker|controller|dominator|stalker|brute|sentinel)/i.test(x.set_name))
        .length,
      top_sets: setRows.slice(0, 12)
    };

    const procSlots = allEnhancements.filter(
      (x) =>
        String(x.set_piece || "").toUpperCase() === "F" ||
        /chance|proc/i.test(String(x.enhancement_uid || ""))
    );
    const procReport = {
      powers_with_proc_enabled: levels.filter((x) => x.proc_include).length,
      powers_total: levels.length,
      estimated_proc_slots: procSlots.length,
      proc_density: levels.length
        ? Number((levels.filter((x) => x.proc_include).length / levels.length).toFixed(2))
        : 0,
      top_proc_powers: levels
        .map((row) => ({
          power_name: row.power_name,
          level: row.level,
          proc_like_slots: (row.enhancements || []).filter(
            (x) =>
              String(x.set_piece || "").toUpperCase() === "F" ||
              /chance|proc/i.test(String(x.enhancement_uid || ""))
          ).length
        }))
        .filter((x) => x.proc_like_slots > 0)
        .sort((a, b) => b.proc_like_slots - a.proc_like_slots)
        .slice(0, 10)
    };

    const slotEfficiency = {
      under_slotted: levels
        .filter((x) => x.enhancement_slots < 3 && x.level > 1)
        .map((x) => ({
          power_name: x.power_name,
          level: x.level,
          slots: x.enhancement_slots
        }))
        .slice(0, 10),
      over_slotted: levels
        .filter((x) => x.enhancement_slots > 6)
        .map((x) => ({
          power_name: x.power_name,
          level: x.level,
          slots: x.enhancement_slots
        }))
        .slice(0, 10),
      slot_paths: levels.slice(0, 16).map((x) => ({
        power_name: x.power_name,
        level: x.level,
        slot_levels: (x.enhancements || [])
          .map((e) => e.slot_level)
          .filter((n) => Number.isFinite(n))
          .sort((a, b) => a - b)
      }))
    };

    const checklistBySet = new Map();
    const checklistByLevel = new Map();
    for (const enh of allEnhancements) {
      const setName = String(enh.enhancement_set || "Unknown");
      const display = String(enh.enhancement_display || enh.enhancement_uid || "Unknown");
      const level = Number(enh.slot_level) || 0;

      if (!checklistBySet.has(setName)) {
        checklistBySet.set(setName, {
          set_name: setName,
          count: 0,
          earliest_level: level,
          items: []
        });
      }
      const setBucket = checklistBySet.get(setName);
      setBucket.count += 1;
      setBucket.earliest_level = Math.min(setBucket.earliest_level, level);
      setBucket.items.push(display);

      if (!checklistByLevel.has(level)) {
        checklistByLevel.set(level, []);
      }
      checklistByLevel.get(level).push({
        enhancement: display,
        set_name: setName,
        power_name: enh.power_name
      });
    }
    const checklist = {
      by_set: [...checklistBySet.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, 20),
      by_level: [...checklistByLevel.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([level, items]) => ({ level, items }))
    };

    const isMastermind = /mastermind/i.test(String(build?.class_name || ""));
    const petPowers = levels.filter(
      (row) =>
        /summon/i.test(String(row.power_uid || "")) ||
        /(soldiers|spec ops|commando|thugs|ninjas|zombies|grave knights|lich|demons|gargoyle|battle drones|protector bots|assault bot|wolf spider|widow spider)/i.test(
          String(row.power_name || "")
        )
    );
    const petEnhancements = petPowers.flatMap((row) => row.enhancements || []);
    const petFocusedSetCount = petEnhancements.filter((enh) =>
      /(command of the mastermind|expedient reinforcement|call to arms|blood mandate|mark of supremacy|sovereign right|soulbound allegiance)/i.test(
        String(enh.enhancement_set || "")
      )
    ).length;
    const mastermind = {
      enabled: isMastermind || petPowers.length > 0,
      pet_powers: petPowers.map((row) => ({
        power_name: row.power_name,
        level: row.level,
        slots: row.enhancement_slots
      })),
      pet_slots_total: petEnhancements.length,
      pet_focused_set_slots: petFocusedSetCount
    };

    const catalogMeta = this.powerCatalog?.getMeta?.() || {};
    const metadataCoverage = levels.length
      ? levels.filter((x) => x.power_icon_path || x.power_description).length / levels.length
      : 1;
    const compatibilityWarnings = [];
    if (build?.mids_database && catalogMeta.database) {
      if (normalize(build.mids_database) !== normalize(catalogMeta.database)) {
        compatibilityWarnings.push(
          `Build database "${build.mids_database}" differs from local power catalog "${catalogMeta.database}".`
        );
      }
    }
    if (build?.mids_database_version && catalogMeta.database_version) {
      if (String(build.mids_database_version) !== String(catalogMeta.database_version)) {
        compatibilityWarnings.push(
          `Build database version ${build.mids_database_version} differs from local catalog version ${catalogMeta.database_version}.`
        );
      }
    }

    return {
      setSummary,
      procReport,
      slotEfficiency,
      checklist,
      mastermind,
      compatibility: {
        metadata_coverage: Number(metadataCoverage.toFixed(2)),
        warnings: compatibilityWarnings
      }
    };
  }

  async getLatestBuildPlan(characterId) {
    const build = await this.db.get(
      `
      SELECT
        id, source_file, imported_at, build_name, class_name, origin, alignment, target_level,
        mids_app, mids_version, mids_database, mids_database_version
      FROM build_plans
      WHERE character_id = ?
      ORDER BY imported_at DESC
      LIMIT 1
      `,
      [Number(characterId)]
    );
    if (!build) {
      return { build: null, levels: [], insights: null };
    }

    const levelsRaw = await this.db.all(
      `
      SELECT
        id, level, power_uid, power_set, power_name,
        stat_include, proc_include, variable_value, inherent_slots_used, enhancement_slots
      FROM build_plan_levels
      WHERE build_plan_id = ?
      ORDER BY level ASC, id ASC
      `,
      [build.id]
    );

    const levelIds = levelsRaw.map((row) => row.id);
    const enhancements = levelIds.length
      ? await this.db.all(
          `
          SELECT
            bpe.build_plan_level_id, bpe.slot_level, bpe.is_inherent, bpe.enhancement_uid,
            bpe.enhancement_display, bpe.enhancement_set, bpe.set_piece, bpe.grade,
            bpe.io_level, bpe.relative_level, bpe.obtained
          FROM build_plan_enhancements bpe
          WHERE bpe.build_plan_level_id IN (${levelIds.map(() => "?").join(",")})
          ORDER BY bpe.slot_level ASC, bpe.id ASC
          `,
          levelIds
        )
      : [];
    const enhByLevel = new Map();
    for (const enh of enhancements) {
      if (!enhByLevel.has(enh.build_plan_level_id)) {
        enhByLevel.set(enh.build_plan_level_id, []);
      }
      enhByLevel.get(enh.build_plan_level_id).push(enh);
    }

    const levels = levelsRaw.map((row) => {
      const metadata = this.powerCatalog?.find?.(row.power_set, row.power_name) || null;
      const entry = {
        ...row,
        stat_include: Boolean(row.stat_include),
        proc_include: Boolean(row.proc_include),
        power_icon_path: metadata?.icon_path || "",
        power_description: metadata?.description || "",
        power_source_page: metadata?.source_page || "",
        enhancements: (enhByLevel.get(row.id) || []).map((enh) => ({
          ...enh,
          is_inherent: Boolean(enh.is_inherent),
          obtained: Boolean(enh.obtained),
          power_name: row.power_name
        }))
      };
      if (!entry.enhancements.length && Number(entry.enhancement_slots) > 0) {
        entry.enhancements = [];
      }
      return entry;
    });

    const displayBuild = {
      ...build,
      class_display: toDisplayClassName(build.class_name)
    };
    const insights = this.buildInsights(displayBuild, levels);
    return { build: displayBuild, levels, insights };
  }
}

module.exports = {
  QueryService
};
