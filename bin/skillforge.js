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
  .version("0.2.0");

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
  .option("--topic <topic>", "Search YouTube for a topic and auto-build")
  .option("--urls <urls>", "Comma-separated list of specific YouTube URLs", collectUrls)
  .option("--intent <intent>", "Intent string for skill indexing")
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

      if (!["skill", "markdown", "json"].includes(options.format)) {
        throw new Error("`--format` must be one of: skill, markdown, json.");
      }

      if (!Number.isInteger(options.limit) || options.limit <= 0) {
        throw new Error("`--limit` must be a positive integer.");
      }

      let sourceUrls;
      let topic;
      let intent = options.intent || "";

      if (options.proposal) {
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
        // Original v1 flow
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
      }

      spinner.text = `Fetching transcripts from ${sourceUrls.length} video(s)`;
      const transcripts = await extractFromUrls(sourceUrls, {
        limit: sourceUrls.length,
      });

      if (!transcripts.length) {
        throw new Error(
          "No transcripts were available. Try a different set of videos or verify subtitle availability."
        );
      }

      spinner.text = "Synthesizing knowledge with AI";
      const destination = resolveDestination(
        options.output,
        options.format,
        topic
      );

      const synthesis = await synthesizeKnowledge({
        transcripts,
        topic,
        model: options.model,
        intent,
        outputPath: destination,
      });

      spinner.text = "Formatting output";
      const content = formatDocument(options.format, synthesis);

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
      if (intent) {
        process.stdout.write(
          `${chalk.green("Indexed with intent:")} ${intent}\n`
        );
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

// ── list ──────────────────────────────────────────────────────────────
program
  .command("list")
  .description("List all saved skills in the library")
  .action(
    withErrorHandler(async () => {
      const skills = await skillIndex.list();

      if (skills.length === 0) {
        process.stdout.write(chalk.yellow("No skills in the library yet.\n"));
        process.stdout.write(
          chalk.dim("Run `skillforge scan` then `skillforge build` to create your first skill.\n")
        );
        return;
      }

      process.stdout.write(chalk.bold(`${skills.length} skill(s) in library:\n\n`));
      for (const skill of skills) {
        process.stdout.write(
          `  ${chalk.bold(skill.name)} ${chalk.dim("(" + skill.slug + ")")}\n`
        );
        if (skill.domain) {
          process.stdout.write(`    ${chalk.dim("Domain:")} ${skill.domain}\n`);
        }
        if (skill.tags?.length) {
          process.stdout.write(`    ${chalk.dim("Tags:")} ${skill.tags.join(", ")}\n`);
        }
        if (skill.createdAt) {
          process.stdout.write(`    ${chalk.dim("Created:")} ${skill.createdAt}\n`);
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

await program.parseAsync(process.argv);
