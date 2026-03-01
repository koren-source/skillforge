import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const DATA_DIR = path.join(os.homedir(), ".skillforge");
const INDEX_PATH = path.join(DATA_DIR, "index.json");

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readIndex() {
  await ensureDir();
  try {
    const data = await fs.readFile(INDEX_PATH, "utf8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function writeIndex(entries) {
  await ensureDir();
  await fs.writeFile(INDEX_PATH, JSON.stringify(entries, null, 2), "utf8");
}

async function add(skill) {
  const entries = await readIndex();

  // Replace existing entry with same slug
  const idx = entries.findIndex((e) => e.slug === skill.slug);
  const entry = {
    name: skill.name,
    slug: skill.slug,
    domain: skill.domain || "",
    tags: skill.tags || [],
    frameworks: skill.frameworks || [],
    intent: skill.intent || "",
    filePath: skill.filePath,
    createdAt: skill.createdAt || new Date().toISOString(),
  };

  if (idx >= 0) {
    entries[idx] = entry;
  } else {
    entries.push(entry);
  }

  await writeIndex(entries);
  return entry;
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

async function search(intent) {
  const entries = await readIndex();
  const intentTokens = tokenize(intent);
  if (intentTokens.length === 0) return entries;

  return entries
    .map((entry) => {
      const haystack = [
        entry.intent,
        entry.name,
        entry.domain,
        ...(entry.tags || []),
        ...(entry.frameworks || []),
      ]
        .join(" ")
        .toLowerCase();

      const haystackTokens = tokenize(haystack);
      const haystackSet = new Set(haystackTokens);

      let matches = 0;
      for (const token of intentTokens) {
        if (haystackSet.has(token)) matches++;
        else if (haystackTokens.some((t) => t.includes(token) || token.includes(t))) {
          matches += 0.5;
        }
      }

      return { ...entry, relevance: matches / intentTokens.length };
    })
    .filter((e) => e.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance);
}

async function list() {
  return readIndex();
}

async function remove(slug) {
  const entries = await readIndex();
  const filtered = entries.filter((e) => e.slug !== slug);
  if (filtered.length === entries.length) {
    return false; // nothing removed
  }
  await writeIndex(filtered);
  return true;
}

export { add, search, list, remove };
