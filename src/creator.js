import { runYtDlp } from "./extract.js";

/**
 * Extract a normalized creator handle from any YouTube URL format.
 *
 * Supported URL shapes:
 *   https://www.youtube.com/@AlexHormozi/videos
 *   https://www.youtube.com/c/AlexHormozi
 *   https://www.youtube.com/channel/UCo7fKBaSwEOBQLMCnOYvSEA
 *   https://www.youtube.com/watch?v=abc123
 *   https://youtu.be/abc123
 *   https://www.youtube.com/shorts/abc123
 *   https://www.youtube.com/playlist?list=PLxyz
 *
 * Returns a handle string like "@alexhormozi" (lowercase, no slashes).
 * For channel IDs (UC...) it returns the raw ID as the handle.
 * For video/shorts/playlist URLs it fetches metadata to resolve the channel.
 */

const HANDLE_RE = /youtube\.com\/@([a-zA-Z0-9_.-]+)/;
const CUSTOM_RE = /youtube\.com\/c\/([a-zA-Z0-9_.-]+)/;
const CHANNEL_ID_RE = /youtube\.com\/channel\/(UC[a-zA-Z0-9_-]+)/;
const VIDEO_RE = /(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/;
const PLAYLIST_RE = /youtube\.com\/playlist\?.*list=([a-zA-Z0-9_-]+)/;

function extractHandleFromUrl(url) {
  const str = String(url || "");

  const handleMatch = str.match(HANDLE_RE);
  if (handleMatch) {
    return `@${handleMatch[1].toLowerCase()}`;
  }

  const customMatch = str.match(CUSTOM_RE);
  if (customMatch) {
    return `@${customMatch[1].toLowerCase()}`;
  }

  const channelIdMatch = str.match(CHANNEL_ID_RE);
  if (channelIdMatch) {
    return channelIdMatch[1];
  }

  return null;
}

async function resolveCreator(url) {
  // Try static extraction first
  const staticHandle = extractHandleFromUrl(url);
  if (staticHandle) return staticHandle;

  // For video/shorts/playlist URLs, fetch metadata via yt-dlp
  const str = String(url || "");
  const isResolvable = VIDEO_RE.test(str) || PLAYLIST_RE.test(str);
  if (!isResolvable) return null;

  try {
    const { stdout } = await runYtDlp([
      "--dump-single-json",
      "--no-warnings",
      "--skip-download",
      "--playlist-items", "1",
      url,
    ]);

    const meta = JSON.parse(stdout);

    // Prefer uploader_url — it typically contains the @handle (e.g. @AlexHormozi)
    // channel_url often uses the /channel/UC... format which resolves to a raw ID
    if (meta.uploader_url) {
      const resolved = extractHandleFromUrl(meta.uploader_url);
      if (resolved) return resolved;
    }

    // Fallback: channel_url
    if (meta.channel_url) {
      const resolved = extractHandleFromUrl(meta.channel_url);
      if (resolved) return resolved;
    }

    // Fallback: channel ID
    if (meta.channel_id) {
      return meta.channel_id;
    }

    // Last resort: channel name slugified
    if (meta.channel) {
      return `@${meta.channel.toLowerCase().replace(/[^a-z0-9_.-]/g, "")}`;
    }

    return null;
  } catch {
    return null;
  }
}

function normalizeHandle(handle) {
  if (!handle) return null;
  const clean = handle.startsWith("@") ? handle.slice(1) : handle;
  return clean.toLowerCase().replace(/[^a-z0-9_.-]/g, "");
}

export { extractHandleFromUrl, resolveCreator, normalizeHandle };
