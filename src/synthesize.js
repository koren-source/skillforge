import process from "node:process";
import Anthropic from "@anthropic-ai/sdk";

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

async function synthesizeKnowledge({ transcripts, topic, model }) {
  if (!Array.isArray(transcripts) || transcripts.length === 0) {
    throw new Error("At least one transcript is required for synthesis.");
  }

  const prompt = buildPrompt({ topic, transcripts });
  const provider = inferProvider(model);

  let result;
  if (provider === "anthropic") {
    result = await synthesizeWithAnthropic(prompt, model);
  } else {
    result = await synthesizeWithOpenAI(prompt, model);
  }

  return normalizeSynthesis(result, transcripts);
}

export {
  synthesizeKnowledge,
};
