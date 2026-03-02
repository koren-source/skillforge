import fs from "node:fs/promises";
import { writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import * as skillIndex from "./skillIndex.js";
import { slugify, slugifyCreator } from "./format.js";

const CHECKPOINT_DIR = path.join(os.homedir(), ".skillforge", "checkpoints");
const DEFAULT_MODEL = "claude-sonnet-4-20250514";

async function ensureCheckpointDir() {
  await fs.mkdir(CHECKPOINT_DIR, { recursive: true });
}

async function loadCheckpoint(slug) {
  try {
    const data = await fs.readFile(
      path.join(CHECKPOINT_DIR, `${slug}.json`),
      "utf8"
    );
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function saveCheckpoint(slug, data) {
  await ensureCheckpointDir();
  await fs.writeFile(
    path.join(CHECKPOINT_DIR, `${slug}.json`),
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

async function removeCheckpoint(slug) {
  try {
    await fs.unlink(path.join(CHECKPOINT_DIR, `${slug}.json`));
  } catch {
    // ignore
  }
}

/**
 * Strip ANSI escape codes from CLI output
 */
function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
}

/**
 * Call Claude CLI in non-interactive mode
 * Uses the user's existing claude CLI authentication (no API keys needed)
 */
function callClaudeCli(prompt, model = DEFAULT_MODEL) {
  // Write prompt to temp file and pipe via bash.
  // We use --system-prompt to override any global ~/.claude/CLAUDE.md context files
  // that might cause the CLI to respond with persona text instead of the requested JSON.
  const SYSTEM_PROMPT =
    "You are a knowledge extraction engine. Output only what is explicitly requested. " +
    "No explanations, no persona, no preamble.";

  const tmpFile = path.join(os.tmpdir(), "skillforge-prompt-" + Date.now() + ".txt");
  writeFileSync(tmpFile, prompt);

  const cmd = [
    "cat",
    JSON.stringify(tmpFile),
    "| claude -p",
    "--model", JSON.stringify(model),
    "--system-prompt", JSON.stringify(SYSTEM_PROMPT),
  ].join(" ");

  const result = spawnSync("bash", ["-c", cmd], {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    timeout: 5 * 60 * 1000,
  });

  try { unlinkSync(tmpFile); } catch (_) {}

  if (result.error) {
    if (result.error.code === "ENOENT") {
      throw new Error(
        "SkillForge requires the Claude CLI.\n\n" +
        "Install from https://claude.ai/code then run:\n" +
        "  claude login"
      );
    }
    throw new Error(`Claude CLI error: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const stderr = stripAnsi(result.stderr || "").trim();
    throw new Error(`Claude CLI failed (exit ${result.status}): ${stderr || "Unknown error"}`);
  }

  return stripAnsi(result.stdout || "").trim();
}

function chunkText(text, maxLength, overlap = 0) {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks = [];
  let cursor = 0;
  const step = Math.max(1, maxLength - overlap);

  while (cursor < text.length) {
    chunks.push(text.slice(cursor, cursor + maxLength));
    cursor += step;
  }

  return chunks;
}

function buildPrompt({ topic, transcripts }) {
  const sources = transcripts
    .map((item, index) => {
      return [
        `Source ${index + 1}`,
        `Title: ${item.title}`,
        `URL: ${item.url}`,
        "Transcript:",
        item.transcript,
      ].join("\n");
    })
    .join("\n\n---\n\n");

  return `
You are extracting high-signal operational knowledge from YouTube transcripts.

Topic: ${topic}
Video count: ${transcripts.length}

Return strict JSON only with this exact schema:
{
  "topic": "string",
  "summary": "2-3 sentence summary of what this video teaches",
  "frameworks": [{"name": "string", "description": "string", "steps": ["string"]}],
  "tactics": [{"name": "string", "description": "string", "when_to_use": "string"}],
  "key_quotes": [{"quote": "string", "context": "string"}],
  "key_numbers": [{"stat": "string", "significance": "string"}],
  "agent_guidance": "How an AI agent should use this knowledge"
}

Requirements:
- Focus on practical, actionable insight, not generic summaries.
- Extract specific numbers, stats, ratios, and metrics into key_numbers.
- Frameworks should be step-by-step processes the speaker teaches.
- Tactics should be specific techniques with clear application context.
- Quotes must be genuinely memorable and concise.
- agent_guidance should explain how an AI agent should apply this knowledge when helping users.

Sources:
${sources}
`.trim();
}



function buildChunkExtractionPrompt(chunkText, topic, chunkIndex, totalChunks) {
  return `
You are extracting key insights from part ${chunkIndex + 1} of ${totalChunks} of a YouTube transcript.

Topic: ${topic}
Chunk: ${chunkIndex + 1}/${totalChunks}

Return strict JSON only:
{
  "frameworks": [{"name": "string", "description": "string", "steps": ["string"]}],
  "tactics": [{"name": "string", "description": "string", "when_to_use": "string"}],
  "key_quotes": [{"quote": "string", "context": "string"}],
  "key_numbers": [{"stat": "string", "significance": "string"}]
}

Rules:
- Only extract content that appears in THIS chunk. Do not infer from prior context.
- Skip generic statements. Only include specific, actionable frameworks or memorable quotes.
- Frameworks must have at least 2 clear steps.
- Numbers must be specific (percentages, dollar amounts, ratios, timeframes).
- Return empty arrays if nothing qualifies — do not fabricate.

Transcript chunk:
${chunkText}
`.trim();
}

function buildCompilationPrompt(topic, videoTitle, chunkExtractions) {
  const extractionSummary = chunkExtractions.map((e, i) =>
    `Chunk ${i + 1}:\n${JSON.stringify(e, null, 2)}`
  ).join("\n\n---\n\n");

  return `
You are compiling a final skill document from extractions across ${chunkExtractions.length} chunks of a YouTube video.

Video: ${videoTitle}
Topic: ${topic}

Combine and deduplicate the extractions below into a single high-quality skill document.

Return strict JSON only with this exact schema:
{
  "topic": "string",
  "summary": "2-3 sentence summary of what this video teaches",
  "frameworks": [{"name": "string", "description": "string", "steps": ["string"]}],
  "tactics": [{"name": "string", "description": "string", "when_to_use": "string"}],
  "key_quotes": [{"quote": "string", "context": "string"}],
  "key_numbers": [{"stat": "string", "significance": "string"}],
  "agent_guidance": "How an AI agent should use this knowledge when helping users"
}

Rules:
- Merge duplicate frameworks (same concept, different wording) into the best version.
- Keep the top 5 frameworks, top 6 tactics, top 5 quotes, top 6 numbers.
- Prioritize specific, actionable, and memorable content.
- Write agent_guidance as a practical guide for an AI agent applying this knowledge.

Chunk extractions:
${extractionSummary}
`.trim();
}


function extractJson(text) {
  text = stripAnsi(text);
  const fencedMatch = text.match(/```json\s*([\s\S]*?)```/i);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("Model response did not contain valid JSON.");
  }

  return text.slice(firstBrace, lastBrace + 1);
}

function normalizeSynthesis(result, transcripts, creatorMeta, model) {
  const now = new Date().toISOString();
  const topicSlug = slugify(result.topic || "youtube-knowledge");
  const normalized = {
    topic: result.topic || "YouTube Knowledge",
    topic_slug: topicSlug,
    summary: result.summary || "",
    source_count: transcripts.length,
    source_titles: transcripts.map((item) => item.title),
    source_videos: transcripts.map((item) => ({
      url: item.url,
      date: now,
    })).filter((sv) => sv.url),
    generated_at: now,
    built_at: now,
    last_updated: now,
    model: model || DEFAULT_MODEL,
    frameworks: Array.isArray(result.frameworks) ? result.frameworks : [],
    tactics: Array.isArray(result.tactics) ? result.tactics : [],
    key_quotes: Array.isArray(result.key_quotes) ? result.key_quotes : [],
    key_numbers: Array.isArray(result.key_numbers) ? result.key_numbers : [],
    agent_guidance: result.agent_guidance || "",
  };

  if (creatorMeta?.creator) {
    normalized.creator = creatorMeta.creator;
    normalized.creator_slug = creatorMeta.creatorSlug || slugifyCreator(creatorMeta.creator);
  }

  return normalized;
}

/**
 * Call Claude CLI and parse JSON response
 */
async function callProvider(prompt, model = DEFAULT_MODEL) {
  const output = callClaudeCli(prompt, model);
  return JSON.parse(extractJson(output));
}

/**
 * Call Claude CLI (alias for backward compatibility)
 */
async function callProviderRaw(prompt, model = DEFAULT_MODEL) {
  return callProvider(prompt, model);
}

async function synthesizeKnowledge({ transcripts, topic, model, intent, outputPath, creatorMeta }) {
  if (!Array.isArray(transcripts) || transcripts.length === 0) {
    throw new Error("At least one transcript is required for synthesis.");
  }

  const effectiveModel = model || DEFAULT_MODEL;
  const slug = slugify(topic || "skillforge");

  // Check for checkpoint
  const checkpoint = await loadCheckpoint(slug);
  if (checkpoint?.result) {
    console.log("[SkillForge] Resuming from checkpoint:", slug, "(step:", checkpoint.step || "synthesize", ")");
    await removeCheckpoint(slug);
    const normalized = normalizeSynthesis(checkpoint.result, transcripts, creatorMeta, effectiveModel);
    // Save to skill index
    if (intent) {
      const indexEntry = {
        name: normalized.topic,
        slug,
        domain: normalized.topic,
        tags: normalized.frameworks.map((f) => f.name).slice(0, 5),
        frameworks: normalized.frameworks.map((f) => f.name),
        intent,
        filePath: outputPath || "",
        createdAt: normalized.generated_at,
        builtAt: normalized.built_at,
      };
      if (creatorMeta?.creator) {
        indexEntry.creator = creatorMeta.creator;
        indexEntry.creatorSlug = creatorMeta.creatorSlug;
        indexEntry.compositeSlug = `${creatorMeta.creatorSlug}/${slug}`;
        indexEntry.sourceVideos = normalized.source_videos;
      }
      await skillIndex.add(indexEntry);
    }
    return normalized;
  }

  // Check if transcript is too long — chunk and synthesize each, then merge
  const combined = transcripts.map((t) => t.transcript).join("\n");
  const CHUNK_LIMIT = 25000;
  const CHUNK_OVERLAP = 2000;

  let result;
  if (combined.length > CHUNK_LIMIT) {
    // Split transcripts into chunks and summarize each
    const chunks = [];
    let currentChunk = [];
    let currentLen = 0;

    for (const t of transcripts) {
      if (currentLen + t.transcript.length > CHUNK_LIMIT && currentChunk.length > 0) {
        chunks.push([...currentChunk]);
        currentChunk = [];
        currentLen = 0;
      }
      currentChunk.push(t);
      currentLen += t.transcript.length;
    }
    if (currentChunk.length > 0) chunks.push(currentChunk);

    // If it's a single huge transcript, sample strategically for very long videos
    if (chunks.length === 1 && chunks[0].length === 1) {
      const bigTranscript = chunks[0][0];
      const fullText = bigTranscript.transcript;
      const totalLen = fullText.length;

      // True sequential chunking: extract from every chunk, then compile
      const textChunks = chunkText(fullText, CHUNK_LIMIT, CHUNK_OVERLAP);
      const chunkExtractions = [];
      for (let i = 0; i < textChunks.length; i++) {
        const chunkPrompt = buildChunkExtractionPrompt(textChunks[i], topic, i, textChunks.length);
        const raw = callClaudeCli(chunkPrompt, effectiveModel);
        try {
          const parsed = JSON.parse(extractJson(raw));
          chunkExtractions.push(parsed);
        } catch (_) {
          // Skip chunks that fail to parse — don't let one bad chunk kill the whole video
        }
        await saveCheckpoint(slug, { phase: "chunk", index: i, count: textChunks.length });
      }

      // Final compilation pass — merge all chunk extractions into one skill
      const compilationPrompt = buildCompilationPrompt(topic, transcripts[0].title, chunkExtractions);
      result = await callProvider(compilationPrompt, effectiveModel);
    } else {
      // Multiple chunks of transcripts
      const summaries = [];
      for (let i = 0; i < chunks.length; i++) {
        const prompt = buildPrompt({ topic, transcripts: chunks[i] });
        const chunkResult = await callProvider(prompt, effectiveModel);
        summaries.push(chunkResult);
        await saveCheckpoint(slug, { phase: "chunk", index: i, partial: summaries });
      }

      const mergedTranscripts = summaries.map((s, i) => ({
        title: `Batch ${i + 1} summary`,
        url: chunks[i][0].url,
        transcript: JSON.stringify(s),
      }));
      const mergePrompt = buildPrompt({ topic, transcripts: mergedTranscripts });
      result = await callProvider(mergePrompt, effectiveModel);
    }
  } else {
    const prompt = buildPrompt({ topic, transcripts });
    result = await callProvider(prompt, effectiveModel);
  }

  // Save checkpoint before normalization
  await saveCheckpoint(slug, { result });

  const normalized = normalizeSynthesis(result, transcripts, creatorMeta, effectiveModel);

  // Save to skill index if intent was provided
  if (intent) {
    const indexEntry = {
      name: normalized.topic,
      slug,
      domain: normalized.topic,
      tags: normalized.frameworks.map((f) => f.name).slice(0, 5),
      frameworks: normalized.frameworks.map((f) => f.name),
      intent,
      filePath: outputPath || "",
      createdAt: normalized.generated_at,
    };
    if (creatorMeta?.creator) {
      indexEntry.creator = creatorMeta.creator;
      indexEntry.creatorSlug = creatorMeta.creatorSlug;
      indexEntry.compositeSlug = `${creatorMeta.creatorSlug}/${slug}`;
      indexEntry.sourceVideos = normalized.source_videos;
    }
    await skillIndex.add(indexEntry);
  }

  // Clean up checkpoint on success
  await removeCheckpoint(slug);

  return normalized;
}

async function previewTranscript({ transcript, topic, model = DEFAULT_MODEL }) {
  const truncated = chunkText(transcript, 12000)[0];
  const prompt = `
You are previewing a YouTube video transcript to help a user decide if it's worth extracting into an agent skill.

Topic hint: ${topic || "none provided"}

Return strict JSON only with this exact schema:
{
  "bullets": ["string"]
}

Requirements:
- Provide 3-5 bullet points.
- Each bullet should be one concise sentence.
- Cover: what the video is about, key takeaways, and what an AI agent would learn from it.
- Be specific — reference actual concepts, frameworks, or tactics mentioned.
- If the content is low-quality or off-topic, say so honestly.

Transcript:
${truncated}
`.trim();

  const result = await callProvider(prompt, model);
  return { bullets: Array.isArray(result.bullets) ? result.bullets : [] };
}

export {
  synthesizeKnowledge,
  previewTranscript,
  callProviderRaw,
};
