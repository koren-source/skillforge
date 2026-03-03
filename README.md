[![npm version](https://img.shields.io/npm/v/skillforge.svg)](https://www.npmjs.com/package/skillforge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Built with ❤️ by Cutbox.ai](https://img.shields.io/badge/Built%20with%20%E2%9D%A4%EF%B8%8F%20by-Cutbox.ai-black)](https://cutbox.ai)

# SkillForge

**Give your agent a YouTube video and it will learn a skill.**

SkillForge is an open-source, agent-agnostic CLI that turns any YouTube video into structured knowledge your AI agent can actually use. Drop in a URL, and SkillForge:

1. **Pulls the transcript** — downloads the full video transcript via `yt-dlp`
2. **Learns from it** — your configured AI provider reads the transcript and extracts frameworks, tactics, key quotes, and key numbers
3. **Creates a skill** — saves a structured skill folder to `~/.skillforge/library/@creator/topic/SKILL.md`
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

# Configure your AI provider (pick one)
export SKILLFORGE_PROVIDER=claude-cli   # default — uses your Claude Code session
# or: export SKILLFORGE_PROVIDER=anthropic && export ANTHROPIC_API_KEY=sk-...
# or: export SKILLFORGE_PROVIDER=openai && export OPENAI_API_KEY=sk-...

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
AI provider reads the full transcript
    ↓
Skill created: frameworks, tactics, quotes, key numbers
    ↓
Organized in ~/.skillforge/library/@creator/topic/SKILL.md
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
# → Skill saved to ~/.skillforge/library/@alex-hormozi/the-mathematics-of-business-explained/SKILL.md
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

### `skillforge share <skill>`
Share a skill with attribution. Copies the skill to an output folder with "Skill by [GitHub username], sourced from [Creator]" attribution.

```bash
# Share to a folder
skillforge share cold-email-outreach -o ./shared

# Print to stdout (for piping)
skillforge share @alex-hormozi/pricing --stdout
```

### `skillforge serve`
Start the SkillForge MCP server for agent integration (stdio transport).

```bash
skillforge serve
```

### `skillforge check-auth`
Verify your configured provider is set up correctly.

```bash
skillforge check-auth --validate
```

---

## Authentication

SkillForge supports three AI providers. Set `SKILLFORGE_PROVIDER` to choose:

| Provider | Env Var | How It Works |
|----------|---------|-------------|
| `claude-cli` (default) | — | Uses your Claude Code session. Run `claude login` first. |
| `anthropic` | `ANTHROPIC_API_KEY` | Calls the Anthropic API directly via SDK. |
| `openai` | `OPENAI_API_KEY` | Calls the OpenAI API via fetch. |

```bash
# Option 1: Claude CLI (default, no API key needed)
claude login
skillforge check-auth --validate

# Option 2: Anthropic API
export SKILLFORGE_PROVIDER=anthropic
export ANTHROPIC_API_KEY=sk-ant-...

# Option 3: OpenAI API
export SKILLFORGE_PROVIDER=openai
export OPENAI_API_KEY=sk-...
```

---

## Skill Library Structure

Every skill is a folder containing a `SKILL.md` plus optional supporting files:
```
~/.skillforge/library/@creator-handle/topic/SKILL.md
```

The creator folder groups skills by who taught them. Each topic folder can hold scripts, references, and assets alongside the core skill document.

```
~/.skillforge/library/
  @alex-hormozi/
    the-mathematics-of-business-explained/
      SKILL.md
    100m-offers-pricing-framework/
      SKILL.md
  @andrew-huberman/
    sleep-optimization-protocols/
      SKILL.md
```

Legacy flat files (`topic.skill.md`) are still readable — SkillForge automatically detects both formats.

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
- One of: Claude CLI (`claude login`), `ANTHROPIC_API_KEY`, or `OPENAI_API_KEY`

---

## License

MIT — Built with ❤️ by [Cutbox.ai](https://cutbox.ai)
