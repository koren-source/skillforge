import { runYtDlp } from "./extract.js";

async function searchTopic(topic, limit = 10) {
  const { stdout } = await runYtDlp([
    "--dump-single-json",
    "--flat-playlist",
    `ytsearch${limit}:${topic}`,
    "--no-playlist",
  ]);

  const payload = JSON.parse(stdout);
  const entries = Array.isArray(payload.entries) ? payload.entries : [];

  return entries.map((entry) => ({
    id: entry.id,
    title: entry.title || entry.id,
    url: `https://www.youtube.com/watch?v=${entry.id}`,
  }));
}

export {
  searchTopic,
};
