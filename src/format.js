function slugify(input) {
  return String(input || "skillforge")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function slugifyCreator(name) {
  if (!name) return "@unknown";
  const slug = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `@${slug || "unknown"}`;
}

function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatSkill(data) {
  const summary = data.summary || `Synthesized YouTube knowledge about ${data.topic}.`;

  const sourceTitle = data.source_titles?.[0] || "YouTube Video";
  const creatorPart = data.creator ? `${data.creator} — ` : "";
  const datePart = formatDate(data.built_at || data.generated_at);
  const modelPart = data.model || "claude-sonnet-4-20250514";

  const frameworks = data.frameworks
    .map((framework) => {
      const parts = [`### ${framework.name}`, framework.description];
      if (framework.steps?.length) {
        parts.push(framework.steps.map((step, i) => `${i + 1}. ${step}`).join("\n"));
      }
      return parts.join("\n\n");
    })
    .join("\n\n");

  const tactics = data.tactics
    .map((tactic) => {
      const name = tactic.name || tactic.title;
      const desc = tactic.description || tactic.details;
      const parts = [`### ${name}`, desc];
      if (tactic.when_to_use) {
        parts.push(`**When to use:** ${tactic.when_to_use}`);
      }
      return parts.join("\n\n");
    })
    .join("\n\n");

  const keyNumbers = (data.key_numbers || [])
    .map((kn) => `- **${kn.stat}**: ${kn.significance}`)
    .join("\n");

  const keyQuotes = (data.key_quotes || [])
    .map((kq) => `> "${kq.quote}"\n> — ${kq.context}`)
    .join("\n\n");

  const agentGuidance = data.agent_guidance || "";

  // Frontmatter for machine-readability
  const frontmatter = [
    `---`,
    `name: "${data.topic}"`,
    `built_at: "${data.built_at || data.generated_at}"`,
    `model: "${modelPart}"`,
  ];
  if (data.creator) {
    frontmatter.push(`creator: "${data.creator}"`);
    frontmatter.push(`creator_slug: "${data.creator_slug || slugifyCreator(data.creator)}"`);
  }
  if (data.topic_slug) {
    frontmatter.push(`topic: "${data.topic_slug}"`);
  }
  if (data.last_updated) {
    frontmatter.push(`last_updated: "${data.last_updated}"`);
  }
  if (data.source_videos?.length) {
    frontmatter.push(`source_videos:`);
    for (const sv of data.source_videos) {
      if (typeof sv === "object" && sv.url) {
        frontmatter.push(`  - url: "${sv.url}"`);
        if (sv.date) frontmatter.push(`    date: "${sv.date}"`);
      } else {
        frontmatter.push(`  - url: "${sv}"`);
      }
    }
  }
  if (data.sources?.length) {
    frontmatter.push(`sources:`);
    for (const src of data.sources) {
      frontmatter.push(`  - "${src}"`);
    }
  }
  if (data.merged_from_channels?.length) {
    frontmatter.push(`merged_from_channels:`);
    for (const ch of data.merged_from_channels) {
      frontmatter.push(`  - "${ch}"`);
    }
  }
  frontmatter.push(`---`);

  const sections = [
    frontmatter.join("\n"),
    `# ${data.topic}\n\n> ${summary}`,
    `**Source:** ${creatorPart}${sourceTitle}  \n**Built:** ${datePart} | **Model:** ${modelPart}`,
    `---`,
  ];

  if (frameworks) {
    sections.push(`## Frameworks\n\n${frameworks}`);
  }

  if (tactics) {
    sections.push(`## Tactics\n\n${tactics}`);
  }

  if (keyNumbers) {
    sections.push(`## Key Numbers\n\n${keyNumbers}`);
  }

  if (keyQuotes) {
    sections.push(`## Key Quotes\n\n${keyQuotes}`);
  }

  if (agentGuidance) {
    sections.push(`## For Your Agent\n\n${agentGuidance}`);
  }

  return sections.join("\n\n") + "\n";
}

function formatMarkdown(data) {
  const summary = data.summary || `Synthesized YouTube knowledge about ${data.topic}.`;

  const frameworks = data.frameworks
    .map((framework) =>
      [
        `### ${framework.name}`,
        framework.description,
        framework.steps?.length
          ? framework.steps.map((step, i) => `${i + 1}. ${step}`).join("\n")
          : null,
      ]
        .filter(Boolean)
        .join("\n\n")
    )
    .join("\n\n");

  const tactics = data.tactics
    .map((tactic) => {
      const name = tactic.name || tactic.title;
      const desc = tactic.description || tactic.details;
      return [`### ${name}`, desc, tactic.when_to_use ? `**When to use:** ${tactic.when_to_use}` : null]
        .filter(Boolean)
        .join("\n\n");
    })
    .join("\n\n");

  const keyNumbers = (data.key_numbers || [])
    .map((kn) => `- **${kn.stat}**: ${kn.significance}`)
    .join("\n");

  const keyQuotes = (data.key_quotes || [])
    .map((kq) => `> "${kq.quote}"\n> — ${kq.context}`)
    .join("\n\n");

  const sections = [
    `# ${data.topic}\n\n> ${summary}`,
  ];

  if (frameworks) sections.push(`## Frameworks\n\n${frameworks}`);
  if (tactics) sections.push(`## Tactics\n\n${tactics}`);
  if (keyNumbers) sections.push(`## Key Numbers\n\n${keyNumbers}`);
  if (keyQuotes) sections.push(`## Key Quotes\n\n${keyQuotes}`);
  if (data.agent_guidance) sections.push(`## For Your Agent\n\n${data.agent_guidance}`);

  return sections.join("\n\n") + "\n";
}

function formatJson(data) {
  return JSON.stringify(
    {
      topic: data.topic,
      summary: data.summary,
      source_count: data.source_count,
      frameworks: data.frameworks,
      tactics: data.tactics,
      key_quotes: data.key_quotes,
      key_numbers: data.key_numbers,
      agent_guidance: data.agent_guidance,
    },
    null,
    2
  );
}

function formatDocument(format, data) {
  if (format === "skill") {
    return formatSkill(data);
  }

  if (format === "markdown") {
    return formatMarkdown(data);
  }

  if (format === "json") {
    return formatJson(data);
  }

  throw new Error(`Unsupported format: ${format}`);
}

function makeOutputFilename(format, topicSlug) {
  if (format === "skill") {
    return pathJoinSafe(topicSlug, "SKILL.md");
  }

  if (format === "markdown") {
    return `${topicSlug}.md`;
  }

  if (format === "json") {
    return `${topicSlug}.json`;
  }

  throw new Error(`Unsupported format: ${format}`);
}

function pathJoinSafe(...parts) {
  return parts.join("/");
}

export {
  formatDocument,
  makeOutputFilename,
  slugify,
  slugifyCreator,
};
