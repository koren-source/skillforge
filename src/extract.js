import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import * as cache from "./cache.js";

// Always pass the node JS runtime so yt-dlp can solve YouTube's JS challenges
const YT_DLP_BASE_ARGS = ["--js-runtimes", "node:/opt/homebrew/bin/node"];

function runYtDlpOnce(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("yt-dlp", [...YT_DLP_BASE_ARGS, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        reject(
          new Error(
            "yt-dlp is not installed or not on PATH. Install it first: https://github.com/yt-dlp/yt-dlp#installation"
          )
        );
        return;
      }

      reject(error);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            stderr.trim() || `yt-dlp exited with non-zero status ${code}`
          )
        );
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 5000;

function isRateLimitError(errorMessage) {
  const msg = String(errorMessage).toLowerCase();
  return msg.includes("429") || msg.includes("too many requests") || msg.includes("rate limit");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runYtDlp(args, options = {}) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await runYtDlpOnce(args, options);
    } catch (error) {
      lastError = error;
      if (isRateLimitError(error.message) && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        process.stderr.write(
          `[skillforge] Rate limited by YouTube (429). Retrying in ${Math.round(delay / 1000)}s (attempt ${attempt + 1}/${MAX_RETRIES})...\n`
        );
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

function parseJsonLines(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function normalizeTranscriptLine(line) {
  return line
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseVtt(vttContent) {
  const lines = vttContent.split(/\r?\n/);
  const transcript = [];
  const seen = new Set();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (
      line === "WEBVTT" ||
      /^\d+$/.test(line) ||
      line.startsWith("Kind:") ||
      line.startsWith("Language:") ||
      line.includes("-->")
    ) {
      continue;
    }

    const normalized = normalizeTranscriptLine(line);
    if (!normalized) {
      continue;
    }

    // Auto-generated subtitles repeat heavily. Keep order but collapse exact duplicates.
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    transcript.push(normalized);
  }

  return transcript.join("\n");
}

async function readFirstSubtitleFile(tempDir) {
  const files = await fs.readdir(tempDir);
  const subtitleFile = files.find((file) => file.endsWith(".vtt"));
  if (!subtitleFile) return null;
  const isAuto = /\.auto\./.test(subtitleFile) || /asr/.test(subtitleFile);
  return {
    path: path.join(tempDir, subtitleFile),
    captionSource: isAuto ? "auto" : "manual",
  };
}

async function fetchVideoMetadata(url) {
  const { stdout } = await runYtDlp([
    "--dump-single-json",
    "--no-warnings",
    "--skip-download",
    url,
  ]);

  return JSON.parse(stdout);
}

async function inspectUrl(url) {
  return fetchVideoMetadata(url);
}

function extractVideoId(url) {
  const match = String(url).match(
    /(?:v=|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

async function fetchTranscriptForUrl(url) {
  const videoId = extractVideoId(url);

  // Check cache first — includes metadata so no network call needed
  if (videoId) {
    const cached = await cache.get(videoId);
    if (cached) {
      return {
        url,
        title: cached.title || url,
        channelTitle: cached.channelTitle || null,
        channelUrl: cached.channelUrl || null,
        transcript: cached.transcript,
      };
    }
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "skillforge-"));

  try {
    const metadata = await fetchVideoMetadata(url);
    await runYtDlp(
      [
        "--skip-download",
        "--write-auto-sub",
        "--write-sub",
        "--sub-langs",
        "en.*,en",
        "--sub-format",
        "vtt",
        "-o",
        path.join(tempDir, "%(id)s.%(ext)s"),
        url,
      ],
      { cwd: tempDir }
    );

    const subtitleResult = await readFirstSubtitleFile(tempDir);
    if (!subtitleResult) {
      return null;
    }

    const vttContent = await fs.readFile(subtitleResult.path, "utf8");
    const transcript = parseVtt(vttContent);

    if (!transcript.trim()) {
      return null;
    }

    if (subtitleResult.captionSource === "auto") {
      console.warn(`[SkillForge] Warning: using auto-generated captions for: ${metadata.title || url}`);
    }

    // Save to cache (with metadata to avoid future network calls)
    if (videoId) {
      await cache.set(videoId, {
        transcript,
        title: metadata.title || url,
        channelTitle: metadata.channel || metadata.uploader || null,
        channelUrl: metadata.channel_url || metadata.uploader_url || null,
      });
    }

    return {
      url,
      title: metadata.title || url,
      channelTitle: metadata.channel || metadata.uploader || null,
      channelUrl: metadata.channel_url || metadata.uploader_url || null,
      transcript,
      captionSource: subtitleResult.captionSource,
    };
  } catch (error) {
    const message = String(error.message || "");
    if (
      message.includes("There are no subtitles") ||
      message.includes("Subtitles are not available")
    ) {
      return null;
    }

    throw error;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function listChannelVideoUrls(channelUrl, limit = 10) {
  const { stdout } = await runYtDlp([
    "--dump-json",
    "--flat-playlist",
    "--playlist-end",
    String(limit),
    channelUrl,
  ]);

  const entries = parseJsonLines(stdout);

  return entries
    .map((entry) => ({
      id: entry.id,
      title: entry.title || entry.id,
      url: entry.url && entry.url.startsWith("http")
        ? entry.url
        : `https://www.youtube.com/watch?v=${entry.id}`,
      channelTitle: entry.channel || entry.uploader || null,
      description: entry.description || "",
      duration: entry.duration || 0,
    }))
    .filter((item) => item.id);
}

async function extractFromUrls(urls, options = {}) {
  const limit = options.limit || urls.length;
  const selected = urls.slice(0, limit);
  const results = [];

  for (const url of selected) {
    try {
      const transcriptData = await fetchTranscriptForUrl(url);
      if (!transcriptData) {
        process.stderr.write(
          `[skillforge] Warning: skipped ${url} because no transcript was available.\n`
        );
        continue;
      }

      results.push(transcriptData);
    } catch (error) {
      const msg = String(error.message || "");
      if (msg.includes("429") || msg.toLowerCase().includes("too many requests") || msg.toLowerCase().includes("rate limit")) {
        // Rate limit — re-throw so outer retry logic can handle it
        throw error;
      }
      if (msg.toLowerCase().includes("private") || msg.toLowerCase().includes("unavailable")) {
        process.stderr.write(
          `[skillforge] Warning: skipped ${url} — video unavailable or private.\n`
        );
      } else {
        process.stderr.write(
          `[skillforge] Warning: skipped ${url} due to extraction error: ${msg}\n`
        );
      }
    }
  }

  return results;
}

export {
  extractFromUrls,
  extractVideoId,
  fetchTranscriptForUrl,
  inspectUrl,
  listChannelVideoUrls,
  parseVtt,
  runYtDlp,
};
