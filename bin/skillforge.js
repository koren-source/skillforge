#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";

import os from "node:os";
import readline from "node:readline";
import {
  extractFromUrls,
  fetchTranscriptForUrl,
  inspectUrl,
  listChannelVideoUrls,
  runYtDlp,
} from "../src/extract.js";
import { searchTopic } from "../src/search.js";
import { synthesizeKnowledge, previewTranscript } from "../src/synthesize.js";
import {
  formatDocument,
  makeOutputFilename,
  slugify,
  slugifyCreator,
} from "../src/format.js";
import { scoreVideos } from "../src/score.js";
import * as propose from "../src/propose.js";
import * as skillIndex from "../src/skillIndex.js";

const program = new Command();

function collectUrls(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function dedupTokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function titleTokenOverlap(a, b) {
  const tokensA = dedupTokenize(a);
  const tokensB = new Set(dedupTokenize(b));
  if (tokensA.length === 0 || tokensB.size === 0) return 0;
  let matches = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) matches++;
  }
  return matches / Math.max(tokensA.length, tokensB.size);
}

function deduplicateTranscripts(transcripts) {
  const kept = [];
  for (const t of transcripts) {
    const isDup = kept.some((k) => titleTokenOverlap(k.title, t.title) > 0.7);
    if (!isDup) kept.push(t);
  }
  return kept;
}

function resolveSource(inputUrl, options) {
  const sources = [
    inputUrl ? { type: "url", value: inputUrl } : null,
    options.channel ? { type: "channel", value: options.channel } : null,
    options.topic ? { type: "topic", value: options.topic } : null,
    options.urls && options.urls.length
      ? { type: "urls", value: options.urls }
      : null,
    options.channels && options.channels.length
      ? { type: "channels", value: options.channels }
      : null,
  ].filter(Boolean);

  if (sources.length === 0) {
    throw new Error(
      "Provide exactly one source: <url>, --channel, --channels, --topic, or --urls."
    );
  }

  if (sources.length > 1) {
    throw new Error(
      "Only one source mode can be used at a time: <url>, --channel, --channels, --topic, or --urls."
    );
  }

  return sources[0];
}

async function ensureDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function resolveDestination(outputPath, format, topic) {
  const safeTopic = slugify(topic || "skillforge-output");
  const filename = makeOutputFilename(format, safeTopic);

  if (!outputPath) {
    return path.resolve(process.cwd(), "output", filename);
  }

  const absolute = path.resolve(process.cwd(), outputPath);
  const ext = path.extname(absolute);
  if (ext) {
    return absolute;
  }

  return path.join(absolute, filename);
}

async function writeOutput(filePath, content) {
  await ensureDirectory(path.dirname(filePath));
  await fs.writeFile(filePath, content, "utf8");
}

async function gatherSourceItems(source, limit) {
  if (source.type === "url") {
    const metadata = await inspectUrl(source.value);
    if (Array.isArray(metadata.entries) && metadata.entries.length) {
      const discovered = metadata.entries
        .slice(0, limit)
        .map((entry) => ({
          url:
            entry.url && entry.url.startsWith("http")
              ? entry.url
              : `https://www.youtube.com/watch?v=${entry.id}`,
          title: entry.title || entry.id,
          id: entry.id,
          description: entry.description || "",
          duration: entry.duration || 0,
        }));

      return {
        discovered,
        urls: discovered.map((item) => item.url),
        topic: metadata.title || "YouTube Playlist",
      };
    }

    return {
      discovered: [{
        url: source.value,
        title: metadata.title || source.value,
        id: metadata.id || null,
        description: metadata.description || "",
        duration: metadata.duration || 0,
      }],
      urls: [source.value],
      topic: metadata.title || "YouTube Video",
    };
  }

  if (source.type === "urls") {
    return {
      discovered: source.value.map((url) => ({ url, title: url, id: null, description: "", duration: 0 })),
      urls: source.value,
      topic: "YouTube Playlist",
    };
  }

  if (source.type === "channel") {
    const discovered = await listChannelVideoUrls(source.value, limit);
    return {
      discovered: discovered.map((d) => ({
        ...d,
        description: d.description || "",
        duration: d.duration || 0,
      })),
      urls: discovered.map((item) => item.url),
      topic: discovered[0] ? discovered[0].channelTitle || "YouTube Channel" : "YouTube Channel",
    };
  }

  if (source.type === "channels") {
    // Multi-channel: gather from each channel URL
    const allDiscovered = [];
    const allUrls = [];
    const channelNames = [];

    for (const channelUrl of source.value) {
      const discovered = await listChannelVideoUrls(channelUrl, limit);
      const items = discovered.map((d) => ({
        ...d,
        description: d.description || "",
        duration: d.duration || 0,
      }));
      allDiscovered.push(...items);
      allUrls.push(...items.map((item) => item.url));
      if (discovered[0]?.channelTitle) {
        channelNames.push(discovered[0].channelTitle);
      }
    }

    return {
      discovered: allDiscovered,
      urls: allUrls,
      topic: channelNames.join(" + ") || "Multi-Channel",
      sources: source.value,
    };
  }

  if (source.type === "topic") {
    const discovered = await searchTopic(source.value, limit);
    return {
      discovered: discovered.map((d) => ({
        ...d,
        description: d.description || "",
        duration: d.duration || 0,
      })),
      urls: discovered.map((item) => item.url),
      topic: source.value,
    };
  }

  throw new Error(`Unsupported source type: ${source.type}`);
}

function withErrorHandler(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (error) {
      process.stderr.write(`${chalk.red("Error:")} ${error.message}\n`);
      process.exitCode = 1;
    }
  };
}

program
  .name("skillforge")
  .description("Turn YouTube videos, channels, and topics into agent-ready skills")
  .version("0.5.0");

// ── check ────────────────────────────────────────────────────────────
program
  .command("check")
  .description("Check if a skill exists for a given intent")
  .requiredOption("--intent <intent>", "Intent to search for")
  .action(
    withErrorHandler(async (options) => {
      const results = await skillIndex.search(options.intent);

      if (results.length === 0) {
        process.stdout.write(
          chalk.yellow(`No skill found for intent: "${options.intent}"\n`)
        );
        process.stdout.write(
          chalk.dim(`Run: skillforge scan <channel> --intent "${options.intent}"\n`)
        );
        process.exitCode = 1;
        return;
      }

      process.stdout.write(
        chalk.bold(`Found ${results.length} matching skill(s):\n\n`)
      );
      for (const skill of results) {
        const rel = Math.round((skill.relevance || 0) * 100);
        process.stdout.write(
          `  ${chalk.green(String(rel).padStart(3) + "%")}  ${chalk.bold(skill.name)} ${chalk.dim("(" + skill.slug + ")")}\n`
        );
        if (skill.intent) {
          process.stdout.write(`        ${chalk.dim("Intent:")} ${skill.intent}\n`);
        }
        if (skill.filePath) {
          process.stdout.write(`        ${chalk.dim("File:")} ${skill.filePath}\n`);
        }
        process.stdout.write("\n");
      }
    })
  );

// ── suggest ──────────────────────────────────────────────────────────
program
  .command("suggest")
  .description("Search YouTube for channels related to a topic")
  .requiredOption("--topic <topic>", "Topic to search for")
  .action(
    withErrorHandler(async (options) => {
      const spinner = ora({ text: "Searching YouTube", color: "cyan" }).start();

      const { stdout } = await runYtDlp([
        "--dump-single-json",
        "--flat-playlist",
        `ytsearch10:${options.topic}`,
        "--no-playlist",
      ]);

      const payload = JSON.parse(stdout);
      const entries = Array.isArray(payload.entries) ? payload.entries : [];

      // Extract unique channels from results
      const channelMap = new Map();
      for (const entry of entries) {
        const channel = entry.channel || entry.uploader || null;
        const channelUrl = entry.channel_url || entry.uploader_url || null;
        if (channel && channelUrl && !channelMap.has(channel)) {
          channelMap.set(channel, {
            name: channel,
            url: channelUrl,
            videoCount: 0,
          });
        }
        if (channel && channelMap.has(channel)) {
          channelMap.get(channel).videoCount++;
        }
      }

      const channels = [...channelMap.values()]
        .sort((a, b) => b.videoCount - a.videoCount)
        .slice(0, 5);

      spinner.succeed(`Found ${channels.length} channel(s) for "${options.topic}"`);

      if (channels.length === 0) {
        process.stdout.write(chalk.yellow("No channels found for this topic.\n"));
        return;
      }

      process.stdout.write(`\n${chalk.bold("Top channel suggestions:")}\n\n`);
      for (let i = 0; i < channels.length; i++) {
        const ch = channels[i];
        process.stdout.write(
          `  ${chalk.green(String(i + 1) + ".")} ${chalk.bold(ch.name)}\n`
        );
        process.stdout.write(
          `     ${chalk.dim(ch.url)}\n`
        );
        process.stdout.write(
          `     ${chalk.dim(`${ch.videoCount} video(s) in search results`)}\n\n`
        );
      }

      const topChannel = channels[0];
      process.stdout.write(
        `${chalk.dim("Next:")} skillforge scan ${topChannel.url} --intent "${options.topic}"\n`
      );
    })
  );

// ── scan ──────────────────────────────────────────────────────────────
program
  .command("scan <url>")
  .description("Score videos by relevance to an intent and save a proposal")
  .requiredOption("--intent <intent>", "What you want to learn")
  .option(
    "--limit <n>",
    "Maximum number of videos to scan",
    (v) => Number.parseInt(v, 10),
    20
  )
  .action(
    withErrorHandler(async (url, options) => {
      const spinner = ora({ text: "Scanning source", color: "cyan" }).start();

      const source = resolveSource(url, {});
      spinner.text = "Resolving videos";
      const sourceItems = await gatherSourceItems(source, options.limit);

      if (!sourceItems.discovered.length) {
        spinner.fail("No videos found at that URL.");
        return;
      }

      spinner.text = `Scoring ${sourceItems.discovered.length} videos against intent`;
      const scored = scoreVideos(sourceItems.discovered, options.intent);

      spinner.text = "Saving proposal";
      const proposal = await propose.create(url, options.intent, scored);

      spinner.succeed(`Proposal ${chalk.bold(proposal.id)} saved`);

      const top = scored.filter((v) => v.score > 0).slice(0, 10);
      process.stdout.write(`\n${chalk.bold("Top matches:")}\n`);
      for (const v of top) {
        const bar = chalk.green("█".repeat(Math.round(v.score / 5)));
        process.stdout.write(
          `  ${chalk.dim(String(v.score).padStart(3))}  ${bar}  ${v.title}\n`
        );
      }

      process.stdout.write(
        `\n${chalk.dim("Suggested skills:")}\n`
      );
      for (const s of proposal.suggestedSkills) {
        process.stdout.write(
          `  ${chalk.bold(s.letter)}  ${s.name} — ${s.description}\n`
        );
      }

      process.stdout.write(
        `\n${chalk.dim("Next:")} skillforge build --proposal ${proposal.id}\n`
      );
    })
  );

// ── build ─────────────────────────────────────────────────────────────
program
  .command("build [url]")
  .description("Build a skill document from a YouTube URL, channel, topic, or proposal")
  .option("--proposal <id>", "Build from a saved proposal")
  .option("--skills <skills>", "Comma-separated skill letters to build from proposal")
  .option("--channel <channelUrl>", "Build from a full YouTube channel")
  .option("--channels <channels>", "Comma-separated channel URLs for multi-channel build", collectUrls)
  .option("--topic <topic>", "Search YouTube for a topic and auto-build")
  .option("--urls <urls>", "Comma-separated list of specific YouTube URLs", collectUrls)
  .option("--intent <intent>", "Intent string for skill indexing")
  .option("--creator <name>", "Creator name for library scoping")
  .option("--auto", "Skip proposal review and build directly")
  .option(
    "--output <path>",
    "Where to save the generated output",
    "./output"
  )
  .option(
    "--format <format>",
    "Output format: skill, markdown, or json",
    "skill"
  )
  .option(
    "--limit <n>",
    "Maximum number of videos to process",
    (value) => Number.parseInt(value, 10),
    10
  )
  .option(
    "--model <model>",
    "AI model to use",
    "claude-sonnet-4-20250514"
  )
  .action(
    withErrorHandler(async (url, options) => {
      const spinner = ora({ text: "Preparing build", color: "cyan" }).start();

      if (options.auto) {
        process.stdout.write(
          chalk.yellow("Auto mode: skipping proposal review\n")
        );
      }

      if (!["skill", "markdown", "json"].includes(options.format)) {
        throw new Error("`--format` must be one of: skill, markdown, json.");
      }

      if (!Number.isInteger(options.limit) || options.limit <= 0) {
        throw new Error("`--limit` must be a positive integer.");
      }

      let sourceUrls;
      let topic;
      let intent = options.intent || "";
      let channelSources = null;

      if (options.proposal && !options.auto) {
        // Build from proposal
        spinner.text = "Loading proposal";
        const proposal = await propose.load(options.proposal);
        intent = intent || proposal.intent;
        topic = proposal.intent;

        if (options.skills) {
          const letters = options.skills.toUpperCase().split(",").map((s) => s.trim());
          const selected = proposal.suggestedSkills.filter((s) =>
            letters.includes(s.letter)
          );
          const videoIds = new Set(selected.flatMap((s) => s.videoIds));
          sourceUrls = proposal.videos
            .filter((v) => videoIds.has(v.id || v.url))
            .map((v) => v.url);
        } else {
          // Use all videos with score > 0
          sourceUrls = proposal.videos
            .filter((v) => v.score > 0)
            .map((v) => v.url);
        }

        if (!sourceUrls.length) {
          throw new Error("No videos matched the selected skills in this proposal.");
        }
      } else {
        // Direct build flow (also used when --auto is set)
        const source = resolveSource(url, options);

        spinner.text = "Resolving source videos";
        const sourceItems = await gatherSourceItems(source, options.limit);
        if (!sourceItems.urls.length) {
          throw new Error("No videos were found for the requested source.");
        }

        sourceUrls = sourceItems.urls.slice(
          0,
          source.type === "url" || source.type === "urls"
            ? sourceItems.urls.length
            : options.limit
        );
        topic = sourceItems.topic;
        channelSources = sourceItems.sources || null;
      }

      spinner.text = `Fetching transcripts from ${sourceUrls.length} video(s)`;
      const transcripts = await extractFromUrls(sourceUrls, {
        limit: sourceUrls.length,
      });

      // Deduplicate across channels (title token overlap > 70%)
      if (channelSources && channelSources.length > 1) {
        const before = transcripts.length;
        const deduped = deduplicateTranscripts(transcripts);
        transcripts.length = 0;
        transcripts.push(...deduped);
        if (before !== transcripts.length) {
          process.stdout.write(
            chalk.dim(`Deduplicated: ${before} → ${transcripts.length} transcripts\n`)
          );
        }
      }

      if (!transcripts.length) {
        throw new Error(
          "No transcripts were available. Try a different set of videos or verify subtitle availability."
        );
      }

      // Detect creator from --creator flag or first transcript's channel
      let detectedCreator = options.creator || null;
      if (!detectedCreator && !channelSources && transcripts[0]?.channelTitle) {
        detectedCreator = transcripts[0].channelTitle;
      }

      let destination;
      let creatorMeta = null;
      const safeTopic = slugify(topic || "skillforge-output");

      if (detectedCreator && !channelSources) {
        const creatorSlug = slugifyCreator(detectedCreator);
        creatorMeta = { creator: detectedCreator, creatorSlug };
        destination = path.join(os.homedir(), ".skillforge", "library", creatorSlug, `${safeTopic}.skill.md`);

        // Merge: load existing source URLs and re-fetch cached transcripts
        try {
          const existingContent = await fs.readFile(destination, "utf8");
          const existingUrls = [];
          let inSV = false;
          for (const line of existingContent.split("\n")) {
            if (line === "---" && inSV) break;
            if (line.startsWith("source_videos:")) { inSV = true; continue; }
            if (inSV) {
              const m = line.match(/^\s+-\s+url:\s+"([^"]+)"/);
              const m2 = line.match(/^\s+-\s+"([^"]+)"/);
              if (m) existingUrls.push(m[1]);
              else if (m2) existingUrls.push(m2[1]);
              else if (!line.match(/^\s+date:/)) inSV = false;
            }
          }
          const newUrls = new Set(transcripts.map((t) => t.url));
          const missingUrls = existingUrls.filter((u) => !newUrls.has(u));
          if (missingUrls.length > 0) {
            spinner.text = `Merging with ${missingUrls.length} existing source(s)`;
            const oldTranscripts = await extractFromUrls(missingUrls, { limit: missingUrls.length });
            transcripts.push(...oldTranscripts);
          }
        } catch {
          // No existing file — fresh build
        }
      } else {
        destination = resolveDestination(options.output, options.format, topic);
      }

      spinner.text = "Synthesizing knowledge with AI";
      const synthesis = await synthesizeKnowledge({
        transcripts,
        topic,
        model: options.model,
        intent,
        outputPath: destination,
        creatorMeta,
      });

      // Attach channel sources for multi-channel builds
      if (channelSources) {
        synthesis.sources = channelSources;
        synthesis.merged_from_channels = channelSources;
      }

      spinner.text = "Formatting output";
      const content = formatDocument(options.format, synthesis);

      await writeOutput(destination, content);

      spinner.succeed(`SkillForge output saved to ${destination}`);

      if (detectedCreator) {
        process.stdout.write(
          `${chalk.green("Creator:")} ${detectedCreator}\n`
        );
      }
      process.stdout.write(
        `${chalk.green("Processed transcripts:")} ${transcripts.length}\n`
      );
      process.stdout.write(
        `${chalk.green("Format:")} ${options.format} | ${chalk.green(
          "Model:"
        )} ${options.model}\n`
      );
      if (intent) {
        process.stdout.write(
          `${chalk.green("Indexed with intent:")} ${intent}\n`
        );
      }
      if (channelSources) {
        process.stdout.write(
          `${chalk.green("Sources:")} ${channelSources.join(", ")}\n`
        );
      }
    })
  );

// ── watch ─────────────────────────────────────────────────────────────
program
  .command("watch <url>")
  .description("Preview a video's content before building a skill")
  .option("--skill <topic>", "Topic slug for the skill (enables creator-scoped library path)")
  .option("--model <model>", "AI model to use", "claude-sonnet-4-20250514")
  .option("--output <path>", "Where to save the generated output", "./output")
  .option("--format <format>", "Output format: skill, markdown, or json", "skill")
  .option("--intent <intent>", "Intent string for skill indexing")
  .action(
    withErrorHandler(async (url, options) => {
      const spinner = ora({ text: "Fetching transcript", color: "cyan" }).start();
      const transcriptData = await fetchTranscriptForUrl(url);

      if (!transcriptData.transcript) {
        spinner.fail("No transcript available for this video.");
        return;
      }

      spinner.text = "Generating preview";
      const preview = await previewTranscript({
        transcript: transcriptData.transcript,
        topic: options.intent || options.skill || transcriptData.title,
        model: options.model,
      });

      spinner.stop();

      const detectedCreator = transcriptData.channelTitle || null;
      if (detectedCreator) {
        process.stdout.write(`${chalk.dim("Creator:")} ${detectedCreator}\n`);
      }

      process.stdout.write(`\n${chalk.bold(transcriptData.title)}\n\n`);
      for (const bullet of preview.bullets) {
        process.stdout.write(`  ${chalk.green("•")} ${bullet}\n`);
      }
      process.stdout.write("\n");

      // Check if this would be a merge
      if (detectedCreator && options.skill) {
        const creatorSlug = slugifyCreator(detectedCreator);
        const topicSlug = slugify(options.skill);
        const libraryPath = path.join(os.homedir(), ".skillforge", "library", creatorSlug, `${topicSlug}.skill.md`);
        try {
          await fs.access(libraryPath);
          process.stdout.write(`${chalk.cyan("Merge:")} will add to existing skill at ${libraryPath}\n\n`);
        } catch {
          // New skill
        }
      }

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise((resolve) => {
        rl.question(chalk.bold("Build this skill? [y/N] "), resolve);
      });
      rl.close();

      if (answer.trim().toLowerCase() !== "y") {
        process.stdout.write(chalk.dim("Skipped.\n"));
        return;
      }

      const buildSpinner = ora({ text: "Synthesizing knowledge with AI", color: "cyan" }).start();
      const transcripts = [transcriptData];
      const topic = options.skill || transcriptData.title || "YouTube Video";
      const safeTopic = slugify(topic);
      const intent = options.intent || "";

      let destination;
      let creatorMeta = null;

      if (detectedCreator) {
        const creatorSlug = slugifyCreator(detectedCreator);
        creatorMeta = { creator: detectedCreator, creatorSlug };
        destination = path.join(os.homedir(), ".skillforge", "library", creatorSlug, `${safeTopic}.skill.md`);

        // Merge: load existing source URLs and re-fetch cached transcripts
        try {
          const existingContent = await fs.readFile(destination, "utf8");
          const existingUrls = [];
          let inSV = false;
          for (const line of existingContent.split("\n")) {
            if (line === "---" && inSV) break;
            if (line.startsWith("source_videos:")) { inSV = true; continue; }
            if (inSV) {
              const m = line.match(/^\s+-\s+url:\s+"([^"]+)"/);
              const m2 = line.match(/^\s+-\s+"([^"]+)"/);
              if (m) existingUrls.push(m[1]);
              else if (m2) existingUrls.push(m2[1]);
              else if (!line.match(/^\s+date:/)) inSV = false;
            }
          }
          const newUrls = new Set(transcripts.map((t) => t.url));
          const missingUrls = existingUrls.filter((u) => !newUrls.has(u));
          if (missingUrls.length > 0) {
            buildSpinner.text = `Merging with ${missingUrls.length} existing source(s)`;
            const oldTranscripts = await extractFromUrls(missingUrls, { limit: missingUrls.length });
            transcripts.push(...oldTranscripts);
          }
        } catch {
          // No existing file — fresh build
        }
      } else {
        destination = resolveDestination(options.output, options.format, topic);
      }

      buildSpinner.text = "Synthesizing knowledge with AI";
      const synthesis = await synthesizeKnowledge({
        transcripts,
        topic,
        model: options.model,
        intent,
        outputPath: destination,
        creatorMeta,
      });

      buildSpinner.text = "Formatting output";
      const content = formatDocument(options.format, synthesis);
      await writeOutput(destination, content);

      buildSpinner.succeed(`Skill saved to ${destination}`);
      if (detectedCreator) {
        process.stdout.write(`${chalk.green("Creator:")} ${detectedCreator}\n`);
      }
      if (transcripts.length > 1) {
        process.stdout.write(`${chalk.green("Sources merged:")} ${transcripts.length}\n`);
      }
      process.stdout.write(`${chalk.green("Format:")} ${options.format} | ${chalk.green("Model:")} ${options.model}\n`);
      if (intent) {
        process.stdout.write(`${chalk.green("Indexed with intent:")} ${intent}\n`);
      }
    })
  );

// ── recall ────────────────────────────────────────────────────────────
program
  .command("recall")
  .description("Search the skill library by intent")
  .requiredOption("--intent <intent>", "What you're looking for")
  .action(
    withErrorHandler(async (options) => {
      const results = await skillIndex.search(options.intent);

      if (results.length === 0) {
        process.stdout.write(chalk.yellow("No matching skills found.\n"));
        return;
      }

      process.stdout.write(
        chalk.bold(`Found ${results.length} matching skill(s):\n\n`)
      );
      for (const skill of results) {
        const rel = Math.round((skill.relevance || 0) * 100);
        const displaySlug = skill.compositeSlug || skill.slug;
        process.stdout.write(
          `  ${chalk.green(String(rel).padStart(3) + "%")}  ${chalk.bold(skill.name)} ${chalk.dim("(" + displaySlug + ")")}\n`
        );
        if (skill.creator) {
          process.stdout.write(`        ${chalk.dim("Creator:")} ${skill.creator}\n`);
        }
        if (skill.intent) {
          process.stdout.write(`        ${chalk.dim("Intent:")} ${skill.intent}\n`);
        }
        if (skill.filePath) {
          process.stdout.write(`        ${chalk.dim("File:")} ${skill.filePath}\n`);
        }
        process.stdout.write("\n");
      }
    })
  );

// ── list ──────────────────────────────────────────────────────────────
program
  .command("list")
  .description("List all saved skills in the library")
  .action(
    withErrorHandler(async () => {
      const groups = await skillIndex.listByCreator();
      const allKeys = Object.keys(groups);

      if (allKeys.length === 0) {
        process.stdout.write(chalk.yellow("No skills in the library yet.\n"));
        process.stdout.write(
          chalk.dim("Run `skillforge scan` then `skillforge build` to create your first skill.\n")
        );
        return;
      }

      const total = allKeys.reduce((sum, k) => sum + groups[k].length, 0);
      process.stdout.write(chalk.bold(`${total} skill(s) in library:\n\n`));

      for (const creatorSlug of allKeys) {
        const skills = groups[creatorSlug];
        if (creatorSlug === "_ungrouped") {
          process.stdout.write(chalk.bold("  Ungrouped\n"));
        } else {
          const creatorName = skills[0]?.creator || creatorSlug;
          process.stdout.write(chalk.bold(`  ${creatorName} ${chalk.dim("(" + creatorSlug + ")")}\n`));
        }

        for (const skill of skills) {
          const displaySlug = skill.compositeSlug || skill.slug;
          process.stdout.write(
            `    ${chalk.bold(skill.name)} ${chalk.dim("(" + displaySlug + ")")}\n`
          );
          if (skill.tags?.length) {
            process.stdout.write(`      ${chalk.dim("Tags:")} ${skill.tags.join(", ")}\n`);
          }
          if (skill.createdAt) {
            process.stdout.write(`      ${chalk.dim("Created:")} ${skill.createdAt}\n`);
          }
        }
        process.stdout.write("\n");
      }
    })
  );

// ── prune ─────────────────────────────────────────────────────────────
program
  .command("prune")
  .description("Remove skills from the index")
  .option("--skill <name>", "Slug of the skill to remove")
  .action(
    withErrorHandler(async (options) => {
      if (!options.skill) {
        process.stderr.write(
          chalk.red("Specify a skill to remove with --skill <slug>\n")
        );
        process.stdout.write(chalk.dim("Use `skillforge list` to see available slugs.\n"));
        process.exitCode = 1;
        return;
      }

      const removed = await skillIndex.remove(options.skill);
      if (removed) {
        process.stdout.write(
          chalk.green(`Removed "${options.skill}" from the skill index.\n`)
        );
      } else {
        process.stdout.write(
          chalk.yellow(`Skill "${options.skill}" was not found in the index.\n`)
        );
      }
    })
  );

// ── serve ─────────────────────────────────────────────────────────────
program
  .command("serve")
  .description("Start the SkillForge MCP server (stdio transport)")
  .action(
    withErrorHandler(async () => {
      const { startServer } = await import("../src/mcp.js");
      await startServer();
    })
  );

await program.parseAsync(process.argv);
