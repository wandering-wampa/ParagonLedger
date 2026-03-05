const fs = require("fs");
const path = require("path");

const POWERS_PATH = path.resolve(__dirname, "..", "..", "..", "data", "powers.json");

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

class PowerCatalogService {
  constructor() {
    this.meta = {};
    this.bySetAndName = new Map();
    this.byName = new Map();
    this.load();
  }

  load() {
    if (!fs.existsSync(POWERS_PATH)) {
      this.meta = {};
      this.bySetAndName.clear();
      this.byName.clear();
      return;
    }
    const raw = JSON.parse(fs.readFileSync(POWERS_PATH, "utf8"));
    const powers = Array.isArray(raw?.powers) ? raw.powers : [];
    this.meta = raw?.meta || {};
    this.bySetAndName.clear();
    this.byName.clear();

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
  }

  getMeta() {
    return this.meta || {};
  }

  find(powerSet, powerName) {
    const setKey = normalize(powerSet);
    const nameKey = normalize(powerName);
    if (!nameKey) {
      return null;
    }
    const composite = `${setKey}|${nameKey}`;
    if (this.bySetAndName.has(composite)) {
      return this.bySetAndName.get(composite);
    }
    const matches = this.byName.get(nameKey) || [];
    if (!matches.length) {
      return null;
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
