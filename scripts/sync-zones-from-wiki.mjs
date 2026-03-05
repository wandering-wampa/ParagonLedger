import fs from "fs/promises";
import path from "path";

const API = "https://homecoming.wiki/w/api.php";
const ROOT_CATEGORIES = [
  "Category:Zones",
  "Category:City Zones",
  "Category:Hazard Zones",
  "Category:Trial Zones",
  "Category:PvP Zones",
  "Category:Co-op Zones",
  "Category:Rogue Isles Zones",
  "Category:Praetorian Zones"
];
const OUT_FILE = path.resolve("data", "zones.json");
const BATCH_SIZE = 40;

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

function cleanCategoryName(value) {
  return String(value || "").replace(/^Category:/i, "").trim();
}

function cleanZoneName(value) {
  return String(value || "")
    .replace(/\s*\(zone\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function wikiApi(params) {
  const query = new URLSearchParams({
    format: "json",
    formatversion: "2",
    ...params
  });
  const response = await fetch(`${API}?${query.toString()}`, {
    headers: {
      "User-Agent": "ParagonLedger/0.1 (zone sync tool)"
    }
  });
  if (!response.ok) {
    throw new Error(`Wiki API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function collectZonePages() {
  const queue = [...ROOT_CATEGORIES];
  const seenCategories = new Set();
  const pages = new Set();

  while (queue.length) {
    const category = queue.shift();
    const categoryKey = category.toLowerCase();
    if (seenCategories.has(categoryKey)) {
      continue;
    }
    seenCategories.add(categoryKey);

    let cmcontinue = null;
    do {
      const payload = await wikiApi({
        action: "query",
        list: "categorymembers",
        cmtitle: category,
        cmtype: "page|subcat",
        cmlimit: "max",
        ...(cmcontinue ? { cmcontinue } : {})
      });
      for (const member of payload.query?.categorymembers || []) {
        if (member.ns === 14 && member.title) {
          queue.push(member.title);
          continue;
        }
        if (member.ns === 0 && member.title) {
          pages.add(member.title);
        }
      }
      cmcontinue = payload.continue?.cmcontinue || null;
      if (cmcontinue) {
        await sleep(60);
      }
    } while (cmcontinue);
  }

  return [...pages].sort((a, b) => a.localeCompare(b));
}

async function filterLikelyZones(pageTitles) {
  const candidates = [];
  const batches = chunk(pageTitles, BATCH_SIZE);
  for (let i = 0; i < batches.length; i += 1) {
    const payload = await wikiApi({
      action: "query",
      redirects: "1",
      prop: "categories|revisions",
      cllimit: "max",
      rvprop: "content",
      rvslots: "main",
      titles: batches[i].join("|")
    });

    for (const page of payload.query?.pages || []) {
      if (page.missing || !page.title) {
        continue;
      }
      const title = cleanZoneName(page.title);
      if (!title) {
        continue;
      }
      const categories = (page.categories || []).map((c) => cleanCategoryName(c.title));
      const text = String(page.revisions?.[0]?.slots?.main?.content || "");
      const hasZoneCategory = categories.some((c) => /\bzones?\b/i.test(c));
      const hasZoneTemplate = /\{\{\s*(zone|zone infobox|zonebox)\b/i.test(text);
      if (hasZoneCategory || hasZoneTemplate) {
        candidates.push({
          name: title,
          source_page: page.title,
          categories
        });
      }
    }

    process.stdout.write(`Checked zone pages: ${i + 1}/${batches.length}\r`);
    await sleep(60);
  }
  process.stdout.write("\n");

  const byName = new Map();
  for (const row of candidates) {
    const key = row.name.toLowerCase();
    if (!byName.has(key)) {
      byName.set(key, row);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function main() {
  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });

  console.log("Collecting zone pages from Homecoming Wiki category tree...");
  const pageTitles = await collectZonePages();
  console.log(`Found ${pageTitles.length} candidate pages.`);

  const zones = await filterLikelyZones(pageTitles);
  console.log(`Filtered to ${zones.length} likely zones.`);

  const output = {
    meta: {
      source: "homecoming.wiki",
      generated_at: new Date().toISOString(),
      root_categories: ROOT_CATEGORIES
    },
    zones
  };
  await fs.writeFile(OUT_FILE, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Wrote ${zones.length} zones to ${OUT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
