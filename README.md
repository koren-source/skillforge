[![npm version](https://img.shields.io/npm/v/skillforge.svg)](https://www.npmjs.com/package/skillforge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Built with ❤️ by Cutbox.ai](https://img.shields.io/badge/Built%20with%20%E2%9D%A4%EF%B8%8F%20by-Cutbox.ai-black)](https://cutbox.ai)

# SkillForge

**Give your agent a YouTube video and it will learn a skill.**

SkillForge is an open-source CLI that turns any YouTube video into structured knowledge your AI agent can actually use. Drop in a URL, and SkillForge:

1. **Pulls the transcript** — downloads the full video transcript via `yt-dlp`
2. **Learns from it** — Claude reads the transcript and extracts frameworks, tactics, key quotes, and key numbers
3. **Creates a skill** — saves a clean, structured skill doc to `~/.skillforge/library/@creator/video-title.skill.md`
4. **Organizes by creator** — your agent's knowledge is filed by who taught it, searchable by topic

Your agent can then recall that knowledge instantly:

```bash
skillforge recall --intent "pricing strategy"
# → Returns: Alex Hormozi — The Mathematics of Business (100% relevance)
```

The result isn't a transcript dump. It's operational knowledge — frameworks your agent can reason with, tactics it can apply, and quotes it can cite.

---

## Quick Start

```bash
# Install
npm install -g skillforge

# Install transcript fetcher
brew install yt-dlp  # or: pip install yt-dlp

# Authenticate (one time — uses your Claude Code session, no API key needed)
claude login

# Give your agent a video to learn from
skillforge watch https://youtu.be/A_tx40lNpf8
```

That's it. In ~60 seconds, your agent knows what's in that video.

---

## How It Works

```
YouTube URL
    ↓
yt-dlp downloads transcript
    ↓
Claude reads the full transcript
    ↓
Skill created: frameworks, tactics, quotes, key numbers
    ↓
Organized in ~/.skillforge/library/@creator/topic.skill.md
    ↓
Agent recalls it by intent anytime
```

The skill doc is structured for agents — not humans. It contains what an agent needs to reason, advise, and act: not summaries, but frameworks with steps, tactics with context, numbers with significance.

---

## Commands

### `skillforge watch <url>`
The core command. Give it a single YouTube video URL, get a skill.

```bash
skillforge watch https://youtu.be/A_tx40lNpf8
# → Skill saved to ~/.skillforge/library/@alex-hormozi/the-mathematics-of-business-explained.skill.md
```

### `skillforge recall --intent "topic"`
Search your skill library by what you want to know.

```bash
skillforge recall --intent "pricing"
# → 100%  Alex Hormozi — The Mathematics of Business, Explained
```

### `skillforge list`
See all skills your agent has learned.

```bash
skillforge list
# @alex-hormozi
#   ↳ the-mathematics-of-business-explained  (4 frameworks, built 2026-03-01)
```

### `skillforge build [url]`
Build a skill from a channel, topic, multiple URLs, or a saved proposal.

```bash
# Build from a channel (auto-score top videos by intent)
skillforge build --auto --channel https://youtube.com/@AlexHormozi --intent "pricing"

# Build from specific URLs
skillforge build --urls "https://youtu.be/abc,https://youtu.be/def" --intent "outreach"

# Build from a saved proposal
skillforge build --proposal abc12345
```

### `skillforge scan <url>`
Score all videos from a channel by relevance to an intent and save a proposal for review.

```bash
skillforge scan https://youtube.com/@AlexHormozi --intent "retention"
```

### `skillforge suggest --topic "topic"`
Search YouTube for channels related to a topic.

```bash
skillforge suggest --topic "meta ads scaling"
```

### `skillforge trust add|remove|list`
Manage your trusted creators list.

```bash
skillforge trust add @AlexHormozi
skillforge trust list
skillforge trust remove @AlexHormozi
```

### `skillforge prune --skill <slug>`
Remove a skill from the index.

```bash
skillforge prune --skill cold-email-outreach
```

### `skillforge merge --a <creator/topic> --b <creator/topic>`
Merge two existing skills into one unified, deduplicated skill.

```bash
skillforge merge --a @alex-hormozi/pricing --b @leila-hormozi/pricing --output-creator @hormozi --output-topic pricing
```

### `skillforge serve`
Start the SkillForge MCP server for Claude Code integration (stdio transport).

```bash
skillforge serve
```

### `skillforge check-auth`
Verify your Claude CLI is set up correctly.

```bash
skillforge check-auth --validate
```

---

## Authentication

SkillForge uses your Claude CLI session. No API keys required.

```bash
# 1. Install Claude Code from https://claude.ai/code
# 2. Log in once:
claude login
# 3. Verify:
skillforge check-auth --validate
```

If you prefer to use API keys directly, set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in your environment — SkillForge will use them automatically.

---

## Skill Library Structure

Every skill is stored at:
```
~/.skillforge/library/@creator-handle/video-title.skill.md
```

The folder is the creator. The file is what they taught. Your agent always knows the source.

```
~/.skillforge/library/
  @alex-hormozi/
    the-mathematics-of-business-explained.skill.md
    100m-offers-pricing-framework.skill.md
  @andrew-huberman/
    sleep-optimization-protocols.skill.md
```

---

## Advanced: Build from a Full Channel

Trust a creator, then auto-build skills on any topic:

```bash
# Add a creator to your trusted list
skillforge trust add @AlexHormozi

# Auto-score and build from their best videos on a topic
skillforge build --auto --channel https://youtube.com/@AlexHormozi --intent "retention"
```

SkillForge will score all videos by relevance to your intent, pick the top matches, and synthesize them — no manual selection required.

---

## Requirements

- Node.js 18+
- `yt-dlp` (transcript fetching)
- Claude CLI authenticated via `claude login`

---

## License

MIT — Built with ❤️ by [Cutbox.ai](https://cutbox.ai)
