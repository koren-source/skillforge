import { callProviderRaw } from "./synthesize.js";
import { readSkill, writeSkill } from "./library.js";
import { slugify } from "./format.js";

function buildMergePrompt(skillA, skillB, topic) {
  return `
You are merging two AI skill documents into one unified, comprehensive skill.
Both skills cover overlapping or complementary knowledge about: ${topic}

Your job is NOT to concatenate — you must RE-SYNTHESIZE into a single coherent document.

Rules:
- Deduplicate frameworks, tactics, and concepts that overlap.
- When two sources disagree, note both perspectives and explain the tension.
- Preserve the strongest quotes, processes, and tactics from each.
- The merged output should feel like ONE authoritative skill, not two glued together.
- Keep the same JSON schema as the inputs.

Return strict JSON only with this exact schema:
{
  "topic": "string",
  "summary": "string",
  "frameworks": [
    { "name": "string", "description": "string", "steps": ["string"], "source_titles": ["string"] }
  ],
  "tactics": [
    { "name": "string", "description": "string", "when_to_use": "string", "source_titles": ["string"] }
  ],
  "quotes": [
    { "quote": "string", "speaker": "string", "context": "string", "source_title": "string" }
  ],
  "concepts": [
    { "term": "string", "definition": "string" }
  ],
  "processes": [
    { "name": "string", "steps": ["string"], "source_titles": ["string"] }
  ],
  "full_notes": ["string"]
}

--- SKILL A ---
${skillA}

--- SKILL B ---
${skillB}
`.trim();
}

async function mergeSkills({ creatorA, topicA, creatorB, topicB, outputCreator, outputTopic, model = "claude-sonnet-4-5" }) {
  const contentA = await readSkill(creatorA, topicA);
  if (!contentA) {
    throw new Error(`Skill not found: ${creatorA}/${topicA}`);
  }

  const contentB = await readSkill(creatorB, topicB);
  if (!contentB) {
    throw new Error(`Skill not found: ${creatorB}/${topicB}`);
  }

  const topic = outputTopic || `${topicA} + ${topicB}`;
  const prompt = buildMergePrompt(contentA, contentB, topic);
  const result = await callProviderRaw(prompt, model);

  const now = new Date().toISOString();
  const merged = {
    topic: result.topic || topic,
    summary: result.summary || "",
    source_count: 2,
    source_titles: [`${creatorA}/${topicA}`, `${creatorB}/${topicB}`],
    source_videos: [],
    generated_at: now,
    built_at: now,
    merged_from: [`${creatorA}/${topicA}`, `${creatorB}/${topicB}`],
    frameworks: Array.isArray(result.frameworks) ? result.frameworks : [],
    tactics: Array.isArray(result.tactics) ? result.tactics : [],
    quotes: Array.isArray(result.quotes) ? result.quotes : [],
    concepts: Array.isArray(result.concepts) ? result.concepts : [],
    processes: Array.isArray(result.processes) ? result.processes : [],
    full_notes: Array.isArray(result.full_notes) ? result.full_notes : [],
  };

  return merged;
}

async function mergeAndSave(options) {
  const { formatDocument } = await import("./format.js");
  const merged = await mergeSkills(options);
  const content = formatDocument("skill", merged);
  const creator = options.outputCreator || "merged";
  const topic = options.outputTopic || `${options.topicA}-${options.topicB}`;
  const dest = await writeSkill(creator, topic, content);
  return { merged, filePath: dest };
}

export { mergeSkills, mergeAndSave, buildMergePrompt };
