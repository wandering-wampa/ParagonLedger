class QueryService {
  constructor(db) {
    this.db = db;
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
        (SELECT COUNT(*) FROM badge_unlocks bu WHERE bu.character_id = c.id) AS badges_earned,
        (SELECT COUNT(*) FROM enemy_defeats ed WHERE ed.character_id = c.id) AS enemies_defeated,
        (SELECT COUNT(*) FROM missions m WHERE m.character_id = c.id) AS missions_completed,
        (SELECT IFNULL(SUM(ie.amount), 0) FROM influence_events ie WHERE ie.character_id = c.id) AS influence_earned
      FROM characters c
      JOIN accounts a ON a.id = c.account_id
      WHERE (? IS NULL OR c.account_id = ?)
      ORDER BY c.name COLLATE NOCASE ASC
      `,
      hasAccountFilter ? [Number(accountId), Number(accountId)] : [null, null]
    );
    return rows.filter((row) => this.isDisplayableCharacterName(row.name));
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

    const topPowers = await this.db.all(
      `
      SELECT power_name AS name, COUNT(*) AS uses
      FROM powers_used
      WHERE character_id = ?
      GROUP BY power_name
      ORDER BY uses DESC
      LIMIT 10
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
      topPowers,
      topZones
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

  async getLatestBuildPlan(characterId) {
    const build = await this.db.get(
      `
      SELECT id, source_file, imported_at
      FROM build_plans
      WHERE character_id = ?
      ORDER BY imported_at DESC
      LIMIT 1
      `,
      [Number(characterId)]
    );
    if (!build) {
      return { build: null, levels: [] };
    }
    const levels = await this.db.all(
      `
      SELECT level, power_name, enhancement_slots
      FROM build_plan_levels
      WHERE build_plan_id = ?
      ORDER BY level ASC
      `,
      [build.id]
    );
    return { build, levels };
  }
}

module.exports = {
  QueryService
};
