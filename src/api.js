import { extractFromUrls, listChannelVideoUrls } from "./extract.js";
import { searchTopic } from "./search.js";
import { synthesizeKnowledge } from "./synthesize.js";
import { formatDocument, makeOutputFilename, slugify } from "./format.js";
import * as skillIndex from "./skillIndex.js";
import fs from "node:fs/promises";
import path from "node:path";

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
  model = "claude-sonnet-4-20250514",
  output = "./output",
  format = "skill",
  limit = 10,
  channels,
  urls,
}) {
  let sourceUrls = [];
  let resolvedTopic = topic || "";
  let channelSources = null;

  if (channels && channels.length) {
    // Multi-channel build
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

  const safeTopic = slugify(resolvedTopic || "skillforge-output");
  const filename = makeOutputFilename(format, safeTopic);
  const destination = path.resolve(process.cwd(), output, filename);

  const synthesis = await synthesizeKnowledge({
    transcripts,
    topic: resolvedTopic,
    model,
    intent: intent || "",
    outputPath: destination,
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
  };
}
