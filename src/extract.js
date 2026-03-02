import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import * as cache from "./cache.js";

// Always pass the node JS runtime + remote component solver so yt-dlp can handle YouTube's JS challenges
const YT_DLP_BASE_ARGS = [
  "--js-runtimes", "node:/opt/homebrew/bin/node",
  "--remote-components", "ejs:github",
];

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

async function checkWhisperInstalled() {
  return new Promise((resolve) => {
    const child = spawn("whisper", ["--help"], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", () => resolve(true));
  });
}

async function runWhisper(audioPath, outputDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "whisper",
      [audioPath, "--output_format", "txt", "--model", "base", "--output_dir", outputDir],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    let stderr = "";
    child.stdout.on("data", () => {});
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        reject(
          new Error(
            "Whisper is not installed or not on PATH. Install it with: pip install openai-whisper\nSee: https://github.com/openai/whisper#setup"
          )
        );
        return;
      }
      reject(error);
    });

    child.on("close", async (code) => {
      if (code !== 0) {
        reject(new Error(`Whisper exited with code ${code}: ${stderr.trim()}`));
        return;
      }

      const baseName = path.basename(audioPath, path.extname(audioPath));
      const txtPath = path.join(outputDir, `${baseName}.txt`);

      try {
        const text = await fs.readFile(txtPath, "utf8");
        resolve(text.trim());
      } catch {
        reject(new Error(`Whisper completed but output file not found: ${txtPath}`));
      }
    });
  });
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

    let transcript = null;
    let captionSource = null;

    // Fast path: subtitle download with browser cookies
    try {
      await runYtDlpOnce(
        [
          "--cookies-from-browser", "chrome",
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
      if (subtitleResult) {
        const vttContent = await fs.readFile(subtitleResult.path, "utf8");
        const parsed = parseVtt(vttContent);
        if (parsed.trim()) {
          transcript = parsed;
          captionSource = subtitleResult.captionSource;
        }
      }
    } catch {
      // Subtitle download failed (429, auth, no subs, etc.) — fall through to Whisper
    }

    // Slow path: Whisper transcription fallback
    if (!transcript) {
      process.stderr.write(
        "[skillforge] Subtitle download failed, falling back to Whisper transcription...\n"
      );

      if (!(await checkWhisperInstalled())) {
        throw new Error(
          "Whisper is not installed or not on PATH. Install it with: pip install openai-whisper\n" +
          "See: https://github.com/openai/whisper#setup"
        );
      }

      await runYtDlp(
        ["-x", "--audio-format", "wav", "-o", path.join(tempDir, "whisper-audio.%(ext)s"), url],
        { cwd: tempDir }
      );

      // Find the audio file yt-dlp produced
      const files = await fs.readdir(tempDir);
      const audioFile = files.find(
        (f) => f.startsWith("whisper-audio.") && /\.(wav|mp3|m4a|opus|webm|ogg|flac)$/i.test(f)
      );
      if (!audioFile) {
        throw new Error("Audio download completed but no audio file found in temp directory");
      }

      const audioPath = path.join(tempDir, audioFile);
      transcript = await runWhisper(audioPath, tempDir);
      captionSource = "whisper";
    }

    if (!transcript || !transcript.trim()) {
      return null;
    }

    if (captionSource === "auto") {
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
      captionSource,
    };
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
