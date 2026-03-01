import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const CACHE_DIR = path.join(os.homedir(), ".skillforge", "cache");

async function ensureCacheDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

function cachePath(videoId) {
  const safeId = videoId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(CACHE_DIR, `${safeId}.txt`);
}

async function has(videoId) {
  try {
    await fs.access(cachePath(videoId));
    return true;
  } catch {
    return false;
  }
}

async function get(videoId) {
  return fs.readFile(cachePath(videoId), "utf8");
}

async function set(videoId, transcript) {
  await ensureCacheDir();
  await fs.writeFile(cachePath(videoId), transcript, "utf8");
}

export { get, set, has };
