import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import Anthropic from "@anthropic-ai/sdk";
import * as skillIndex from "./skillIndex.js";
import { slugify } from "./format.js";

const CHECKPOINT_DIR = path.join(os.homedir(), ".skillforge", "checkpoints");

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

const ANTHROPIC_MODEL_PREFIXES = ["claude"];
const OPENAI_MODEL_PREFIXES = ["gpt", "o1", "o3", "o4"];

function chunkText(text, maxLength) {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks = [];
  let cursor = 0;

  while (cursor < text.length) {
    chunks.push(text.slice(cursor, cursor + maxLength));
    cursor += maxLength;
  }

  return chunks;
}

function buildPrompt({ topic, transcripts }) {
  const sources = transcripts
    .map((item, index) => {
      const truncatedTranscript = chunkText(item.transcript, 12000)[0];
      return [
        `Source ${index + 1}`,
        `Title: ${item.title}`,
        `URL: ${item.url}`,
        "Transcript:",
        truncatedTranscript,
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
  "summary": "string",
  "frameworks": [
    {
      "name": "string",
      "description": "string",
      "steps": ["string"],
      "source_titles": ["string"]
    }
  ],
  "tactics": [
    {
      "title": "string",
      "details": "string",
      "when_to_use": "string",
      "source_titles": ["string"]
    }
  ],
  "quotes": [
    {
      "quote": "string",
      "speaker": "string",
      "context": "string",
      "source_title": "string"
    }
  ],
  "concepts": [
    {
      "term": "string",
      "definition": "string"
    }
  ],
  "processes": [
    {
      "name": "string",
      "steps": ["string"],
      "source_titles": ["string"]
    }
  ],
  "full_notes": ["string"]
}

Requirements:
- Focus on practical, actionable insight, not generic summaries.
- Extract up to 10 frameworks or tactics total, prioritizing high utility.
- Quotes must be genuinely memorable and concise.
- Use specific terminology from the material when available.
- If different videos disagree, reflect that in the relevant framework or tactic.

Sources:
${sources}
`.trim();
}

function extractJson(text) {
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

function normalizeSynthesis(result, transcripts) {
  return {
    topic: result.topic || "YouTube Knowledge",
    summary: result.summary || "",
    source_count: transcripts.length,
    source_titles: transcripts.map((item) => item.title),
    generated_at: new Date().toISOString(),
    frameworks: Array.isArray(result.frameworks) ? result.frameworks : [],
    tactics: Array.isArray(result.tactics) ? result.tactics : [],
    quotes: Array.isArray(result.quotes) ? result.quotes : [],
    concepts: Array.isArray(result.concepts) ? result.concepts : [],
    processes: Array.isArray(result.processes) ? result.processes : [],
    full_notes: Array.isArray(result.full_notes) ? result.full_notes : [],
  };
}

function inferProvider(model) {
  const normalized = String(model || "").toLowerCase();

  if (ANTHROPIC_MODEL_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return "anthropic";
  }

  if (OPENAI_MODEL_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return "openai";
  }

  return process.env.ANTHROPIC_API_KEY ? "anthropic" : "openai";
}

async function synthesizeWithAnthropic(prompt, model) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "Missing ANTHROPIC_API_KEY. Add it to your environment or use an OpenAI model with OPENAI_API_KEY."
    );
  }

  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    temperature: 0.2,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  return JSON.parse(extractJson(text));
}

async function synthesizeWithOpenAI(prompt, model) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "Missing OPENAI_API_KEY. Add it to your environment or switch to an Anthropic model with ANTHROPIC_API_KEY."
    );
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "Return valid JSON only.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API request failed: ${response.status} ${errorText}`);
  }

  const payload = await response.json();
  const text = payload.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("OpenAI API returned an empty response.");
  }

  return JSON.parse(extractJson(text));
}

async function callProvider(prompt, model) {
  const provider = inferProvider(model);
  if (provider === "anthropic") {
    return synthesizeWithAnthropic(prompt, model);
  }
  return synthesizeWithOpenAI(prompt, model);
}

async function synthesizeKnowledge({ transcripts, topic, model, intent, outputPath }) {
  if (!Array.isArray(transcripts) || transcripts.length === 0) {
    throw new Error("At least one transcript is required for synthesis.");
  }

  const slug = slugify(topic || "skillforge");

  // Check for checkpoint
  const checkpoint = await loadCheckpoint(slug);
  if (checkpoint?.result) {
    await removeCheckpoint(slug);
    const normalized = normalizeSynthesis(checkpoint.result, transcripts);
    // Save to skill index
    if (intent) {
      await skillIndex.add({
        name: normalized.topic,
        slug,
        domain: normalized.topic,
        tags: normalized.frameworks.map((f) => f.name).slice(0, 5),
        frameworks: normalized.frameworks.map((f) => f.name),
        intent,
        filePath: outputPath || "",
        createdAt: normalized.generated_at,
      });
    }
    return normalized;
  }

  // Check if transcript is too long — chunk and summarize
  const combined = transcripts.map((t) => t.transcript).join("\n");
  const CHUNK_LIMIT = 80000;

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

    // If it's a single huge transcript, split it into text chunks
    if (chunks.length === 1 && chunks[0].length === 1) {
      const bigTranscript = chunks[0][0];
      const textChunks = chunkText(bigTranscript.transcript, CHUNK_LIMIT);
      const summaries = [];

      for (let i = 0; i < textChunks.length; i++) {
        const chunkTranscripts = [
          { ...bigTranscript, transcript: textChunks[i] },
        ];
        const prompt = buildPrompt({ topic, transcripts: chunkTranscripts });
        const chunkResult = await callProvider(prompt, model);
        summaries.push(chunkResult);
        await saveCheckpoint(slug, { phase: "chunk", index: i, partial: summaries });
      }

      // Merge summaries into one synthesis
      const mergedTranscripts = summaries.map((s, i) => ({
        title: `Chunk ${i + 1} summary`,
        url: transcripts[0].url,
        transcript: JSON.stringify(s),
      }));
      const mergePrompt = buildPrompt({ topic, transcripts: mergedTranscripts });
      result = await callProvider(mergePrompt, model);
    } else {
      // Multiple chunks of transcripts
      const summaries = [];
      for (let i = 0; i < chunks.length; i++) {
        const prompt = buildPrompt({ topic, transcripts: chunks[i] });
        const chunkResult = await callProvider(prompt, model);
        summaries.push(chunkResult);
        await saveCheckpoint(slug, { phase: "chunk", index: i, partial: summaries });
      }

      const mergedTranscripts = summaries.map((s, i) => ({
        title: `Batch ${i + 1} summary`,
        url: chunks[i][0].url,
        transcript: JSON.stringify(s),
      }));
      const mergePrompt = buildPrompt({ topic, transcripts: mergedTranscripts });
      result = await callProvider(mergePrompt, model);
    }
  } else {
    const prompt = buildPrompt({ topic, transcripts });
    result = await callProvider(prompt, model);
  }

  // Save checkpoint before normalization
  await saveCheckpoint(slug, { result });

  const normalized = normalizeSynthesis(result, transcripts);

  // Save to skill index if intent was provided
  if (intent) {
    await skillIndex.add({
      name: normalized.topic,
      slug,
      domain: normalized.topic,
      tags: normalized.frameworks.map((f) => f.name).slice(0, 5),
      frameworks: normalized.frameworks.map((f) => f.name),
      intent,
      filePath: outputPath || "",
      createdAt: normalized.generated_at,
    });
  }

  // Clean up checkpoint on success
  await removeCheckpoint(slug);

  return normalized;
}

export {
  synthesizeKnowledge,
};
