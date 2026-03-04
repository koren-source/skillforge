import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { wordCount, chunkByWordCount, WORD_CHUNK_THRESHOLD, WORD_CHUNK_SIZE } from "../src/synthesize.js";

describe("wordCount", () => {
  it("counts words in a simple string", () => {
    assert.equal(wordCount("hello world foo bar"), 4);
  });

  it("handles extra whitespace", () => {
    assert.equal(wordCount("  hello   world  "), 2);
  });

  it("returns 1 for single word", () => {
    assert.equal(wordCount("hello"), 1);
  });
});

describe("chunkByWordCount", () => {
  it("returns single chunk for text under chunk size", () => {
    const text = "word ".repeat(100).trim();
    const chunks = chunkByWordCount(text, 200);
    assert.equal(chunks.length, 1);
    assert.equal(wordCount(chunks[0]), 100);
  });

  it("splits text into correct number of chunks", () => {
    const text = "word ".repeat(25000).trim();
    const chunks = chunkByWordCount(text, 10000);
    assert.equal(chunks.length, 3);
    assert.equal(wordCount(chunks[0]), 10000);
    assert.equal(wordCount(chunks[1]), 10000);
    assert.equal(wordCount(chunks[2]), 5000);
  });

  it("handles exact boundary (no remainder)", () => {
    const text = "word ".repeat(20000).trim();
    const chunks = chunkByWordCount(text, 10000);
    assert.equal(chunks.length, 2);
  });
});

describe("constants", () => {
  it("WORD_CHUNK_THRESHOLD is 12000", () => {
    assert.equal(WORD_CHUNK_THRESHOLD, 12000);
  });

  it("WORD_CHUNK_SIZE is 10000", () => {
    assert.equal(WORD_CHUNK_SIZE, 10000);
  });
});

describe("word count gate boundary", () => {
  it("12000 words is at or below threshold (single-pass)", () => {
    const wc = 12000;
    assert.ok(wc <= WORD_CHUNK_THRESHOLD, "12000 words should use single-pass");
  });

  it("12001 words exceeds threshold (chunked pipeline)", () => {
    const wc = 12001;
    assert.ok(wc > WORD_CHUNK_THRESHOLD, "12001 words should trigger chunked pipeline");
  });
});
