const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3");

function promisifyDatabase(rawDb) {
  return {
    run(sql, params = []) {
      return new Promise((resolve, reject) => {
        rawDb.run(sql, params, function onRun(err) {
          if (err) {
            reject(err);
            return;
          }
          resolve({ lastID: this.lastID, changes: this.changes });
        });
      });
    },
    get(sql, params = []) {
      return new Promise((resolve, reject) => {
        rawDb.get(sql, params, (err, row) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(row);
        });
      });
    },
    all(sql, params = []) {
      return new Promise((resolve, reject) => {
        rawDb.all(sql, params, (err, rows) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(rows);
        });
      });
    },
    exec(sql) {
      return new Promise((resolve, reject) => {
        rawDb.exec(sql, (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        rawDb.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
    }
  };
}

async function ensureSchema(db) {
  await db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      logs_dir TEXT NOT NULL,
      created_date TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      archetype TEXT,
      created_date TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(account_id) REFERENCES accounts(id),
      UNIQUE(account_id, name)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT,
      FOREIGN KEY(character_id) REFERENCES characters(id)
    );

    CREATE TABLE IF NOT EXISTS zones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      zone_name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS zone_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL,
      zone_id INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      FOREIGN KEY(character_id) REFERENCES characters(id),
      FOREIGN KEY(zone_id) REFERENCES zones(id)
    );

    CREATE TABLE IF NOT EXISTS enemy_defeats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL,
      enemy_name TEXT NOT NULL,
      enemy_faction TEXT,
      timestamp TEXT NOT NULL,
      FOREIGN KEY(character_id) REFERENCES characters(id)
    );

    CREATE TABLE IF NOT EXISTS missions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL,
      mission_name TEXT NOT NULL,
      zone TEXT,
      timestamp TEXT NOT NULL,
      FOREIGN KEY(character_id) REFERENCES characters(id)
    );

    CREATE TABLE IF NOT EXISTS influence_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      FOREIGN KEY(character_id) REFERENCES characters(id)
    );

    CREATE TABLE IF NOT EXISTS badges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      badge_name TEXT UNIQUE NOT NULL,
      category TEXT,
      description TEXT,
      icon_path TEXT
    );

    CREATE TABLE IF NOT EXISTS badge_unlocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL,
      badge_id INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      UNIQUE(character_id, badge_id),
      FOREIGN KEY(character_id) REFERENCES characters(id),
      FOREIGN KEY(badge_id) REFERENCES badges(id)
    );

    CREATE TABLE IF NOT EXISTS powers_used (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL,
      power_name TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      FOREIGN KEY(character_id) REFERENCES characters(id)
    );

    CREATE TABLE IF NOT EXISTS loot_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      FOREIGN KEY(character_id) REFERENCES characters(id)
    );

    CREATE TABLE IF NOT EXISTS build_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL,
      source_file TEXT,
      build_name TEXT,
      class_name TEXT,
      origin TEXT,
      alignment TEXT,
      target_level INTEGER,
      mids_app TEXT,
      mids_version TEXT,
      mids_database TEXT,
      mids_database_version TEXT,
      imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(character_id) REFERENCES characters(id)
    );

    CREATE TABLE IF NOT EXISTS build_plan_levels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      build_plan_id INTEGER NOT NULL,
      level INTEGER NOT NULL,
      power_uid TEXT,
      power_set TEXT,
      power_name TEXT NOT NULL,
      stat_include INTEGER NOT NULL DEFAULT 1,
      proc_include INTEGER NOT NULL DEFAULT 1,
      variable_value INTEGER NOT NULL DEFAULT 0,
      inherent_slots_used INTEGER NOT NULL DEFAULT 0,
      enhancement_slots INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(build_plan_id) REFERENCES build_plans(id)
    );

    CREATE TABLE IF NOT EXISTS build_plan_enhancements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      build_plan_level_id INTEGER NOT NULL,
      slot_level INTEGER NOT NULL DEFAULT 0,
      is_inherent INTEGER NOT NULL DEFAULT 0,
      enhancement_uid TEXT NOT NULL,
      enhancement_display TEXT,
      enhancement_set TEXT,
      set_piece TEXT,
      grade TEXT,
      io_level INTEGER,
      relative_level TEXT,
      obtained INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(build_plan_level_id) REFERENCES build_plan_levels(id)
    );

    CREATE TABLE IF NOT EXISTS parser_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT UNIQUE NOT NULL,
      last_offset INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

async function hasColumn(db, table, column) {
  const info = await db.all(`PRAGMA table_info(${table})`);
  return info.some((row) => row.name === column);
}

async function ensureDefaultAccount(db) {
  await db.run(
    `INSERT OR IGNORE INTO accounts (name, logs_dir)
     VALUES (?, ?)`,
    ["DefaultAccount", ""]
  );
  return db.get("SELECT id FROM accounts WHERE name = ?", ["DefaultAccount"]);
}

async function rebuildCharactersTableForAccounts(db, fallbackAccountId) {
  const schema = await db.get(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'characters'`
  );
  if (!schema || !schema.sql || !schema.sql.includes("name TEXT UNIQUE")) {
    await db.run(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_characters_account_name ON characters(account_id, name)"
    );
    return;
  }

  await db.exec("PRAGMA foreign_keys = OFF;");
  await db.exec("BEGIN TRANSACTION;");
  try {
    await db.exec("DROP TABLE IF EXISTS characters_new;");
    await db.exec(`
      CREATE TABLE IF NOT EXISTS characters_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        archetype TEXT,
        created_date TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(account_id) REFERENCES accounts(id),
        UNIQUE(account_id, name)
      );
    `);
    await db.run(
      `
      INSERT INTO characters_new (id, account_id, name, archetype, created_date)
      SELECT
        id,
        COALESCE(account_id, ?),
        name,
        archetype,
        created_date
      FROM characters
      `,
      [fallbackAccountId]
    );
    await db.exec("DROP TABLE characters;");
    await db.exec("ALTER TABLE characters_new RENAME TO characters;");
    await db.exec("COMMIT;");
  } catch (err) {
    await db.exec("ROLLBACK;");
    throw err;
  } finally {
    await db.exec("PRAGMA foreign_keys = ON;");
  }
}

async function migrateLegacySchema(db) {
  const hasAccounts = await db.get(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'accounts'`
  );
  if (!hasAccounts) {
    await db.exec(`
      CREATE TABLE accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        logs_dir TEXT NOT NULL,
        created_date TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  const accountIdExists = await hasColumn(db, "characters", "account_id");
  if (!accountIdExists) {
    await db.exec("ALTER TABLE characters ADD COLUMN account_id INTEGER;");
  }

  const enemyFactionExists = await hasColumn(db, "enemy_defeats", "enemy_faction");
  if (!enemyFactionExists) {
    await db.exec("ALTER TABLE enemy_defeats ADD COLUMN enemy_faction TEXT;");
  }

  const buildPlanColumns = [
    ["build_name", "TEXT"],
    ["class_name", "TEXT"],
    ["origin", "TEXT"],
    ["alignment", "TEXT"],
    ["target_level", "INTEGER"],
    ["mids_app", "TEXT"],
    ["mids_version", "TEXT"],
    ["mids_database", "TEXT"],
    ["mids_database_version", "TEXT"]
  ];
  for (const [name, type] of buildPlanColumns) {
    const exists = await hasColumn(db, "build_plans", name);
    if (!exists) {
      await db.exec(`ALTER TABLE build_plans ADD COLUMN ${name} ${type};`);
    }
  }

  const buildLevelColumns = [
    ["power_uid", "TEXT"],
    ["power_set", "TEXT"],
    ["stat_include", "INTEGER NOT NULL DEFAULT 1"],
    ["proc_include", "INTEGER NOT NULL DEFAULT 1"],
    ["variable_value", "INTEGER NOT NULL DEFAULT 0"],
    ["inherent_slots_used", "INTEGER NOT NULL DEFAULT 0"]
  ];
  for (const [name, type] of buildLevelColumns) {
    const exists = await hasColumn(db, "build_plan_levels", name);
    if (!exists) {
      await db.exec(`ALTER TABLE build_plan_levels ADD COLUMN ${name} ${type};`);
    }
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS build_plan_enhancements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      build_plan_level_id INTEGER NOT NULL,
      slot_level INTEGER NOT NULL DEFAULT 0,
      is_inherent INTEGER NOT NULL DEFAULT 0,
      enhancement_uid TEXT NOT NULL,
      enhancement_display TEXT,
      enhancement_set TEXT,
      set_piece TEXT,
      grade TEXT,
      io_level INTEGER,
      relative_level TEXT,
      obtained INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(build_plan_level_id) REFERENCES build_plan_levels(id)
    );
  `);

  const nullAccountRows = await db.get(
    "SELECT COUNT(*) AS count FROM characters WHERE account_id IS NULL"
  );
  let fallbackAccountId = 0;
  if (!accountIdExists || (nullAccountRows && nullAccountRows.count > 0)) {
    const defaultAccount = await ensureDefaultAccount(db);
    fallbackAccountId = defaultAccount.id;
    await db.run("UPDATE characters SET account_id = ? WHERE account_id IS NULL", [
      defaultAccount.id
    ]);
  }
  await rebuildCharactersTableForAccounts(db, fallbackAccountId);
}

async function seedBadges(db) {
  const dataPath = path.resolve(__dirname, "..", "..", "..", "data", "badges.json");
  if (!fs.existsSync(dataPath)) {
    return;
  }
  const badges = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  for (const badge of badges) {
    await db.run(
      `INSERT INTO badges (badge_name, category, description, icon_path)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(badge_name)
       DO UPDATE SET
         category = excluded.category,
         description = excluded.description,
         icon_path = excluded.icon_path`,
      [badge.badge_name, badge.category, badge.description, badge.icon_path]
    );
  }
}

async function initDatabase(userDataPath) {
  const appDir = path.join(userDataPath, "ParagonLedger");
  const legacyAppDir = path.join(userDataPath, "HeroLedger");
  fs.mkdirSync(appDir, { recursive: true });
  const dbPath = path.join(appDir, "heroledger.sqlite");
  const legacyDbPath = path.join(legacyAppDir, "heroledger.sqlite");
  if (!fs.existsSync(dbPath) && fs.existsSync(legacyDbPath)) {
    fs.copyFileSync(legacyDbPath, dbPath);
  }
  const rawDb = new sqlite3.Database(dbPath);
  const db = promisifyDatabase(rawDb);
  await ensureSchema(db);
  await migrateLegacySchema(db);
  await seedBadges(db);
  return db;
}

module.exports = {
  initDatabase
};
