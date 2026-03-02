# SkillForge Audit Report

**Date:** 2026-03-02
**Version audited:** 4.0.0
**Auditor:** Q (Claude Opus 4.6)

---

## What SkillForge Does

SkillForge is a Node.js CLI tool that transforms YouTube videos into structured AI agent skills. The pipeline:

1. **Extract** — Downloads video transcripts via `yt-dlp`, parses VTT subtitles, deduplicates, and caches results
2. **Synthesize** — Sends transcripts to Claude (via Claude CLI) for knowledge extraction: frameworks, tactics, quotes, numbers
3. **Format** — Outputs structured `.skill.md` files with YAML frontmatter, organized by creator in `~/.skillforge/library/`
4. **Index** — Maintains a JSON index and SQLite FTS database for intent-based skill recall
5. **Serve** — Exposes skills via MCP server for Claude Code integration

The CLI supports: single video (`watch`), batch builds from channels/topics/URLs (`build`), scoring/proposals (`scan`), search (`recall`), and an MCP server (`serve`).

---

## Bugs Found and Fixes Applied

### BUG 1: `--auto` mode restricted to `--channel`/`--channels` only

**File:** `bin/skillforge.js:568-569`
**Severity:** High (blocks core functionality)

The `--auto` flag threw an error unless `--channel` or `--channels` was provided. Users couldn't use `--auto` with a plain URL argument, `--urls`, or `--topic` — even though those are valid sources with scorable metadata.

**Before:**
```js
if (!options.channel && !(options.channels && options.channels.length)) {
  throw new Error("--auto requires --channel or --channels.");
}
```

**After:**
Removed the restriction entirely. `--auto` now works with any source that `resolveSource()` accepts. The `--intent` requirement remains (needed for scoring).

---

### BUG 2: Hardcoded outdated model names across the codebase

**Files:** `src/synthesize.js:10`, `bin/skillforge.js:544,770,331`, `src/format.js:33`, `src/merge.js:49`, `src/api.js:72,183`, `src/auth.js:42`
**Severity:** Medium (uses old model IDs that may stop working)

Every file hardcoded `claude-sonnet-4-20250514` as the default model. The auth test used `claude-3-5-haiku-20241022`.

**Before:**
```js
const DEFAULT_MODEL = "claude-sonnet-4-20250514";
// auth.js:
["--model", "claude-3-5-haiku-20241022"]
```

**After:**
```js
const DEFAULT_MODEL = "claude-sonnet-4-5";
// auth.js:
["--model", "claude-haiku-4-5-20251001"]
```

Updated in all 8 locations across 6 files.

---

### BUG 3: No retry logic for yt-dlp 429 rate limit errors

**File:** `src/extract.js:7-51`
**Severity:** High (builds fail silently on rate limits during batch operations)

When YouTube returns HTTP 429 (rate limit), `yt-dlp` exits non-zero and SkillForge either crashes or silently skips the video. No retry attempt is made, causing incomplete skill builds on channels with many videos.

**Before:**
```js
function runYtDlp(args, options = {}) {
  // Single attempt, no retry
}
```

**After:**
```js
// Internal single-attempt function
function runYtDlpOnce(args, options = {}) { ... }

// Public wrapper with exponential backoff retry
async function runYtDlp(args, options = {}) {
  // Up to 3 retries with 5s, 10s, 20s delays
  // Only retries on 429/rate-limit errors
  // Logs retry attempts to stderr
}
```

---

### BUG 4: `require()` used in ES module (api.js)

**File:** `src/api.js:14`
**Severity:** Critical (crashes on import in Node.js with `"type": "module"`)

The `loadExistingSkillMeta` function used `require("node:fs").readFileSync()`. Since `package.json` has `"type": "module"`, `require()` is not available and throws `ReferenceError: require is not defined`.

**Before:**
```js
const content = require("node:fs").readFileSync(filePath, "utf8");
```

**After:**
```js
import { readFileSync } from "node:fs";
// ...
const content = readFileSync(filePath, "utf8");
```

---

### BUG 5: Null dereference when `fetchTranscriptForUrl` returns null

**Files:** `bin/skillforge.js:779`, `src/api.js:193`
**Severity:** High (crashes with TypeError instead of showing error message)

`fetchTranscriptForUrl()` returns `null` when no subtitles exist. Both callers accessed `.transcript` on the return value without checking for `null` first, causing `TypeError: Cannot read properties of null (reading 'transcript')`.

**Before:**
```js
const transcriptData = await fetchTranscriptForUrl(url);
if (!transcriptData.transcript) { // TypeError if null
```

**After:**
```js
const transcriptData = await fetchTranscriptForUrl(url);
if (!transcriptData || !transcriptData.transcript) {
```

---

### BUG 6: `cache.get()` missing error handling for file reads

**File:** `src/cache.js:32-42`
**Severity:** Medium (race condition between `has()` and `get()` causes unhandled throw)

`cache.get()` called `fs.readFile()` without try/catch. If the cache file was deleted between `has()` returning `true` and `get()` reading, an unhandled exception would crash the process.

**Before:**
```js
async function get(videoId) {
  const raw = await fs.readFile(cachePath(videoId), "utf8"); // can throw
  try {
    const entry = JSON.parse(raw);
```

**After:**
```js
async function get(videoId) {
  try {
    const raw = await fs.readFile(cachePath(videoId), "utf8");
    const entry = JSON.parse(raw);
    if (!entry.cachedAt || Date.now() - entry.cachedAt > ttlMs()) return null;
    return entry.transcript;
  } catch {
    return null;
  }
}
```

---

### BUG 7: Dead variable `totalLen` in synthesize.js

**File:** `src/synthesize.js:516`
**Severity:** Low (dead code, no runtime impact)

`const totalLen = fullText.length` was declared but never used.

**Fix:** Removed the declaration.

---

### ISSUE 8: README.md missing most CLI commands

**File:** `README.md`
**Severity:** Medium (documentation gap)

The README only documented `watch`, `recall`, `list`, and `check-auth`. Missing: `build`, `scan`, `suggest`, `trust`, `prune`, `serve`.

**Fix:** Added documentation for all 6 missing commands with usage examples.

---

## Remaining Concerns and TODOs

### Architecture / Design

1. **Cache doesn't store metadata.** When a transcript cache hit occurs (`extract.js:144-153`), `fetchVideoMetadata()` is still called to get title/channel info. This makes a yt-dlp network call on every cached transcript lookup. Metadata (title, channel, channelUrl) should be cached alongside the transcript.

2. **Synchronous file reads in async functions.** `skillIndex.js:92` uses `readFileSync` inside `search()` which blocks the event loop. For large libraries with many skills, this could cause noticeable lag.

3. **Merge prompt schema mismatch.** `src/merge.js` uses `"title"/"details"` for tactics while the rest of the codebase uses `"name"/"description"`. The formatters handle both (`tactic.name || tactic.title`), but it creates inconsistent output.

4. **`makeOutputFilename` for skill format** creates a nested path (`topicSlug/SKILL.md`) via `pathJoinSafe`. This doesn't match the library convention of `topic.skill.md`. Works for non-library output but is confusing.

5. **`@anthropic-ai/sdk` version `^0.20.0`** in package.json is quite old. Consider updating to latest.

### Robustness

6. **No checkpoint cleanup.** Old checkpoint files in `~/.skillforge/checkpoints/` are never cleaned up if a build is abandoned mid-synthesis. A periodic cleanup or TTL would prevent disk accumulation.

7. **`extractFromUrls` swallows all errors.** The catch block at `extract.js:261` catches everything, not just transcript-missing errors. A network failure or yt-dlp crash is treated the same as "no subtitles available."

8. **MCP server `rebuildIndex` deletes and re-inserts everything on startup.** For large libraries, this causes unnecessary I/O. An incremental index update based on file modification time would be more efficient.

### Testing

9. **No test suite.** The `"test"` script in package.json just runs `--help`. There are no unit tests, integration tests, or CI. For an open-source tool, this is a significant gap.

---

## Files Audited

| File | Lines | Status |
|------|-------|--------|
| `package.json` | 37 | OK (dependency versions could be bumped) |
| `bin/skillforge.js` | 979 | 3 bugs fixed |
| `src/synthesize.js` | 621 | 2 bugs fixed |
| `src/extract.js` | 297 | 1 bug fixed (retry logic added) |
| `src/format.js` | 246 | 1 bug fixed (model name) |
| `src/api.js` | 257 | 2 bugs fixed (require + null check) |
| `src/auth.js` | 131 | 1 bug fixed (model name) |
| `src/cache.js` | 51 | 1 bug fixed (error handling) |
| `src/merge.js` | 96 | 1 bug fixed (model name) |
| `src/config.js` | 54 | Clean |
| `src/skillIndex.js` | 150 | Clean (sync read noted) |
| `src/score.js` | 79 | Clean |
| `src/search.js` | 24 | Clean |
| `src/propose.js` | 170 | Clean |
| `src/library.js` | 104 | Clean |
| `src/creator.js` | 103 | Clean |
| `src/mcp.js` | 253 | Clean |
| `skills/meta-ads/SKILL.md` | 279 | Clean, high quality |
| `skills/yc-fundraising/SKILL.md` | 216 | Clean, high quality |
| `skills/README.md` | 17 | Clean |
| `examples/output-sample.md` | 71 | Clean |
| `README.md` | 211 | Updated (missing commands added) |
| `.env.example` | 2 | Clean |

---

## Summary of Changes

| # | What | Files Changed |
|---|------|--------------|
| 1 | Removed `--auto` source restriction | `bin/skillforge.js` |
| 2 | Updated 8 model name references | `synthesize.js`, `bin/skillforge.js`, `format.js`, `merge.js`, `api.js`, `auth.js` |
| 3 | Added yt-dlp 429 retry with exponential backoff | `src/extract.js` |
| 4 | Fixed `require()` in ES module | `src/api.js` |
| 5 | Fixed null dereference on missing transcripts | `bin/skillforge.js`, `src/api.js` |
| 6 | Fixed cache race condition | `src/cache.js` |
| 7 | Removed dead variable | `src/synthesize.js` |
| 8 | Added missing CLI commands to README | `README.md` |

---

## Overall Health Score: 7/10

**Strengths:**
- Clean modular architecture with clear separation of concerns
- Robust transcript chunking pipeline handles arbitrarily long videos
- Good error handling in the synthesis pipeline (checkpoints, JSON extraction fallbacks)
- Well-designed skill format with YAML frontmatter for machine readability
- MCP server integration is solid with FTS5 search
- The two seed skills (meta-ads, yc-fundraising) are genuinely high quality

**Weaknesses:**
- Critical bug (require in ESM) would crash the library API on import
- No test suite at all
- Several high-severity bugs in the main CLI path (null dereference, --auto restriction)
- Outdated model names throughout
- Missing documentation for most CLI commands
- Cache doesn't store metadata, causing unnecessary network calls

The core pipeline (extract -> synthesize -> format -> index) is well-architected. The bugs found were mostly in the glue code and edge cases. After these fixes, the tool should be production-ready for its intended use case.
