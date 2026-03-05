import fs from "fs/promises";
import path from "path";

const API = "https://homecoming.wiki/w/api.php";
const ROOT_CATEGORIES = [
  "Category:Power Sets",
  "Category:Power Pools",
  "Category:Epic Power Sets",
  "Category:Patron Power Sets",
  "Category:Ancillary Power Sets",
  "Category:Inherent Powers"
];
const OUT_JSON = path.resolve("data", "powers.json");
const OUT_ICONS_DIR = path.resolve("assets", "powers");
const BATCH_SIZE = 20;

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

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .trim();
}

function cleanWikiText(text) {
  return String(text || "")
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]#|]+)(?:#[^\]]*)?\]\]/g, "$1")
    .replace(/\{\{[^{}]+\}\}/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/''+/g, "")
    .replace(/[{}[\]|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readParam(template, key) {
  const re = new RegExp(
    `\\|\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*([\\s\\S]*?)(?=\\|\\s*[A-Za-z_]+\\s*=|\\}\\})`,
    "i"
  );
  const match = template.match(re);
  return match ? cleanWikiText(match[1]) : "";
}

function extractPowerRows(wikitext) {
  const rows = [];
  const lines = String(wikitext || "").split(/\r?\n/);
  let inRow = false;
  let buffer = "";
  for (const line of lines) {
    if (!inRow && /\{\{\s*Powers_[^{}|]*Row\b/i.test(line)) {
      inRow = true;
      buffer = line;
      if (line.includes("}}")) {
        rows.push(buffer);
        buffer = "";
        inRow = false;
      }
      continue;
    }
    if (inRow) {
      buffer += `\n${line}`;
      if (line.includes("}}")) {
        rows.push(buffer);
        buffer = "";
        inRow = false;
      }
    }
  }
  return rows;
}

async function wikiApi(params) {
  const query = new URLSearchParams({
    format: "json",
    formatversion: "2",
    ...params
  });
  const res = await fetch(`${API}?${query.toString()}`, {
    headers: {
      "User-Agent": "ParagonLedger/0.1 (local power sync tool)"
    }
  });
  if (!res.ok) {
    throw new Error(`Wiki API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function collectPages() {
  const queue = [...ROOT_CATEGORIES];
  const seenCategories = new Set();
  const pages = new Set();

  while (queue.length) {
    const category = queue.shift();
    if (seenCategories.has(category)) {
      continue;
    }
    seenCategories.add(category);
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
      for (const item of payload.query?.categorymembers || []) {
        if (item.ns === 14 && item.title) {
          queue.push(item.title);
        }
        if (item.ns === 0 && item.title) {
          pages.add(item.title);
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

async function fetchPowerPages(pageTitles) {
  const batches = chunk(pageTitles, BATCH_SIZE);
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
      const rows = extractPowerRows(text);
      for (const row of rows) {
        const powerName = readParam(row, "Power");
        if (!powerName) {
          continue;
        }
        const iconRaw = readParam(row, "Icon");
        const effect = readParam(row, "Effect");
        out.push({
          power_set: page.title,
          power_name: powerName,
          description: effect || "",
          icon_file: iconRaw.replace(/^File:/i, "").replace(/_/g, " ").trim(),
          source_page: page.title
        });
      }
    }
    process.stdout.write(`Fetched power pages: ${i + 1}/${batches.length}\r`);
    await sleep(60);
  }
  process.stdout.write("\n");
  return out;
}

async function fetchImageUrl(iconFileName) {
  if (!iconFileName) {
    return null;
  }
  const payload = await wikiApi({
    action: "query",
    titles: `File:${iconFileName}`,
    prop: "imageinfo",
    iiprop: "url"
  });
  const page = payload.query?.pages?.[0];
  return page?.imageinfo?.[0]?.url || null;
}

async function downloadIcon(url, outFile) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "ParagonLedger/0.1 (local power sync tool)"
    }
  });
  if (!res.ok) {
    throw new Error(`Icon download failed: ${res.status} ${res.statusText}`);
  }
  const arr = await res.arrayBuffer();
  await fs.writeFile(outFile, Buffer.from(arr));
}

async function main() {
  await fs.mkdir(path.dirname(OUT_JSON), { recursive: true });
  await fs.mkdir(OUT_ICONS_DIR, { recursive: true });

  console.log("Collecting power set pages...");
  const pages = await collectPages();
  console.log(`Found ${pages.length} pages.`);

  console.log("Parsing power rows...");
  const parsed = await fetchPowerPages(pages);
  const dedup = new Map();
  for (const row of parsed) {
    const key = `${row.power_set.toLowerCase()}|${row.power_name.toLowerCase()}`;
    if (!dedup.has(key)) {
      dedup.set(key, row);
      continue;
    }
    const prev = dedup.get(key);
    if (!prev.description && row.description) {
      dedup.set(key, row);
    }
  }
  const powers = [...dedup.values()].sort((a, b) =>
    `${a.power_set}|${a.power_name}`.localeCompare(`${b.power_set}|${b.power_name}`)
  );
  console.log(`Parsed ${powers.length} powers.`);

  const iconFiles = [...new Set(powers.map((p) => p.icon_file).filter(Boolean))];
  const iconUrlByFile = new Map();
  for (let i = 0; i < iconFiles.length; i += 1) {
    const file = iconFiles[i];
    const url = await fetchImageUrl(file);
    if (url) {
      iconUrlByFile.set(file, url);
    }
    process.stdout.write(`Resolved power icons: ${i + 1}/${iconFiles.length}\r`);
    await sleep(50);
  }
  process.stdout.write("\n");

  let downloaded = 0;
  const iconPathByFile = new Map();
  for (const [iconFile, url] of iconUrlByFile.entries()) {
    const extMatch = url.match(/\.([a-z0-9]+)(?:$|\?)/i);
    const ext = (extMatch ? extMatch[1] : "png").toLowerCase();
    const base = iconFile.replace(/\.[a-z0-9]+$/i, "").replace(/_/g, " ");
    const localName = `${slugify(base)}.${ext}`;
    const outFile = path.join(OUT_ICONS_DIR, localName);
    try {
      await fs.access(outFile);
    } catch {
      await downloadIcon(url, outFile);
      downloaded += 1;
    }
    iconPathByFile.set(iconFile, path.posix.join("assets/powers", localName));
    process.stdout.write(`Downloaded power icons: ${downloaded}/${iconFiles.length}\r`);
  }
  process.stdout.write("\n");

  const final = {
    meta: {
      source: "homecoming.wiki",
      database: "Homecoming",
      database_version: "",
      generated_at: new Date().toISOString()
    },
    powers: powers.map((row) => ({
      power_set: row.power_set,
      power_name: row.power_name,
      description: row.description || "",
      icon_path: iconPathByFile.get(row.icon_file) || "",
      source_page: row.source_page
    }))
  };

  await fs.writeFile(OUT_JSON, `${JSON.stringify(final, null, 2)}\n`, "utf8");
  console.log(`Wrote ${final.powers.length} powers to ${OUT_JSON}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
