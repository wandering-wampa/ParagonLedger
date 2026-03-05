import fs from "fs/promises";
import path from "path";

const API = "https://homecoming.wiki/w/api.php";
const ROOT_CATEGORIES = [
  "Category:Badges",
  "Category:Hero Accolade Badges",
  "Category:Villain Accolade Badges",
  "Category:Praetorian Accolade Badges",
  "Category:Incarnate Badges",
  "Category:Veteran Level Badges"
];
const BATCH_SIZE = 25;
const OUT_JSON = path.resolve("data", "badges.json");
const OUT_ICONS_DIR = path.resolve("assets", "badges");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .trim();
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function cleanWikiText(text) {
  return String(text || "")
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\{\{[^{}]+\}\}/g, "")
    .replace(/''+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractTemplateBlock(wikitext, templateName) {
  const startRe = new RegExp(`\\{\\{\\s*${templateName}\\b`, "i");
  const startMatch = wikitext.match(startRe);
  if (!startMatch || startMatch.index === undefined) {
    return null;
  }
  const start = startMatch.index;
  let i = start;
  let depth = 0;
  while (i < wikitext.length - 1) {
    const two = wikitext.slice(i, i + 2);
    if (two === "{{") {
      depth += 1;
      i += 2;
      continue;
    }
    if (two === "}}") {
      depth -= 1;
      i += 2;
      if (depth === 0) {
        return wikitext.slice(start, i);
      }
      continue;
    }
    i += 1;
  }
  return null;
}

function extractSection(wikitext, sectionName) {
  const re = new RegExp(
    `==+\\s*${escapeRegExp(sectionName)}\\s*==+\\s*([\\s\\S]*?)(?=\\n==+\\s*[^=]|$)`,
    "i"
  );
  const match = String(wikitext || "").match(re);
  if (!match) {
    return "";
  }
  return cleanWikiText(match[1] || "");
}

function extractParam(templateBlock, key) {
  if (!templateBlock) {
    return "";
  }
  const re = new RegExp(
    `\\|\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*([\\s\\S]*?)(?=\\n\\s*\\||\\n\\s*\\}\\})`,
    "i"
  );
  const match = templateBlock.match(re);
  if (!match) {
    return "";
  }
  return cleanWikiText(match[1]);
}

function extractImageName(wikitext) {
  const imageTemplate = String(wikitext || "").match(
    /\{\{\s*Image\s*\|\s*([^|}\n]+)(?:\|[^}]*)?\}\}/i
  );
  if (imageTemplate && imageTemplate[1]) {
    return imageTemplate[1].replace(/^File:/i, "").replace(/_/g, " ").trim();
  }
  const fileLink = String(wikitext || "").match(/\[\[\s*File\s*:\s*([^|\]]+)/i);
  if (fileLink && fileLink[1]) {
    return fileLink[1].replace(/^File:/i, "").replace(/_/g, " ").trim();
  }
  return "";
}

function parseBadgePage(page) {
  const revision = page.revisions?.[0];
  const wikitext = revision?.slots?.main?.content || "";
  if (!wikitext) {
    return null;
  }
  const hasBadgeDisplay = /\{\{\s*badge display\b/i.test(wikitext);
  const categories = (page.categories || []).map((c) =>
    String(c.title || "").replace(/^Category:/i, "").trim()
  );
  if (
    categories.some((c) =>
      /(Badges Not In Game|Removed Badges|Bugged Badges)/i.test(c)
    )
  ) {
    return null;
  }

  const displayBlock = extractTemplateBlock(wikitext, "badge display");
  const dataBlock = extractTemplateBlock(wikitext, "badge data");
  const powerBox = extractTemplateBlock(wikitext, "PowerBox");
  const titleFromTemplate = hasBadgeDisplay ? extractParam(displayBlock, "title") : "";
  const iconRaw =
    (hasBadgeDisplay ? extractParam(displayBlock, "icon") : "") || extractImageName(wikitext);
  const description =
    (hasBadgeDisplay ? extractParam(displayBlock, "description") : "") ||
    extractSection(wikitext, "Description") ||
    extractSection(wikitext, "In-Game Description") ||
    extractParam(powerBox, "Desc");
  const categoryFromData = extractParam(dataBlock, "category");

  const pageTitle = String(page.title || "");
  const badgeName =
    titleFromTemplate ||
    pageTitle
      .replace(/\s+Badge$/i, "")
      .replace(/\s*\(Badge\)\s*$/i, "")
      .replace(/^(?:Received|Earned)\s+(?:the\s+)?/i, "")
      .trim();

  if (!badgeName) {
    return null;
  }

  if (!hasBadgeDisplay) {
    const looksLikeBadgePage =
      /\bBadges?\b/i.test(pageTitle) ||
      pageTitle.endsWith(" Badge") ||
      categories.some((c) => /Badges?/i.test(c));
    if (!looksLikeBadgePage) {
      return null;
    }
  }

  const categoryFromCats =
    categories
      .map((c) => {
        const m = c.match(/^(.+?) Badges$/i);
        return m ? m[1] : null;
      })
      .find(Boolean) || "Unknown";

  const category = categoryFromData || categoryFromCats || "Unknown";
  const iconFile = iconRaw
    .replace(/^File:/i, "")
    .replace(/_/g, " ")
    .trim();

  return {
    badge_name: badgeName,
    category,
    description,
    iconFile,
    source_page: pageTitle
  };
}

async function wikiApi(params) {
  const query = new URLSearchParams({
    format: "json",
    formatversion: "2",
    ...params
  });
  const url = `${API}?${query.toString()}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "ParagonLedger/0.1 (local badge sync tool)"
    }
  });
  if (!res.ok) {
    throw new Error(`API request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function collectCategoryPages(rootCategories) {
  const queue = [...rootCategories];
  const seenCategories = new Set();
  const pageTitles = new Set();

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
        cmlimit: "max",
        cmtype: "page|subcat",
        ...(cmcontinue ? { cmcontinue } : {})
      });
      for (const member of payload.query?.categorymembers || []) {
        if (member.ns === 14) {
          queue.push(member.title);
          continue;
        }
        if (member.ns === 0) {
          pageTitles.add(member.title);
        }
      }
      cmcontinue = payload.continue?.cmcontinue || null;
      if (cmcontinue) {
        await sleep(80);
      }
    } while (cmcontinue);
  }

  return [...pageTitles];
}

async function fetchBadgePages(pageTitles) {
  const out = [];
  const batches = chunk(pageTitles, BATCH_SIZE);
  for (let i = 0; i < batches.length; i += 1) {
    const titles = batches[i].join("|");
    const payload = await wikiApi({
      action: "query",
      redirects: "1",
      prop: "revisions|categories",
      rvprop: "content",
      rvslots: "main",
      cllimit: "max",
      titles
    });
    for (const page of payload.query?.pages || []) {
      if (page.missing) {
        continue;
      }
      const parsed = parseBadgePage(page);
      if (parsed) {
        out.push(parsed);
      }
    }
    process.stdout.write(`Fetched badge pages: ${i + 1}/${batches.length}\r`);
    await sleep(80);
  }
  process.stdout.write("\n");
  return out;
}

async function fetchImageUrl(iconFileName) {
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
      "User-Agent": "ParagonLedger/0.1 (local badge sync tool)"
    }
  });
  if (!res.ok) {
    throw new Error(`Icon download failed: ${res.status} ${res.statusText}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  await fs.writeFile(outFile, Buffer.from(arrayBuffer));
}

async function main() {
  await fs.mkdir(path.dirname(OUT_JSON), { recursive: true });
  await fs.mkdir(OUT_ICONS_DIR, { recursive: true });

  console.log("Collecting badge pages from category tree...");
  const pageTitles = await collectCategoryPages(ROOT_CATEGORIES);
  console.log(`Found ${pageTitles.length} candidate pages.`);

  console.log("Fetching and parsing badge pages...");
  const parsedBadges = await fetchBadgePages(pageTitles);
  const byName = new Map();
  for (const badge of parsedBadges) {
    if (!badge.badge_name) {
      continue;
    }
    if (!byName.has(badge.badge_name)) {
      byName.set(badge.badge_name, badge);
      continue;
    }
    const existing = byName.get(badge.badge_name);
    if (!existing.description && badge.description) {
      byName.set(badge.badge_name, badge);
    }
  }

  const badges = [...byName.values()].sort((a, b) =>
    a.badge_name.localeCompare(b.badge_name)
  );
  console.log(`Parsed ${badges.length} badge pages.`);

  const iconByFile = new Map();
  for (const badge of badges) {
    if (badge.iconFile) {
      iconByFile.set(badge.iconFile, null);
    }
  }
  const iconFiles = [...iconByFile.keys()];
  console.log(`Resolving ${iconFiles.length} icon files...`);
  for (let i = 0; i < iconFiles.length; i += 1) {
    const icon = iconFiles[i];
    const url = await fetchImageUrl(icon);
    if (url) {
      iconByFile.set(icon, url);
    }
    process.stdout.write(`Resolved icons: ${i + 1}/${iconFiles.length}\r`);
    await sleep(80);
  }
  process.stdout.write("\n");

  const localIconByFile = new Map();
  let downloaded = 0;
  for (const [iconFile, url] of iconByFile.entries()) {
    if (!url) {
      continue;
    }
    const extMatch = url.match(/\.([a-z0-9]+)(?:$|\?)/i);
    const ext = (extMatch ? extMatch[1] : "png").toLowerCase();
    const base = iconFile
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/_/g, " ")
      .trim();
    const localName = `${slugify(base)}.${ext}`;
    const outFile = path.join(OUT_ICONS_DIR, localName);
    try {
      await fs.access(outFile);
    } catch {
      await downloadIcon(url, outFile);
      downloaded += 1;
    }
    localIconByFile.set(iconFile, path.posix.join("assets/badges", localName));
    process.stdout.write(`Downloaded icons: ${downloaded}/${iconFiles.length}\r`);
  }
  process.stdout.write("\n");

  const finalBadges = badges.map((badge) => ({
    badge_name: badge.badge_name,
    category: badge.category || "Unknown",
    description: badge.description || "",
    icon_path: localIconByFile.get(badge.iconFile) || ""
  }));

  await fs.writeFile(OUT_JSON, `${JSON.stringify(finalBadges, null, 2)}\n`, "utf8");

  console.log(`Wrote ${finalBadges.length} badges to ${OUT_JSON}`);
  console.log(`Icons available in ${OUT_ICONS_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
