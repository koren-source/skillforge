import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

let tmpHome;
let originalHome;

before(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "skillforge-consent-"));
  originalHome = process.env.HOME;
  process.env.HOME = tmpHome;
});

after(async () => {
  process.env.HOME = originalHome;
  await fs.rm(tmpHome, { recursive: true, force: true });
});

describe("consent", () => {
  it("hasConsented returns false when config has no consented field", async () => {
    const { hasConsented } = await import(`../src/config.js?consent-test-1=${Date.now()}`);
    const result = await hasConsented();
    assert.equal(result, false);
  });

  it("hasConsented returns true after setConsented", async () => {
    const { hasConsented, setConsented } = await import(`../src/config.js?consent-test-2=${Date.now()}`);
    await setConsented();
    const result = await hasConsented();
    assert.equal(result, true);
  });

  it("consent state persists across loadConfig calls", async () => {
    const mod1 = await import(`../src/config.js?consent-test-3a=${Date.now()}`);
    await mod1.setConsented();

    const mod2 = await import(`../src/config.js?consent-test-3b=${Date.now()}`);
    const result = await mod2.hasConsented();
    assert.equal(result, true);
  });

  it("hasConsented returns false when consented is not true", async () => {
    const { loadConfig, saveConfig, hasConsented } = await import(`../src/config.js?consent-test-4=${Date.now()}`);
    const config = await loadConfig();
    config.consented = "yes";
    await saveConfig(config);

    const result = await hasConsented();
    assert.equal(result, false);
  });
});
