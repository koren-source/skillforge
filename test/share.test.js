import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

let tmpHome;
let outputDir;
let shareModule;

before(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "skillforge-share-home-"));
  outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "skillforge-share-output-"));
  process.env.HOME = tmpHome;

  const libraryRoot = path.join(tmpHome, ".skillforge", "library", "alex-hormozi");
  await fs.mkdir(libraryRoot, { recursive: true });
  await fs.writeFile(
    path.join(libraryRoot, "lead-magnets.skill.md"),
    [
      "---",
      'name: "Lead Magnets"',
      "---",
      "# Lead Magnets",
      "",
      "Useful skill content.",
      "",
    ].join("\n"),
    "utf8"
  );

  shareModule = await import(`../src/share.js?share-test=${Date.now()}`);
});

after(async () => {
  await fs.rm(tmpHome, { recursive: true, force: true });
  await fs.rm(outputDir, { recursive: true, force: true });
});

describe("shareSkill", () => {
  it("copies a shared skill into a folder with attribution", async () => {
    const result = await shareModule.shareSkill({
      skillRef: "lead-magnets",
      outputDir,
    });

    const sharedSkillPath = path.join(outputDir, "@alex-hormozi", "lead-magnets", "SKILL.md");
    const content = await fs.readFile(sharedSkillPath, "utf8");

    assert.equal(result.outputPath, path.join(outputDir, "@alex-hormozi", "lead-magnets"));
    assert.match(content, /shared_by:/);
    assert.match(content, /sourced_from: "@alex-hormozi"/);
    assert.match(content, /shared_at:/);
    assert.match(content, /# Lead Magnets/);
  });

  it("prints a stdout bundle when requested", async () => {
    const result = await shareModule.shareSkill({
      skillRef: "@alex-hormozi/lead-magnets",
      stdout: true,
    });

    assert.match(result.stdout, /Skill share bundle: @alex-hormozi\/lead-magnets/);
    assert.match(result.stdout, /FILE: @alex-hormozi\/lead-magnets\/SKILL.md/);
    assert.match(result.stdout, /shared_by:/);
  });
});
