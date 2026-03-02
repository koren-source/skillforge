import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { normalizeHandle } from "./creator.js";
import { slugify } from "./format.js";

const LIBRARY_DIR = path.join(os.homedir(), ".skillforge", "library");

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function creatorDir(creator) {
  const safe = normalizeHandle(creator) || "unknown";
  return path.join(LIBRARY_DIR, safe);
}

function skillPath(creator, topic) {
  const topicSlug = slugify(topic);
  return path.join(creatorDir(creator), `${topicSlug}.skill.md`);
}

async function writeSkill(creator, topic, content) {
  const dest = skillPath(creator, topic);
  await ensureDir(path.dirname(dest));
  await fs.writeFile(dest, content, "utf8");
  return dest;
}

async function readSkill(creator, topic) {
  const src = skillPath(creator, topic);
  try {
    return await fs.readFile(src, "utf8");
  } catch {
    return null;
  }
}

async function skillExists(creator, topic) {
  const src = skillPath(creator, topic);
  try {
    await fs.access(src);
    return true;
  } catch {
    return false;
  }
}

async function listCreators() {
  await ensureDir(LIBRARY_DIR);
  try {
    const entries = await fs.readdir(LIBRARY_DIR, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function listSkills(creator) {
  const dir = creatorDir(creator);
  try {
    const files = await fs.readdir(dir);
    return files
      .filter((f) => f.endsWith(".skill.md"))
      .map((f) => f.replace(/\.skill\.md$/, ""));
  } catch {
    return [];
  }
}

async function listAll() {
  const creators = await listCreators();
  const results = [];
  for (const creator of creators) {
    const skills = await listSkills(creator);
    for (const topic of skills) {
      results.push({ creator, topic, path: skillPath(creator, topic) });
    }
  }
  return results;
}

async function removeSkill(creator, topic) {
  const src = skillPath(creator, topic);
  try {
    await fs.unlink(src);
    return true;
  } catch {
    return false;
  }
}

export {
  LIBRARY_DIR,
  writeSkill,
  readSkill,
  skillExists,
  skillPath,
  listCreators,
  listSkills,
  listAll,
  removeSkill,
};
