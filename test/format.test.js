import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { slugify, slugifyCreator, makeOutputFilename } from "../src/format.js";

describe("slugify", () => {
  it("converts text to lowercase slug", () => {
    assert.equal(slugify("Hello World"), "hello-world");
  });

  it("strips special characters", () => {
    assert.equal(slugify("The $100M Offer!!!"), "the-100m-offer");
  });

  it("collapses multiple separators", () => {
    assert.equal(slugify("one---two___three"), "one-two-three");
  });

  it("trims leading and trailing dashes", () => {
    assert.equal(slugify("--hello--"), "hello");
  });

  it("truncates at 80 characters", () => {
    const long = "a".repeat(100);
    assert.ok(slugify(long).length <= 80);
  });

  it("returns 'skillforge' for empty input", () => {
    assert.equal(slugify(""), "skillforge");
    assert.equal(slugify(null), "skillforge");
    assert.equal(slugify(undefined), "skillforge");
  });
});

describe("slugifyCreator", () => {
  it("prefixes with @", () => {
    assert.equal(slugifyCreator("Alex Hormozi"), "@alex-hormozi");
  });

  it("returns @unknown for empty input", () => {
    assert.equal(slugifyCreator(""), "@unknown");
    assert.equal(slugifyCreator(null), "@unknown");
  });

  it("handles special characters in names", () => {
    assert.equal(slugifyCreator("Mr. Beast!"), "@mr-beast");
  });
});

describe("makeOutputFilename", () => {
  it("returns .md for markdown format", () => {
    assert.equal(makeOutputFilename("markdown", "my-topic"), "my-topic.md");
  });

  it("returns .json for json format", () => {
    assert.equal(makeOutputFilename("json", "my-topic"), "my-topic.json");
  });

  it("returns topic.skill.md for skill format", () => {
    assert.equal(makeOutputFilename("skill", "my-topic"), "my-topic.skill.md");
  });

  it("throws for unsupported format", () => {
    assert.throws(() => makeOutputFilename("xml", "my-topic"), /Unsupported format/);
  });
});
