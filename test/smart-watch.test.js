import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseProposalInput } from "../bin/skillforge.js";

describe("parseProposalInput", () => {
  it("selects all when input is empty", () => {
    const result = parseProposalInput("", 3);
    assert.deepEqual(result, { type: "selected", indices: [0, 1, 2] });
  });

  it("selects all when input is 'all'", () => {
    const result = parseProposalInput("all", 4);
    assert.deepEqual(result, { type: "selected", indices: [0, 1, 2, 3] });
  });

  it("selects all when input is 'ALL' (case insensitive)", () => {
    const result = parseProposalInput("ALL", 2);
    assert.deepEqual(result, { type: "selected", indices: [0, 1] });
  });

  it("parses a single index", () => {
    const result = parseProposalInput("2", 3);
    assert.deepEqual(result, { type: "selected", indices: [1] });
  });

  it("parses comma-separated indices", () => {
    const result = parseProposalInput("1,3", 4);
    assert.deepEqual(result, { type: "selected", indices: [0, 2] });
  });

  it("parses a range", () => {
    const result = parseProposalInput("1-3", 4);
    assert.deepEqual(result, { type: "selected", indices: [0, 1, 2] });
  });

  it("parses mixed ranges and indices", () => {
    const result = parseProposalInput("1, 3-4", 4);
    assert.deepEqual(result, { type: "selected", indices: [0, 2, 3] });
  });

  it("ignores out-of-range indices", () => {
    const result = parseProposalInput("5", 3);
    // No valid indices → falls through to custom intent
    assert.equal(result.type, "custom");
    assert.equal(result.intent, "5");
  });

  it("deduplicates indices", () => {
    const result = parseProposalInput("1,1,2", 3);
    assert.deepEqual(result, { type: "selected", indices: [0, 1] });
  });

  it("returns cancel for 'cancel'", () => {
    const result = parseProposalInput("cancel", 3);
    assert.deepEqual(result, { type: "cancel" });
  });

  it("returns cancel for 'q'", () => {
    const result = parseProposalInput("q", 3);
    assert.deepEqual(result, { type: "cancel" });
  });

  it("returns cancel for 'n'", () => {
    const result = parseProposalInput("n", 3);
    assert.deepEqual(result, { type: "cancel" });
  });

  it("returns custom intent for non-numeric text", () => {
    const result = parseProposalInput("paid ads strategy", 3);
    assert.deepEqual(result, { type: "custom", intent: "paid ads strategy" });
  });

  it("preserves original casing for custom intent", () => {
    const result = parseProposalInput("Pricing Strategy", 3);
    assert.deepEqual(result, { type: "custom", intent: "Pricing Strategy" });
  });

  it("handles whitespace-padded input", () => {
    const result = parseProposalInput("  2  ", 3);
    assert.deepEqual(result, { type: "selected", indices: [1] });
  });
});
