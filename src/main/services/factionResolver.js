const fs = require("fs");
const path = require("path");

const FACTIONS_PATH = path.resolve(__dirname, "..", "..", "..", "data", "factions.json");

const KEYWORD_RULES = [
  { faction: "Hellions", terms: ["hellion", "fallen ", "damned "] },
  { faction: "Skulls", terms: ["skull"] },
  { faction: "Outcasts", terms: ["outcast"] },
  { faction: "Clockwork", terms: ["clockwork"] },
  { faction: "The Family", terms: ["family", "capo", "consigliere"] },
  { faction: "The Lost", terms: ["lost"] },
  { faction: "Circle of Thorns", terms: ["thorn", "spectral daemon"] },
  { faction: "Council", terms: ["council"] },
  { faction: "5th Column", terms: ["5th column", "fifth column"] },
  { faction: "Crey", terms: ["crey"] },
  { faction: "Freakshow", terms: ["freakshow", "freak"] },
  { faction: "Nemesis", terms: ["nemesis"] },
  { faction: "Rikti", terms: ["rikti"] },
  { faction: "Malta", terms: ["malta"] },
  { faction: "Carnival of Shadows", terms: ["carnival"] },
  { faction: "Banished Pantheon", terms: ["pantheon"] },
  { faction: "Arachnos", terms: ["arachnos"] },
  { faction: "Longbow", terms: ["longbow"] },
  { faction: "PPD", terms: ["ppd"] },
  { faction: "Vahzilok", terms: ["vahzilok"] },
  { faction: "Tsoo", terms: ["tsoo"] }
];

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

class FactionResolver {
  constructor() {
    this.cache = new Map();
    this.entries = [];
    this.load();
  }

  load() {
    if (!fs.existsSync(FACTIONS_PATH)) {
      return;
    }
    const parsed = JSON.parse(fs.readFileSync(FACTIONS_PATH, "utf8"));
    this.entries = (parsed || [])
      .filter((row) => row && row.faction_name && row.corpus)
      .map((row) => ({
        factionName: row.faction_name,
        aliases: (row.aliases || []).map(normalize).filter(Boolean),
        enemyNames: (row.enemy_names || []).map(normalize).filter(Boolean),
        corpus: normalize(row.corpus)
      }));
  }

  infer(enemyName) {
    const key = normalize(enemyName);
    if (!key || key.length < 3) {
      return "Unknown";
    }
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }

    for (const rule of KEYWORD_RULES) {
      if (rule.terms.some((term) => key.includes(term))) {
        this.cache.set(key, rule.faction);
        return rule.faction;
      }
    }

    for (const entry of this.entries) {
      if (entry.enemyNames.includes(key)) {
        const result = entry.factionName;
        this.cache.set(key, result);
        return result;
      }
    }

    const matches = [];
    for (const entry of this.entries) {
      let score = 0;
      for (const enemyName of entry.enemyNames) {
        if (!enemyName || enemyName.length < 3) {
          continue;
        }
        if (key.includes(enemyName) || enemyName.includes(key)) {
          score = Math.max(score, Math.min(enemyName.length, key.length) + 80);
        }
      }
      if (entry.aliases.some((alias) => key.includes(alias) || alias.includes(key))) {
        score = Math.max(score, key.length + 40);
      }
      if (!score && !entry.corpus.includes(key)) {
        continue;
      }
      if (!score) {
        score = key.length;
      }
      matches.push({ faction: entry.factionName, score });
    }
    if (!matches.length) {
      this.cache.set(key, "Unknown");
      return "Unknown";
    }
    matches.sort((a, b) => b.score - a.score);
    const result = matches[0].faction;
    this.cache.set(key, result);
    return result;
  }
}

module.exports = {
  FactionResolver
};
