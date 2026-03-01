import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

function runYtDlp(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("yt-dlp", args, {
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
  return subtitleFile ? path.join(tempDir, subtitleFile) : null;
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

async function fetchTranscriptForUrl(url) {
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

    const subtitlePath = await readFirstSubtitleFile(tempDir);
    if (!subtitlePath) {
      return null;
    }

    const vttContent = await fs.readFile(subtitlePath, "utf8");
    const transcript = parseVtt(vttContent);

    if (!transcript.trim()) {
      return null;
    }

    return {
      url,
      title: metadata.title || url,
      channelTitle: metadata.channel || metadata.uploader || null,
      transcript,
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
      process.stderr.write(
        `[skillforge] Warning: skipped ${url} due to extraction error: ${error.message}\n`
      );
    }
  }

  return results;
}

export {
  extractFromUrls,
  fetchTranscriptForUrl,
  inspectUrl,
  listChannelVideoUrls,
  parseVtt,
  runYtDlp,
};
