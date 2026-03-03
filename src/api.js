import { readFileSync } from "node:fs";
import { extractFromUrls, fetchTranscriptForUrl, listChannelVideoUrls } from "./extract.js";
import { searchTopic } from "./search.js";
import { synthesizeKnowledge, previewTranscript } from "./synthesize.js";
import { formatDocument, makeOutputFilename, slugify, slugifyCreator } from "./format.js";
import * as skillIndex from "./skillIndex.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const LIBRARY_DIR = path.join(os.homedir(), ".skillforge", "library");

function loadExistingSkillMeta(filePath) {
  try {
    const content = readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    if (lines[0] !== "---") return { sourceVideoUrls: [] };

    const urls = [];
    let inFrontmatter = true;
    let inSourceVideos = false;

    for (let i = 1; i < lines.length && inFrontmatter; i++) {
      const line = lines[i];
      if (line === "---") break;

      if (line.startsWith("source_videos:")) {
        inSourceVideos = true;
        continue;
      }

      if (inSourceVideos) {
        const urlMatch = line.match(/^\s+-\s+url:\s+"([^"]+)"/);
        const plainMatch = line.match(/^\s+-\s+"([^"]+)"/);
        if (urlMatch) {
          urls.push(urlMatch[1]);
        } else if (plainMatch) {
          urls.push(plainMatch[1]);
        } else if (!line.match(/^\s+date:/)) {
          inSourceVideos = false;
        }
      }
    }

    return { sourceVideoUrls: urls };
  } catch {
    return { sourceVideoUrls: [] };
  }
}

function resolveLibraryPath(creatorSlug, topicSlug) {
  return path.join(LIBRARY_DIR, creatorSlug, topicSlug, "SKILL.md");
}

function legacyLibraryPath(creatorSlug, topicSlug) {
  return path.join(LIBRARY_DIR, creatorSlug, `${topicSlug}.skill.md`);
}

export async function recall(intent) {
  return skillIndex.search(intent);
}

export async function check(intent) {
  const results = await skillIndex.search(intent);
  return {
    found: results.length > 0,
    results,
  };
}

export async function build({
  channel,
  topic,
  intent,
  auto = false,
  model,
  output = "./output",
  format = "skill",
  limit = 10,
  channels,
  urls,
  creator,
}) {
  let sourceUrls = [];
  let resolvedTopic = topic || "";
  let channelSources = null;
  let detectedCreator = creator || null;

  if (channels && channels.length) {
    // Multi-channel builds stay flat — no creator scoping
    const allUrls = [];
    const channelNames = [];
    for (const channelUrl of channels) {
      const discovered = await listChannelVideoUrls(channelUrl, limit);
      allUrls.push(...discovered.map((d) => d.url));
      if (discovered[0]?.channelTitle) {
        channelNames.push(discovered[0].channelTitle);
      }
    }
    sourceUrls = allUrls;
    resolvedTopic = resolvedTopic || channelNames.join(" + ") || "Multi-Channel";
    channelSources = channels;
  } else if (channel) {
    const discovered = await listChannelVideoUrls(channel, limit);
    sourceUrls = discovered.map((d) => d.url);
    resolvedTopic = resolvedTopic || discovered[0]?.channelTitle || "YouTube Channel";
    if (!detectedCreator && discovered[0]?.channelTitle) {
      detectedCreator = discovered[0].channelTitle;
    }
  } else if (urls && urls.length) {
    sourceUrls = urls;
  } else if (topic) {
    const discovered = await searchTopic(topic, limit);
    sourceUrls = discovered.map((d) => d.url);
  } else {
    throw new Error("Provide at least one of: channel, channels, topic, or urls.");
  }

  sourceUrls = sourceUrls.slice(0, limit);

  const transcripts = await extractFromUrls(sourceUrls, {
    limit: sourceUrls.length,
  });

  if (!transcripts.length) {
    throw new Error("No transcripts were available.");
  }

  // Auto-detect creator from first transcript if not already set
  if (!detectedCreator && !channelSources && transcripts[0]?.channelTitle) {
    detectedCreator = transcripts[0].channelTitle;
  }

  const safeTopic = slugify(resolvedTopic || "skillforge-output");
  let destination;
  let creatorMeta = null;

  if (detectedCreator && !channelSources) {
    const creatorSlug = slugifyCreator(detectedCreator);
    creatorMeta = { creator: detectedCreator, creatorSlug };
    destination = resolveLibraryPath(creatorSlug, safeTopic);

    // Merge: check v2 path first, fall back to v1 legacy path
    let existingMeta = loadExistingSkillMeta(destination);
    if (existingMeta.sourceVideoUrls.length === 0) {
      existingMeta = loadExistingSkillMeta(legacyLibraryPath(creatorSlug, safeTopic));
    }
    const existing = existingMeta;
    if (existing.sourceVideoUrls.length > 0) {
      const newUrls = new Set(transcripts.map((t) => t.url));
      const missingUrls = existing.sourceVideoUrls.filter((u) => !newUrls.has(u));
      if (missingUrls.length > 0) {
        const oldTranscripts = await extractFromUrls(missingUrls, { limit: missingUrls.length });
        transcripts.push(...oldTranscripts);
      }
    }
  } else {
    const filename = makeOutputFilename(format, safeTopic);
    destination = path.resolve(process.cwd(), output, filename);
  }

  const synthesis = await synthesizeKnowledge({
    transcripts,
    topic: resolvedTopic,
    model,
    intent: intent || "",
    outputPath: destination,
    creatorMeta,
  });

  if (channelSources) {
    synthesis.sources = channelSources;
  }

  const content = formatDocument(format, synthesis);

  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, content, "utf8");

  return {
    filePath: destination,
    synthesis,
    transcriptCount: transcripts.length,
    creator: detectedCreator,
    merged: creatorMeta ? loadExistingSkillMeta(destination).sourceVideoUrls.length > 0 : false,
  };
}

export async function watch({
  url,
  skill,
  model,
  output = "./output",
  format = "skill",
  intent,
  confirm,
}) {
  if (!url) throw new Error("A URL is required.");
  if (typeof confirm !== "function") throw new Error("A confirm callback is required.");

  const transcriptData = await fetchTranscriptForUrl(url);
  if (!transcriptData || !transcriptData.transcript) {
    throw new Error("No transcript available for this video.");
  }

  const preview = await previewTranscript({
    transcript: transcriptData.transcript,
    topic: intent || transcriptData.title,
    model,
  });

  const approved = await confirm(preview.bullets);
  if (!approved) return { skipped: true, bullets: preview.bullets };

  const detectedCreator = transcriptData.channelTitle || null;
  const topic = skill || transcriptData.title || "YouTube Video";
  const safeTopic = slugify(topic);

  let destination;
  let creatorMeta = null;
  const transcripts = [transcriptData];

  if (detectedCreator) {
    const creatorSlug = slugifyCreator(detectedCreator);
    creatorMeta = { creator: detectedCreator, creatorSlug };
    destination = resolveLibraryPath(creatorSlug, safeTopic);

    // Merge: check v2 path first, fall back to v1 legacy path
    let existingWatchMeta = loadExistingSkillMeta(destination);
    if (existingWatchMeta.sourceVideoUrls.length === 0) {
      existingWatchMeta = loadExistingSkillMeta(legacyLibraryPath(creatorSlug, safeTopic));
    }
    const existing = existingWatchMeta;
    if (existing.sourceVideoUrls.length > 0) {
      const newUrls = new Set(transcripts.map((t) => t.url));
      const missingUrls = existing.sourceVideoUrls.filter((u) => !newUrls.has(u));
      if (missingUrls.length > 0) {
        const oldTranscripts = await extractFromUrls(missingUrls, { limit: missingUrls.length });
        transcripts.push(...oldTranscripts);
      }
    }
  } else {
    const filename = makeOutputFilename(format, safeTopic);
    destination = path.resolve(process.cwd(), output, filename);
  }

  const synthesis = await synthesizeKnowledge({
    transcripts,
    topic,
    model,
    intent: intent || "",
    outputPath: destination,
    creatorMeta,
  });

  const content = formatDocument(format, synthesis);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, content, "utf8");

  return {
    skipped: false,
    bullets: preview.bullets,
    filePath: destination,
    synthesis,
    creator: detectedCreator,
    merged: creatorMeta ? transcripts.length > 1 : false,
  };
}
