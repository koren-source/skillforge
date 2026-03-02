import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// We need to override the cache directory for testing.
// The cache module uses CACHE_DIR based on homedir, so we'll test by
// importing and calling set/get/has with real temp files.
// Since the module uses a fixed path, we test the public API.

let tmpDir;

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "skillforge-cache-test-"));
  // Override HOME so cache writes to our temp dir
  process.env.HOME = tmpDir;
});

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// Dynamic import AFTER setting HOME so the cache module picks up the temp dir
async function getCache() {
  // Each test run gets a fresh import to pick up the new HOME
  const mod = await import("../src/cache.js");
  return mod;
}

describe("cache", () => {
  it("returns null for missing entries", async () => {
    const cache = await getCache();
    const result = await cache.get("nonexistent-id");
    assert.equal(result, null);
  });

  it("stores and retrieves transcript with metadata", async () => {
    const cache = await getCache();
    await cache.set("test-video-123", {
      transcript: "Hello world transcript",
      title: "Test Video",
      channelTitle: "Test Channel",
      channelUrl: "https://youtube.com/@test",
    });

    const result = await cache.get("test-video-123");
    assert.ok(result, "Should return cached data");
    assert.equal(result.transcript, "Hello world transcript");
    assert.equal(result.title, "Test Video");
    assert.equal(result.channelTitle, "Test Channel");
    assert.equal(result.channelUrl, "https://youtube.com/@test");
    assert.ok(result.cachedAt, "Should have cachedAt timestamp");
  });

  it("has() returns true for cached entries", async () => {
    const cache = await getCache();
    await cache.set("has-test-456", {
      transcript: "Some transcript",
      title: "Has Test",
    });
    const exists = await cache.has("has-test-456");
    assert.equal(exists, true);
  });

  it("has() returns false for missing entries", async () => {
    const cache = await getCache();
    const exists = await cache.has("missing-id-999");
    assert.equal(exists, false);
  });

  it("handles plain string set for backward compat", async () => {
    const cache = await getCache();
    await cache.set("string-test-789", "just a transcript string");
    const result = await cache.get("string-test-789");
    assert.ok(result);
    assert.equal(result.transcript, "just a transcript string");
  });
});
