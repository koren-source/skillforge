function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function scoreVideo(video, intentTokens) {
  const titleTokens = tokenize(video.title);
  const descTokens = tokenize(video.description || "");
  const allTokens = [...titleTokens, ...descTokens];

  if (intentTokens.length === 0) return 0;

  const tokenSet = new Set(allTokens);
  let matches = 0;
  for (const token of intentTokens) {
    if (tokenSet.has(token)) matches++;
    // partial match — check if any video token contains the intent token
    else if (allTokens.some((t) => t.includes(token) || token.includes(t))) {
      matches += 0.5;
    }
  }

  const overlap = matches / intentTokens.length;

  // Title matches are worth more
  const titleSet = new Set(titleTokens);
  let titleMatches = 0;
  for (const token of intentTokens) {
    if (titleSet.has(token)) titleMatches++;
  }
  const titleBoost = (titleMatches / intentTokens.length) * 20;

  // Duration bonus: prefer videos between 5-30 mins
  let durationBonus = 0;
  const mins = (video.duration || 0) / 60;
  if (mins >= 5 && mins <= 60) durationBonus = 10;
  else if (mins > 60) durationBonus = 5;

  return Math.min(100, Math.round(overlap * 70 + titleBoost + durationBonus));
}

function scoreVideos(videos, intent) {
  const intentTokens = tokenize(intent);

  return videos
    .map((video) => ({
      ...video,
      score: scoreVideo(video, intentTokens),
    }))
    .sort((a, b) => b.score - a.score);
}

export { scoreVideos };
