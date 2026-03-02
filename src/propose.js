import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

const PROPOSALS_DIR = path.join(os.homedir(), ".skillforge", "proposals");

async function ensureDir() {
  await fs.mkdir(PROPOSALS_DIR, { recursive: true });
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function clusterVideos(videos) {
  // Build token frequency map across all videos
  const videoTokens = videos.map((v) => ({
    video: v,
    tokens: new Set([...tokenize(v.title), ...tokenize(v.description)]),
  }));

  // Find distinguishing topic tokens (appear in some but not all videos)
  const tokenCounts = new Map();
  for (const { tokens } of videoTokens) {
    for (const t of tokens) {
      tokenCounts.set(t, (tokenCounts.get(t) || 0) + 1);
    }
  }

  // Keep tokens that appear in 2+ videos but not in all — these are sub-topic signals
  const totalVideos = videos.length;
  const topicTokens = [...tokenCounts.entries()]
    .filter(([, count]) => count >= 2 && count < totalVideos)
    .sort((a, b) => b[1] - a[1])
    .map(([token]) => token);

  if (topicTokens.length === 0) return [videos];

  // Greedily assign videos to clusters by their strongest topic token
  const clusters = new Map();
  const assigned = new Set();

  for (const seed of topicTokens.slice(0, 4)) {
    const members = videoTokens.filter(
      ({ video, tokens }) => !assigned.has(video) && tokens.has(seed)
    );
    if (members.length < 1) continue;
    clusters.set(seed, members.map(({ video }) => video));
    for (const { video } of members) assigned.add(video);
    if (clusters.size >= 4) break;
  }

  // Put unassigned videos into the largest cluster
  const unassigned = videos.filter((v) => !assigned.has(v));
  if (unassigned.length > 0 && clusters.size > 0) {
    const largest = [...clusters.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    largest[1].push(...unassigned);
  } else if (clusters.size === 0) {
    return [videos];
  }

  return [...clusters.entries()].map(([keyword, vids]) => ({ keyword, videos: vids }));
}

function suggestSkills(scoredVideos, intent) {
  const topVideos = scoredVideos.filter((v) => v.score > 0);
  if (topVideos.length === 0) return [];

  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const baseSlug = intent
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  // Fall back to 1 skill if <3 videos
  if (topVideos.length < 3) {
    return [
      {
        letter: letters[0],
        name: baseSlug,
        description: `Skill synthesized from ${topVideos.length} videos matching: "${intent}"`,
        videoIds: topVideos.map((v) => v.id || v.url),
      },
    ];
  }

  const clusters = clusterVideos(topVideos);

  // If clustering returned a single group (all too similar), return 1 skill
  if (!clusters[0]?.keyword) {
    return [
      {
        letter: letters[0],
        name: baseSlug,
        description: `Skill synthesized from ${topVideos.length} videos matching: "${intent}"`,
        videoIds: topVideos.map((v) => v.id || v.url),
      },
    ];
  }

  return clusters.map((cluster, i) => {
    const slug = `${baseSlug}-${cluster.keyword}`.slice(0, 50);
    return {
      letter: letters[i],
      name: slug,
      description: `Skill on "${cluster.keyword}" from ${cluster.videos.length} videos matching: "${intent}"`,
      videoIds: cluster.videos.map((v) => v.id || v.url),
    };
  });
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
