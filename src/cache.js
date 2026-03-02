import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const CACHE_DIR = path.join(os.homedir(), ".skillforge", "cache");

async function ensureCacheDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

function cachePath(videoId) {
  const safeId = videoId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(CACHE_DIR, `${safeId}.json`);
}

function ttlMs() {
  const days = Number(process.env.SKILLFORGE_CACHE_TTL_DAYS) || 7;
  return days * 86400000;
}

async function has(videoId) {
  try {
    const raw = await fs.readFile(cachePath(videoId), "utf8");
    const entry = JSON.parse(raw);
    if (!entry.cachedAt || Date.now() - entry.cachedAt > ttlMs()) return false;
    return true;
  } catch {
    return false;
  }
}

async function get(videoId) {
  try {
    const raw = await fs.readFile(cachePath(videoId), "utf8");
    const entry = JSON.parse(raw);
    if (!entry.cachedAt || Date.now() - entry.cachedAt > ttlMs()) return null;
    return entry.transcript;
  } catch {
    // File missing, corrupt, or legacy plain-text entry — treat as cache miss
    return null;
  }
}

async function set(videoId, transcript) {
  await ensureCacheDir();
  const entry = { transcript, cachedAt: Date.now() };
  await fs.writeFile(cachePath(videoId), JSON.stringify(entry), "utf8");
}

export { get, set, has };
