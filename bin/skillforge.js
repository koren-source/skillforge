#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";

import {
  extractFromUrls,
  inspectUrl,
  listChannelVideoUrls,
} from "../src/extract.js";
import { searchTopic } from "../src/search.js";
import { synthesizeKnowledge } from "../src/synthesize.js";
import {
  formatDocument,
  makeOutputFilename,
  slugify,
} from "../src/format.js";

const program = new Command();

function collectUrls(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveSource(inputUrl, options) {
  const sources = [
    inputUrl ? { type: "url", value: inputUrl } : null,
    options.channel ? { type: "channel", value: options.channel } : null,
    options.topic ? { type: "topic", value: options.topic } : null,
    options.urls && options.urls.length
      ? { type: "urls", value: options.urls }
      : null,
  ].filter(Boolean);

  if (sources.length === 0) {
    throw new Error(
      "Provide exactly one source: <url>, --channel, --topic, or --urls."
    );
  }

  if (sources.length > 1) {
    throw new Error(
      "Only one source mode can be used at a time: <url>, --channel, --topic, or --urls."
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
        }));

      return {
        discovered,
        urls: discovered.map((item) => item.url),
        topic: metadata.title || "YouTube Playlist",
      };
    }

    return {
      discovered: [{ url: source.value, title: metadata.title || source.value }],
      urls: [source.value],
      topic: metadata.title || "YouTube Video",
    };
  }

  if (source.type === "urls") {
    return {
      discovered: source.value.map((url) => ({ url, title: url })),
      urls: source.value,
      topic: "YouTube Playlist",
    };
  }

  if (source.type === "channel") {
    const discovered = await listChannelVideoUrls(source.value, limit);
    return {
      discovered,
      urls: discovered.map((item) => item.url),
      topic: discovered[0] ? discovered[0].channelTitle || "YouTube Channel" : "YouTube Channel",
    };
  }

  if (source.type === "topic") {
    const discovered = await searchTopic(source.value, limit);
    return {
      discovered,
      urls: discovered.map((item) => item.url),
      topic: source.value,
    };
  }

  throw new Error(`Unsupported source type: ${source.type}`);
}

program
  .name("skillforge")
  .description("Turn YouTube videos, channels, and topics into agent-ready skills")
  .version("0.1.0");

program
  .command("build [url]")
  .description("Build a skill document from a YouTube URL, channel, or topic")
  .option("--channel <channelUrl>", "Build from a full YouTube channel")
  .option("--topic <topic>", "Search YouTube for a topic and auto-build")
  .option("--urls <urls>", "Comma-separated list of specific YouTube URLs", collectUrls)
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
    "claude-3-5-sonnet-20241022"
  )
  .action(async (url, options) => {
    const spinner = ora({ text: "Preparing build", color: "cyan" }).start();

    try {
      const source = resolveSource(url, options);

      if (!["skill", "markdown", "json"].includes(options.format)) {
        throw new Error("`--format` must be one of: skill, markdown, json.");
      }

      if (!Number.isInteger(options.limit) || options.limit <= 0) {
        throw new Error("`--limit` must be a positive integer.");
      }

      spinner.text = "Resolving source videos";
      const sourceItems = await gatherSourceItems(source, options.limit);
      if (!sourceItems.urls.length) {
        throw new Error("No videos were found for the requested source.");
      }

      spinner.text = `Fetching transcripts from ${sourceItems.urls.length} video(s)`;
      const transcripts = await extractFromUrls(sourceItems.urls, {
        limit:
          source.type === "url" || source.type === "urls"
            ? sourceItems.urls.length
            : options.limit,
      });

      if (!transcripts.length) {
        throw new Error(
          "No transcripts were available. Try a different set of videos or verify subtitle availability."
        );
      }

      spinner.text = "Synthesizing knowledge with AI";
      const synthesis = await synthesizeKnowledge({
        transcripts,
        topic: sourceItems.topic,
        model: options.model,
      });

      spinner.text = "Formatting output";
      const content = formatDocument(options.format, synthesis);
      const destination = resolveDestination(
        options.output,
        options.format,
        synthesis.topic
      );

      await writeOutput(destination, content);

      spinner.succeed(`SkillForge output saved to ${destination}`);

      process.stdout.write(
        `${chalk.green("Processed transcripts:")} ${transcripts.length}\n`
      );
      process.stdout.write(
        `${chalk.green("Format:")} ${options.format} | ${chalk.green(
          "Model:"
        )} ${options.model}\n`
      );
    } catch (error) {
      spinner.fail("Build failed");
      process.stderr.write(`${chalk.red(error.message)}\n`);
      process.exitCode = 1;
    }
  });

await program.parseAsync(process.argv);
