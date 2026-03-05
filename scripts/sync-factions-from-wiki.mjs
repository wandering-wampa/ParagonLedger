import fs from "fs/promises";
import path from "path";

const API = "https://homecoming.wiki/w/api.php";
const ENEMY_CATEGORY = "Category:Enemies";
const BATCH_SIZE = 20;
const OUT_FILE = path.resolve("data", "factions.json");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]#|]+)(?:#[^\]]*)?\]\]/g, "$1")
    .replace(/\{\{[^{}]*\}\}/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/''+/g, "")
    .replace(/[{}[\]|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function stripWikiMarkup(value) {
  return String(value || "")
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]#|]+)(?:#[^\]]*)?\]\]/g, "$1")
    .replace(/\{\{[^{}]*\}\}/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/''+/g, "")
    .replace(/[{}[\]|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function aliasesForFaction(title) {
  const aliases = new Set();
  const clean = String(title || "").trim();
  if (!clean) {
    return [];
  }
  aliases.add(clean.toLowerCase());
  aliases.add(clean.replace(/^the\s+/i, "").toLowerCase());
  aliases.add(clean.replace(/\s+\(.+?\)\s*$/, "").toLowerCase());
  aliases.add(clean.replace(/'/g, "").toLowerCase());
  return [...aliases].filter(Boolean);
}

function extractEnemyNames(rawWikiText) {
  const names = new Set();
  const generic = new Set([
    "overview",
    "background",
    "enemy types",
    "villain types",
    "subgroups",
    "underlings",
    "minions",
    "lieutenants",
    "bosses",
    "elite bosses",
    "archvillains",
    "named enemies",
    "named bosses",
    "related badges",
    "powers"
  ]);

  const headingRegex = /^={4,6}\s*(.+?)\s*={4,6}\s*$/gm;
  let headingMatch = headingRegex.exec(rawWikiText);
  while (headingMatch) {
    const heading = stripWikiMarkup(headingMatch[1] || "")
      .replace(/\s+\([^)]*\)\s*$/g, "")
      .replace(/\s+\/\s+/g, " / ")
      .trim();
    const key = heading.toLowerCase();
    if (
      heading &&
      heading.length >= 3 &&
      heading.length <= 80 &&
      !generic.has(key) &&
      !/^\d+px$/i.test(heading)
    ) {
      names.add(heading);
    }
    headingMatch = headingRegex.exec(rawWikiText);
  }

  const bulletRegex = /^\*\s*(.+?)\s*$/gm;
  let bulletMatch = bulletRegex.exec(rawWikiText);
  while (bulletMatch) {
    const line = stripWikiMarkup(bulletMatch[1] || "");
    const candidate = line.split(":")[0].split("(")[0].trim();
    const key = candidate.toLowerCase();
    if (
      candidate &&
      candidate.length >= 3 &&
      candidate.length <= 80 &&
      !generic.has(key)
    ) {
      names.add(candidate);
    }
    bulletMatch = bulletRegex.exec(rawWikiText);
  }

  return [...names].sort((a, b) => a.localeCompare(b));
}

async function wikiApi(params) {
  const query = new URLSearchParams({
    format: "json",
    formatversion: "2",
    ...params
  });
  const url = `${API}?${query.toString()}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "ParagonLedger/0.1 (faction sync tool)"
    }
  });
  if (!response.ok) {
    throw new Error(`Wiki API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function getFactionPages() {
  const pages = [];
  let cmcontinue = null;
  do {
    const payload = await wikiApi({
      action: "query",
      list: "categorymembers",
      cmtitle: ENEMY_CATEGORY,
      cmtype: "page",
      cmlimit: "max",
      ...(cmcontinue ? { cmcontinue } : {})
    });
    for (const member of payload.query?.categorymembers || []) {
      if (member.ns === 0 && member.title) {
        pages.push(member.title);
      }
    }
    cmcontinue = payload.continue?.cmcontinue || null;
    if (cmcontinue) {
      await sleep(80);
    }
  } while (cmcontinue);
  return [...new Set(pages)].sort((a, b) => a.localeCompare(b));
}

async function fetchFactionCorpora(titles) {
  const batches = chunk(titles, BATCH_SIZE);
  const out = [];
  for (let i = 0; i < batches.length; i += 1) {
    const payload = await wikiApi({
      action: "query",
      redirects: "1",
      prop: "revisions",
      rvprop: "content",
      rvslots: "main",
      titles: batches[i].join("|")
    });
    for (const page of payload.query?.pages || []) {
      if (page.missing) {
        continue;
      }
      const text = page.revisions?.[0]?.slots?.main?.content || "";
      if (!text) {
        continue;
      }
      out.push({
        faction_name: page.title,
        aliases: aliasesForFaction(page.title),
        source_page: page.title,
        enemy_names: extractEnemyNames(text),
        corpus: normalizeText(text)
      });
    }
    process.stdout.write(`Fetched faction pages: ${i + 1}/${batches.length}\r`);
    await sleep(80);
  }
  process.stdout.write("\n");
  return out;
}

async function main() {
  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  console.log("Fetching faction list from Homecoming Wiki...");
  const titles = await getFactionPages();
  console.log(`Found ${titles.length} faction pages.`);
  const entries = await fetchFactionCorpora(titles);
  await fs.writeFile(OUT_FILE, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  console.log(`Wrote ${entries.length} factions to ${OUT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
