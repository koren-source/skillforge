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

function skillDir(creator, topic) {
  const topicSlug = slugify(topic);
  return path.join(creatorDir(creator), topicSlug);
}

function skillFilePath(creator, topic) {
  return path.join(skillDir(creator, topic), "SKILL.md");
}

function legacySkillPath(creator, topic) {
  const topicSlug = slugify(topic);
  return path.join(creatorDir(creator), `${topicSlug}.skill.md`);
}

function skillPath(creator, topic) {
  return skillDir(creator, topic);
}

async function resolveSkillFile(creator, topic) {
  const v2 = skillFilePath(creator, topic);
  try {
    await fs.access(v2);
    return { filePath: v2, format: "v2" };
  } catch {
    const v1 = legacySkillPath(creator, topic);
    try {
      await fs.access(v1);
      return { filePath: v1, format: "v1" };
    } catch {
      return null;
    }
  }
}

async function writeSkill(creator, topic, content) {
  const dest = skillFilePath(creator, topic);
  await ensureDir(path.dirname(dest));
  await fs.writeFile(dest, content, "utf8");
  return dest;
}

async function readSkill(creator, topic) {
  const resolved = await resolveSkillFile(creator, topic);
  if (!resolved) return null;
  try {
    return await fs.readFile(resolved.filePath, "utf8");
  } catch {
    return null;
  }
}

async function skillExists(creator, topic) {
  const resolved = await resolveSkillFile(creator, topic);
  return resolved !== null;
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
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const skills = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        // v2: directory with SKILL.md inside
        try {
          await fs.access(path.join(dir, entry.name, "SKILL.md"));
          skills.push(entry.name);
        } catch { /* no SKILL.md, skip */ }
      } else if (entry.name.endsWith(".skill.md")) {
        // v1: flat file
        skills.push(entry.name.replace(/\.skill\.md$/, ""));
      }
    }
    return skills;
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
      const resolved = await resolveSkillFile(creator, topic);
      results.push({ creator, topic, path: resolved ? resolved.filePath : skillFilePath(creator, topic) });
    }
  }
  return results;
}

function expandUserPath(inputPath) {
  if (!inputPath) return inputPath;
  if (inputPath === "~") return os.homedir();
  if (inputPath.startsWith(`~${path.sep}`)) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function normalizeCreatorKey(value) {
  const clean = normalizeHandle(value);
  return clean ? `@${clean}` : "@unknown";
}

function describeSkillPath(resolvedPath) {
  const absolutePath = path.resolve(resolvedPath);
  const baseName = path.basename(absolutePath);

  if (baseName === "SKILL.md") {
    const rootPath = path.dirname(absolutePath);
    const topic = path.basename(rootPath);
    const creator = normalizeCreatorKey(path.basename(path.dirname(rootPath)));
    return {
      creator, topic, path: rootPath, rootPath,
      skillFilePath: absolutePath, storage: "directory",
      sharePath: path.join(creator, topic),
    };
  }

  if (baseName.endsWith(".skill.md")) {
    const topic = baseName.replace(/\.skill\.md$/, "");
    const creator = normalizeCreatorKey(path.basename(path.dirname(absolutePath)));
    return {
      creator, topic, path: absolutePath, rootPath: absolutePath,
      skillFilePath: absolutePath, storage: "file",
      sharePath: path.join(creator, topic),
    };
  }

  return {
    creator: normalizeCreatorKey(path.basename(path.dirname(absolutePath))),
    topic: path.basename(absolutePath),
    path: absolutePath, rootPath: absolutePath,
    skillFilePath: path.join(absolutePath, "SKILL.md"),
    storage: "directory",
    sharePath: path.join(
      normalizeCreatorKey(path.basename(path.dirname(absolutePath))),
      path.basename(absolutePath)
    ),
  };
}

function matchesSkillReference(skill, reference) {
  const rawReference = String(reference || "").trim();
  if (!rawReference) return false;

  const lowerReference = rawReference.toLowerCase();
  const creator = skill.creator.toLowerCase();
  const creatorWithoutAt = creator.replace(/^@/, "");
  const topic = skill.topic.toLowerCase();
  const topicSlug = slugify(skill.topic);
  const composite = `${creator}/${topic}`;
  const compositeWithoutAt = `${creatorWithoutAt}/${topic}`;
  const slugComposite = `${creator}/${topicSlug}`;
  const slugCompositeWithoutAt = `${creatorWithoutAt}/${topicSlug}`;
  const normalizedReference = slugify(rawReference);

  return (
    lowerReference === topic ||
    lowerReference === topicSlug ||
    lowerReference === composite ||
    lowerReference === compositeWithoutAt ||
    lowerReference === slugComposite ||
    lowerReference === slugCompositeWithoutAt ||
    normalizedReference === topicSlug
  );
}

async function resolveSkillReference(reference) {
  const trimmed = String(reference || "").trim();
  if (!trimmed) throw new Error("A skill reference is required.");

  const pathLike =
    trimmed.startsWith(".") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("~") ||
    trimmed.includes(path.sep);

  if (pathLike) {
    const candidatePath = path.resolve(expandUserPath(trimmed));
    try {
      const stats = await fs.stat(candidatePath);
      if (stats.isDirectory()) {
        await fs.access(path.join(candidatePath, "SKILL.md"));
      }
      return describeSkillPath(candidatePath);
    } catch { /* fall through */ }
  }

  const creators = await listCreators();
  const matches = [];
  for (const creator of creators) {
    const skills = await listSkills(creator);
    for (const topic of skills) {
      const resolved = await resolveSkillFile(creator, topic);
      const skill = {
        creator: normalizeCreatorKey(creator),
        topic,
        path: resolved ? path.dirname(resolved.filePath) : skillDir(creator, topic),
        rootPath: resolved ? path.dirname(resolved.filePath) : skillDir(creator, topic),
        skillFilePath: resolved ? resolved.filePath : skillFilePath(creator, topic),
        storage: resolved?.format === "v1" ? "file" : "directory",
        sharePath: path.join(normalizeCreatorKey(creator), topic),
      };
      if (matchesSkillReference(skill, trimmed)) {
        matches.push(skill);
      }
    }
  }

  if (matches.length === 0) throw new Error(`Skill not found: ${trimmed}`);
  if (matches.length > 1) {
    const options = matches.map((s) => `${s.creator}/${s.topic}`).join(", ");
    throw new Error(`Skill reference is ambiguous: ${trimmed}. Matches: ${options}`);
  }

  return matches[0];
}

async function readDirectoryFiles(rootPath, currentPath = rootPath) {
  const entries = (await fs.readdir(currentPath, { withFileTypes: true }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await readDirectoryFiles(rootPath, entryPath));
    } else {
      files.push({
        relativePath: path.relative(rootPath, entryPath),
        absolutePath: entryPath,
        content: await fs.readFile(entryPath, "utf8"),
      });
    }
  }

  return files;
}

async function readSkillContents(reference) {
  const skill = typeof reference === "string"
    ? await resolveSkillReference(reference)
    : reference;

  if (skill.storage === "directory") {
    const files = await readDirectoryFiles(skill.rootPath);
    return { ...skill, files };
  }

  return {
    ...skill,
    files: [{
      relativePath: "SKILL.md",
      absolutePath: skill.skillFilePath,
      content: await fs.readFile(skill.skillFilePath, "utf8"),
    }],
  };
}

async function removeSkill(creator, topic) {
  // Try v2 folder first
  const dir = skillDir(creator, topic);
  try {
    await fs.rm(dir, { recursive: true });
    return true;
  } catch {
    // Fall back to v1 flat file
    const legacy = legacySkillPath(creator, topic);
    try {
      await fs.unlink(legacy);
      return true;
    } catch {
      return false;
    }
  }
}

export {
  LIBRARY_DIR,
  writeSkill,
  readSkill,
  readSkillContents,
  skillExists,
  skillPath,
  skillDir,
  skillFilePath,
  legacySkillPath,
  resolveSkillFile,
  resolveSkillReference,
  listCreators,
  listSkills,
  listAll,
  removeSkill,
};
