import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseVtt, extractVideoId } from "../src/extract.js";

describe("parseVtt", () => {
  it("extracts transcript lines from VTT content", () => {
    const vtt = [
      "WEBVTT",
      "Kind: captions",
      "Language: en",
      "",
      "00:00:00.000 --> 00:00:02.000",
      "Hello world",
      "",
      "00:00:02.000 --> 00:00:04.000",
      "This is a test",
    ].join("\n");

    const result = parseVtt(vtt);
    assert.ok(result.includes("Hello world"));
    assert.ok(result.includes("This is a test"));
  });

  it("deduplicates repeated lines", () => {
    const vtt = [
      "WEBVTT",
      "",
      "00:00:00.000 --> 00:00:02.000",
      "Hello world",
      "",
      "00:00:02.000 --> 00:00:04.000",
      "Hello world",
      "",
      "00:00:04.000 --> 00:00:06.000",
      "Different line",
    ].join("\n");

    const result = parseVtt(vtt);
    const lines = result.split("\n");
    const helloCount = lines.filter((l) => l === "Hello world").length;
    assert.equal(helloCount, 1, "Duplicate lines should be collapsed");
  });

  it("strips HTML tags and normalizes whitespace", () => {
    const vtt = [
      "WEBVTT",
      "",
      "00:00:00.000 --> 00:00:02.000",
      "<b>Bold</b> and&nbsp;spaced   text",
    ].join("\n");

    const result = parseVtt(vtt);
    assert.ok(result.includes("Bold and spaced text"));
  });

  it("returns empty string for empty VTT", () => {
    const result = parseVtt("WEBVTT\n\n");
    assert.equal(result, "");
  });

  it("filters out timestamp and metadata lines", () => {
    const vtt = [
      "WEBVTT",
      "Kind: captions",
      "Language: en",
      "",
      "1",
      "00:00:00.000 --> 00:00:02.000",
      "Actual content",
    ].join("\n");

    const result = parseVtt(vtt);
    assert.ok(!result.includes("WEBVTT"));
    assert.ok(!result.includes("Kind:"));
    assert.ok(!result.includes("-->"));
    assert.ok(result.includes("Actual content"));
  });
});

describe("extractVideoId", () => {
  it("extracts ID from standard YouTube URL", () => {
    assert.equal(
      extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
      "dQw4w9WgXcQ"
    );
  });

  it("extracts ID from youtu.be short URL", () => {
    assert.equal(
      extractVideoId("https://youtu.be/dQw4w9WgXcQ"),
      "dQw4w9WgXcQ"
    );
  });

  it("extracts ID from Shorts URL", () => {
    assert.equal(
      extractVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ"),
      "dQw4w9WgXcQ"
    );
  });

  it("returns null for non-YouTube URL", () => {
    assert.equal(extractVideoId("https://example.com/video"), null);
  });

  it("returns null for empty input", () => {
    assert.equal(extractVideoId(""), null);
  });
});
