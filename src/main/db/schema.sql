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
  display_order INTEGER NOT NULL DEFAULT 0,
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
