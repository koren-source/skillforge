import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const OUTPUT_DIR = "/tmp/skillforge-test-output";
const BIN = path.resolve(import.meta.dirname, "..", "bin", "skillforge.js");

// A short public YouTube video with subtitles (Rick Astley, ~3:30)
const TEST_VIDEO_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

function hasYtDlp() {
  try {
    execSync("which yt-dlp", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function hasNetwork() {
  try {
    execSync("curl -s --max-time 5 -o /dev/null https://www.youtube.com", {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

const skipReason =
  !hasYtDlp()
    ? "yt-dlp not installed"
    : !hasNetwork()
      ? "no network access"
      : undefined;

describe("integration: skillforge watch", { skip: skipReason }, () => {
  before(() => {
    fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  });

  after(() => {
    fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  });

  it("produces a valid .skill.md file from a real YouTube video", { timeout: 120_000 }, (t) => {
    // Run the CLI — skip gracefully if YouTube rate-limits or transcript unavailable
    try {
      execFileSync("node", [BIN, "watch", TEST_VIDEO_URL, "--output", OUTPUT_DIR, "--intent", "test"], {
        timeout: 120_000,
        stdio: "pipe",
      });
    } catch (err) {
      const stderr = err.stderr?.toString() || "";
      if (stderr.includes("429") || stderr.includes("Rate limit") || stderr.includes("No transcript")) {
        t.skip("YouTube rate-limited or transcript unavailable");
        return;
      }
      throw err;
    }

    // Find the output file
    const files = fs.readdirSync(OUTPUT_DIR).filter((f) => f.endsWith(".skill.md"));
    assert.ok(files.length > 0, `Expected at least one .skill.md file in ${OUTPUT_DIR}, found: ${fs.readdirSync(OUTPUT_DIR)}`);

    const outputPath = path.join(OUTPUT_DIR, files[0]);
    const content = fs.readFileSync(outputPath, "utf8");

    // Non-empty
    assert.ok(content.length > 100, `Output file too small (${content.length} bytes)`);

    // Has YAML frontmatter
    assert.ok(content.startsWith("---"), "Expected YAML frontmatter at start of file");
    const frontmatterEnd = content.indexOf("---", 3);
    assert.ok(frontmatterEnd > 0, "Expected closing --- for frontmatter");

    const frontmatter = content.slice(3, frontmatterEnd);

    // Required frontmatter fields
    assert.ok(frontmatter.includes("name:"), "Frontmatter missing 'name' field");
    assert.ok(frontmatter.includes("built_at:"), "Frontmatter missing 'built_at' field");
    assert.ok(frontmatter.includes("model:"), "Frontmatter missing 'model' field");

    // Has expected markdown sections
    assert.ok(content.includes("## Frameworks"), "Missing '## Frameworks' section");
    assert.ok(content.includes("## Tactics"), "Missing '## Tactics' section");
  });
});
