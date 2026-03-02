[![npm version](https://img.shields.io/npm/v/skillforge.svg)](https://www.npmjs.com/package/skillforge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Built with ❤️ by Cutbox.ai](https://img.shields.io/badge/Built%20with%20%E2%9D%A4%EF%B8%8F%20by-Cutbox.ai-black)](https://cutbox.ai)

# SkillForge

*What if your AI agent could watch YouTube and learn new skills?*

SkillForge is an open-source Node.js CLI that turns YouTube videos, channels, playlists, and search topics into structured knowledge files for AI agents. It pulls transcripts with `yt-dlp`, synthesizes the material with your own LLM API keys, and exports the result as an agent-ready `SKILL.md`, a clean Markdown brief, or structured JSON. The project is built so any agent or human can bring their own keys and generate reusable skills from public video knowledge.

> Run `skillforge build --topic "meta ads"` and a `SKILL.md` appears in `./output/` in under a minute.

## What It Does

Give SkillForge a single video, a full channel, a set of URLs, or a topic like `"meta ads"` or `"cold email"`. It collects transcript data, filters out missing subtitle sources, extracts the highest-signal frameworks and tactics, and outputs an artifact you can feed directly into an agent workflow.

The result is not a transcript dump. SkillForge is designed to produce operational knowledge:

- action-oriented frameworks
- step-by-step processes
- key quotes with context
- concepts and definitions
- portable skill files for reuse

## Quick Start

Zero-install run:

```bash
npx skillforge build --topic "meta ads"
```

This searches YouTube, processes up to 10 relevant videos by default, and writes a generated skill file into `./output/`.

## Installation

```bash
npm install -g skillforge
```

You also need:

- `yt-dlp` installed and available on your `PATH`
- Claude CLI installed and authenticated

## Setup

SkillForge uses your Claude CLI authentication. No API keys required.

```bash
# 1. Install Claude Code from https://claude.ai/code
# 2. Authenticate once:
claude login

# 3. Verify setup:
skillforge check-auth --validate
```

That's it. SkillForge will use your Claude CLI session for all AI synthesis.

## Usage

### Single video

```bash
skillforge build "https://www.youtube.com/watch?v=VIDEO_ID"
```

### Full channel

```bash
skillforge build --channel "https://www.youtube.com/@channelname/videos" --limit 15
```

### Search by topic

```bash
skillforge build --topic "cold email"
```

### Multiple specific URLs

```bash
skillforge build --urls "https://youtu.be/a1,https://youtu.be/b2,https://youtu.be/c3"
```

### Auto mode (skip proposal review)

Skip the proposal step entirely and go straight from transcript to synthesis:

```bash
skillforge build --topic "meta ads" --auto
```

Prints a warning (`Auto mode: skipping proposal review`) and builds immediately.

### Multi-channel build

Fetch transcripts from multiple channels and merge into one SKILL.md with deduped frameworks and a Sources section listing all channels:

```bash
skillforge build --channels "https://www.youtube.com/@channel1/videos,https://www.youtube.com/@channel2/videos" --intent "meta ads" --limit 5
```

### Check if a skill exists

Quickly check whether a skill already exists in your library for a given intent:

```bash
skillforge check --intent "meta ads"
```

If matches are found, prints them with relevance percentages and exits 0. If none exist, suggests running `skillforge scan` and exits 1.

### Suggest channels for a topic

Search YouTube for channels related to a topic and get ranked suggestions:

```bash
skillforge suggest --topic "cold email"
```

Outputs the top 5 channel suggestions sorted by relevance, then suggests a `skillforge scan` command for the top channel.

### Output formats

```bash
skillforge build --topic "meta ads" --format skill
skillforge build --topic "meta ads" --format markdown
skillforge build --topic "meta ads" --format json
```

### Custom output directory and model

```bash
skillforge build --topic "yc fundraising" --output ./generated --model claude-sonnet-4-20250514
```

### CLI help

```bash
skillforge --help
skillforge check --help
skillforge suggest --help
skillforge build --help
```

## JavaScript API

SkillForge exports a programmatic API for use in your own Node.js scripts and agent pipelines:

```js
import { recall, build, check } from "skillforge";

// Check if a skill exists
const { found, results } = await check("meta ads");

// Search existing skills by intent
const skills = await recall("cold email outreach");

// Build a new skill programmatically
const result = await build({
  topic: "meta ads",
  intent: "meta ads strategy",
  auto: true,
  model: "claude-sonnet-4-20250514",
  output: "./output",
});
console.log(result.filePath, result.transcriptCount);
```

The `build()` function accepts all the same options as the CLI: `channel`, `channels`, `topic`, `urls`, `intent`, `auto`, `model`, `output`, `format`, and `limit`.

## Freshness Metadata

Every generated SKILL.md now includes freshness metadata in its YAML frontmatter:

```yaml
---
name: "Meta Ads"
description: "Synthesized YouTube knowledge about meta ads."
usage: "Load this skill when working on meta ads strategy, execution, or review tasks."
built_at: "2026-03-01T12:00:00.000Z"
source_videos:
  - "https://www.youtube.com/watch?v=abc123"
  - "https://www.youtube.com/watch?v=def456"
---
```

- `built_at`: ISO 8601 timestamp of when the skill was generated
- `source_videos`: Array of YouTube URLs used to build the skill
- Multi-channel builds also include a `sources` list of channel URLs

The `built_at` timestamp is also stored in the skill index for freshness queries.

## Output Formats

SkillForge supports three export targets:

- `skill` for agent-ready `SKILL.md` documents with frontmatter
- `markdown` for human-readable synthesis docs
- `json` for structured downstream processing

Example snippet from `skill` output:

```md
---
name: Cold Email Outreach
description: Synthesized YouTube knowledge about cold email outreach.
usage: Load this skill when working on cold email outreach strategy, execution, or review tasks.
built_at: "2026-03-01T12:00:00.000Z"
source_videos:
  - "https://www.youtube.com/watch?v=abc123"
---

# AI-Synthesized Knowledge: Cold Email Outreach
> Generated by SkillForge from 8 YouTube videos on March 1, 2026

## Frameworks

## The 4-Part Cold Email Structure
```

Full example: [examples/output-sample.md](/Users/q/Projects/skillforge/examples/output-sample.md)

## Community Skills

The starter skill library lives in [skills/](/Users/q/Projects/skillforge/skills/README.md).

Included examples:

- [skills/meta-ads/SKILL.md](/Users/q/Projects/skillforge/skills/meta-ads/SKILL.md)
- [skills/yc-fundraising/SKILL.md](/Users/q/Projects/skillforge/skills/yc-fundraising/SKILL.md)

To contribute a community skill:

1. Create a folder inside `skills/`
2. Add a high-signal `SKILL.md`
3. Submit a pull request with the source context or rationale

## Troubleshooting

### Authentication Errors

If you see authentication errors, run:

```bash
skillforge check-auth --validate
```

Common issues:
- **Claude CLI not installed**: Install from https://claude.ai/code
- **Not logged in**: Run `claude login` to authenticate
- **Rate limited**: Wait a few minutes and try again

### yt-dlp Issues

If transcripts fail to download:
- Ensure `yt-dlp` is installed: `brew install yt-dlp` or `pip install yt-dlp`
- Update to latest: `yt-dlp -U`
- Some videos don't have subtitles available

## Built By

Built by [Koren Saida](https://github.com/koren-source) at [Cutbox.ai](https://cutbox.ai) — the AI-powered creative ops platform.

## Contributing

Contributions are welcome across extraction quality, synthesis prompts, formatter improvements, and community skills.

Typical contribution flow:

1. Fork the repo
2. Create a branch
3. Make the change
4. Add or improve a skill under `skills/` when relevant
5. Open a pull request with clear before/after behavior

If you are contributing a new skill, optimize for practical value over breadth. The best community skills are opinionated, specific, and immediately usable.

## License

MIT
