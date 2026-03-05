const fs = require("fs");
const path = require("path");

const POWERS_PATH = path.resolve(__dirname, "..", "..", "..", "data", "powers.json");
const BADGES_PATH = path.resolve(__dirname, "..", "..", "..", "data", "badges.json");

const INCARNATE_SLOT_ICON_BY_SET = {
  alpha: "assets/badges/badge-accolade-alphaslot.png",
  destiny: "assets/badges/badge-accolade-destinyslot.png",
  hybrid: "assets/badges/badge-accolade-hybridslot.png",
  interface: "assets/badges/badge-accolade-interfaceslot.png",
  judgment: "assets/badges/badge-accolade-judgementslot.png",
  judgement: "assets/badges/badge-accolade-judgementslot.png",
  lore: "assets/badges/badge-accolade-loreslot.png"
};

const INCARNATE_SLOT_DESCRIPTION = {
  alpha:
    "Alpha abilities are passive global boosts that enhance core stats such as damage, recharge, accuracy, endurance, or defense.",
  destiny:
    "Destiny abilities are click powers that provide strong team buffs such as resistance, defense, mez protection, recovery, or healing.",
  hybrid:
    "Hybrid abilities add stance-like combat effects that can improve personal damage/survivability or provide team-support bonuses.",
  interface:
    "Interface abilities add on-hit proc effects to your attacks, typically adding damage-over-time or applying debuffs to targets.",
  judgment:
    "Judgment abilities are high-impact AoE attacks used on cooldown for burst damage and crowd pressure.",
  judgement:
    "Judgment abilities are high-impact AoE attacks used on cooldown for burst damage and crowd pressure.",
  lore:
    "Lore abilities summon powerful NPC allies for temporary combat support."
};

const INCARNATE_FAMILY_HINTS = {
  ageless: "Ageless variants emphasize recovery and recharge support.",
  assault: "Assault variants emphasize outgoing damage bonuses.",
  barrier: "Barrier variants emphasize defense and resistance for you and allies.",
  cardiac: "Cardiac variants emphasize endurance efficiency and resistance bonuses.",
  clarion: "Clarion variants emphasize mez protection and control resistance.",
  control: "Control variants emphasize control/debuff support effects.",
  degenerative: "Degenerative variants emphasize reducing enemy maximum health.",
  diamagnetic: "Diamagnetic variants emphasize enemy to-hit and regeneration debuffs.",
  incandescence: "Incandescence variants emphasize teleport/reposition utility.",
  intuition: "Intuition variants emphasize damage, range, and control potency.",
  lore: "Lore variants provide summoned ally support.",
  melee: "Melee variants emphasize close-range survivability and offense.",
  musculature: "Musculature variants emphasize damage and endurance modification.",
  nerve: "Nerve variants emphasize accuracy and control effectiveness.",
  reactive: "Reactive variants emphasize added fire damage and resistance debuffs.",
  rebirth: "Rebirth variants emphasize burst healing and regeneration support.",
  spiritual: "Spiritual variants emphasize recharge, healing, and control support.",
  support: "Support variants emphasize team utility and survivability.",
  vigor: "Vigor variants emphasize accuracy, healing, and endurance modification."
};

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLevelPrefix(value) {
  return String(value || "")
    .replace(/^l\d+\s*-\s*/i, "")
    .trim();
}

function firstToken(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)[0]
    ?.toLowerCase() || "";
}

function badgeNameKeys(value) {
  const clean = stripLevelPrefix(value);
  const keys = new Set([normalize(clean)]);
  keys.add(normalize(clean.replace(/\bmarshall\b/gi, "marshal")));
  keys.add(normalize(clean.replace(/\bmusculature\b/gi, "musculature")));
  return [...keys].filter(Boolean);
}

function cleanBadgeDescription(value) {
  return String(value || "")
    .replace(/;\s*heroes?\s*/gi, "Heroes: ")
    .replace(/;\s*villains?\s*/gi, "Villains: ")
    .replace(/\s*;\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

class PowerCatalogService {
  constructor() {
    this.meta = {};
    this.bySetAndName = new Map();
    this.byName = new Map();
    this.badgesByName = new Map();
    this.load();
  }

  load() {
    if (!fs.existsSync(POWERS_PATH)) {
      this.meta = {};
      this.bySetAndName.clear();
      this.byName.clear();
      this.badgesByName.clear();
      return;
    }
    const raw = JSON.parse(fs.readFileSync(POWERS_PATH, "utf8"));
    const powers = Array.isArray(raw?.powers) ? raw.powers : [];
    this.meta = raw?.meta || {};
    this.bySetAndName.clear();
    this.byName.clear();
    this.badgesByName.clear();

    for (const power of powers) {
      if (!power || !power.power_name) {
        continue;
      }
      const nameKey = normalize(power.power_name);
      const setKey = normalize(power.power_set);
      const composite = `${setKey}|${nameKey}`;
      this.bySetAndName.set(composite, power);
      if (!this.byName.has(nameKey)) {
        this.byName.set(nameKey, []);
      }
      this.byName.get(nameKey).push(power);
    }

    if (fs.existsSync(BADGES_PATH)) {
      const badgesRaw = JSON.parse(fs.readFileSync(BADGES_PATH, "utf8"));
      const badges = Array.isArray(badgesRaw) ? badgesRaw : [];
      for (const badge of badges) {
        const badgeName = String(badge?.badge_name || "").trim();
        if (!badgeName) {
          continue;
        }
        const key = normalize(badgeName);
        if (!this.badgesByName.has(key)) {
          this.badgesByName.set(key, []);
        }
        this.badgesByName.get(key).push(badge);
      }
    }
  }

  getMeta() {
    return this.meta || {};
  }

  findBadgeMetadata(powerName, powerSet) {
    const setKey = normalize(powerSet);
    const isAccoladeSet = /accolade/.test(setKey);
    if (!isAccoladeSet) {
      return null;
    }
    const keys = badgeNameKeys(powerName);
    const candidates = keys.flatMap((key) => this.badgesByName.get(key) || []);
    if (!candidates.length) {
      return null;
    }

    const preferred =
      candidates.find((row) => {
        const category = normalize(row?.category || "");
        return isAccoladeSet ? /accolade/.test(category) : category.includes(setKey);
      }) ||
      candidates.find((row) => String(row?.description || "").trim()) ||
      candidates[0];

    if (!preferred) {
      return null;
    }

    return {
      power_set: powerSet || preferred.category || "Accolades",
      power_name: powerName,
      description: cleanBadgeDescription(preferred.description),
      icon_path: String(preferred.icon_path || "").trim(),
      source_page: `badge:${preferred.category || "Unknown"}`
    };
  }

  findIncarnateFallback(powerSet, powerName) {
    const setKey = normalize(powerSet);
    const slotKey = ["alpha", "destiny", "hybrid", "interface", "judgment", "judgement", "lore"].find(
      (token) => setKey.includes(token)
    );
    if (!slotKey) {
      return null;
    }

    const family = firstToken(stripLevelPrefix(powerName));
    const slotDescription = INCARNATE_SLOT_DESCRIPTION[slotKey] || "";
    const familyHint = INCARNATE_FAMILY_HINTS[family] || "";
    const description = [slotDescription, familyHint].filter(Boolean).join(" ");

    return {
      power_set: powerSet,
      power_name: powerName,
      description,
      icon_path: INCARNATE_SLOT_ICON_BY_SET[slotKey] || "",
      source_page: "incarnate:fallback"
    };
  }

  find(powerSet, powerName) {
    const cleanPowerName = stripLevelPrefix(powerName);
    const setKey = normalize(powerSet);
    const nameKey = normalize(cleanPowerName);
    if (!nameKey) {
      return null;
    }
    const composite = `${setKey}|${nameKey}`;
    if (this.bySetAndName.has(composite)) {
      return this.bySetAndName.get(composite);
    }
    const matches = this.byName.get(nameKey) || [];
    if (!matches.length) {
      const badgeMeta = this.findBadgeMetadata(cleanPowerName, powerSet);
      if (badgeMeta) {
        return badgeMeta;
      }
      return this.findIncarnateFallback(powerSet, cleanPowerName);
    }
    if (setKey) {
      const withSetMention = matches.find((row) =>
        normalize(row?.source_page || "").includes(setKey)
      );
      if (withSetMention) {
        return withSetMention;
      }
    }
    return matches[0];
  }
}

module.exports = {
  PowerCatalogService
};
