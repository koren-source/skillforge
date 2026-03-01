import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

const PROPOSALS_DIR = path.join(os.homedir(), ".skillforge", "proposals");

async function ensureDir() {
  await fs.mkdir(PROPOSALS_DIR, { recursive: true });
}

function suggestSkills(scoredVideos, intent) {
  // Group top videos into a single skill suggestion for now.
  // Future: cluster by sub-topic.
  const topVideos = scoredVideos.filter((v) => v.score > 0);
  if (topVideos.length === 0) return [];

  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const slug = intent
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  return [
    {
      letter: letters[0],
      name: slug,
      description: `Skill synthesized from ${topVideos.length} videos matching: "${intent}"`,
      videoIds: topVideos.map((v) => v.id || v.url),
    },
  ];
}

async function create(url, intent, scoredVideos) {
  await ensureDir();

  const id = randomUUID().slice(0, 8);
  const proposal = {
    id,
    url,
    intent,
    timestamp: new Date().toISOString(),
    videos: scoredVideos.map((v) => ({
      id: v.id || null,
      url: v.url,
      title: v.title,
      score: v.score,
      duration: v.duration || null,
    })),
    suggestedSkills: suggestSkills(scoredVideos, intent),
  };

  const filePath = path.join(PROPOSALS_DIR, `${id}.json`);
  await fs.writeFile(filePath, JSON.stringify(proposal, null, 2), "utf8");

  return proposal;
}

async function load(id) {
  const filePath = path.join(PROPOSALS_DIR, `${id}.json`);
  const data = await fs.readFile(filePath, "utf8");
  return JSON.parse(data);
}

async function list() {
  await ensureDir();
  const files = await fs.readdir(PROPOSALS_DIR);
  const proposals = [];

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const data = await fs.readFile(path.join(PROPOSALS_DIR, file), "utf8");
      proposals.push(JSON.parse(data));
    } catch {
      // skip corrupt files
    }
  }

  return proposals.sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
  );
}

export { create, load, list };
