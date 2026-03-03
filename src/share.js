import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { readSkillContents } from "./library.js";

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  if (result.status !== 0) {
    return "";
  }

  return String(result.stdout || "").trim();
}

function extractGitHubUsernameFromEmail(email) {
  const match = String(email || "").trim().match(/^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i);
  return match ? match[1] : "";
}

function resolveGitHubUsername() {
  const gitUserName = runCommand("git", ["config", "--get", "user.name"]);
  if (gitUserName) {
    return gitUserName;
  }

  const gitUserEmail = runCommand("git", ["config", "--get", "user.email"]);
  const emailUsername = extractGitHubUsernameFromEmail(gitUserEmail);
  if (emailUsername) {
    return emailUsername;
  }

  const ghLogin = runCommand("gh", ["api", "user", "--jq", ".login"]);
  if (ghLogin) {
    return ghLogin;
  }

  return "anonymous";
}

function upsertFrontmatter(content, metadata) {
  const lines = String(content || "").split("\n");
  const metadataEntries = Object.entries(metadata).map(
    ([key, value]) => `${key}: ${JSON.stringify(String(value))}`
  );

  if (lines[0] === "---") {
    const closingIndex = lines.indexOf("---", 1);
    if (closingIndex !== -1) {
      const existing = lines
        .slice(1, closingIndex)
        .filter((line) => !/^(shared_by|sourced_from|shared_at):/.test(line));

      return [
        "---",
        ...existing,
        ...metadataEntries,
        "---",
        ...lines.slice(closingIndex + 1),
      ].join("\n");
    }
  }

  return [
    "---",
    ...metadataEntries,
    "---",
    String(content || ""),
  ].join("\n");
}

function normalizeSharedFile(file) {
  if (file.relativePath === "SKILL.md" || file.relativePath.endsWith(`${path.sep}SKILL.md`)) {
    return { ...file, relativePath: file.relativePath.replace(/\.skill\.md$/i, "SKILL.md") };
  }

  if (file.relativePath.endsWith(".skill.md")) {
    return { ...file, relativePath: "SKILL.md" };
  }

  return file;
}

function buildStdoutBundle(rootPath, files) {
  const sections = [`# Skill share bundle: ${rootPath}`];

  for (const file of files) {
    sections.push(`\n--- FILE: ${path.posix.join(rootPath, file.relativePath.split(path.sep).join(path.posix.sep))} ---`);
    sections.push(file.content);
  }

  return sections.join("\n");
}

async function ensureDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function copySharedFiles(destinationRoot, files) {
  for (const file of files) {
    const filePath = path.join(destinationRoot, file.relativePath);
    await ensureDirectory(path.dirname(filePath));
    await fs.writeFile(filePath, file.content, "utf8");
  }
}

async function shareSkill({ skillRef, outputDir = process.cwd(), stdout = false }) {
  const sharedAt = new Date().toISOString();
  const sharedBy = resolveGitHubUsername();
  const skill = await readSkillContents(skillRef);
  const sourcedFrom = skill.creator;

  const files = skill.files.map((file) => {
    const normalizedFile = normalizeSharedFile(file);
    if (normalizedFile.relativePath === "SKILL.md") {
      return {
        ...normalizedFile,
        content: upsertFrontmatter(normalizedFile.content, {
          shared_by: sharedBy,
          sourced_from: sourcedFrom,
          shared_at: sharedAt,
        }),
      };
    }
    return normalizedFile;
  });

  const relativeRoot = skill.sharePath.split(path.sep).join(path.posix.sep);

  if (stdout) {
    return {
      ...skill,
      sharedAt,
      sharedBy,
      sourcedFrom,
      files,
      stdout: buildStdoutBundle(relativeRoot, files),
    };
  }

  const destinationRoot = path.resolve(outputDir, skill.sharePath);
  await copySharedFiles(destinationRoot, files);

  return {
    ...skill,
    sharedAt,
    sharedBy,
    sourcedFrom,
    files,
    outputPath: destinationRoot,
  };
}

export {
  resolveGitHubUsername,
  shareSkill,
};
