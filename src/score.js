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
  const hasTranscript = !!(video.transcript || video.transcriptText);

  if (intentTokens.length === 0) return { score: 0, hasTranscript };

  const tokenSet = new Set(allTokens);
  let matches = 0;
  for (const token of intentTokens) {
    if (tokenSet.has(token)) matches++;
    else if (allTokens.some((t) => t.includes(token) || token.includes(t))) {
      matches += 0.5;
    }
  }

  const titleDescOverlap = matches / intentTokens.length;

  // Transcript scoring (30% weight when available)
  let transcriptOverlap = 0;
  if (hasTranscript) {
    const transcriptTokens = tokenize(video.transcript || video.transcriptText);
    const transcriptSet = new Set(transcriptTokens);
    let tMatches = 0;
    for (const token of intentTokens) {
      if (transcriptSet.has(token)) tMatches++;
      else if (transcriptTokens.some((t) => t.includes(token) || token.includes(t))) {
        tMatches += 0.5;
      }
    }
    transcriptOverlap = tMatches / intentTokens.length;
  }

  const baseWeight = hasTranscript ? 0.7 : 1.0;
  const transcriptWeight = hasTranscript ? 0.3 : 0;
  const overlap = titleDescOverlap * baseWeight + transcriptOverlap * transcriptWeight;

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

  return {
    score: Math.min(100, Math.round(overlap * 70 + titleBoost + durationBonus)),
    hasTranscript,
  };
}

function scoreVideos(videos, intent) {
  const intentTokens = tokenize(intent);

  return videos
    .map((video) => {
      const { score, hasTranscript } = scoreVideo(video, intentTokens);
      return { ...video, score, hasTranscript };
    })
    .sort((a, b) => b.score - a.score);
}

export { scoreVideos };
