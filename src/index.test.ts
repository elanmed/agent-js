/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculateSessionCost, type TokenUsage } from "./index.ts";

const noUsages: TokenUsage[] = [];

describe("calculateSessionCost", () => {
  it("unknown model returns 'Session cost: unknown'", () => {
    const result = calculateSessionCost("claude-3-5-haiku-20241022", noUsages);
    assert.equal(result, "Session cost: unknown");
  });

  it("known model with no usages returns $0.0000", () => {
    const result = calculateSessionCost("claude-haiku-4-5", noUsages);
    assert.equal(result, "Session cost: $0.0000");
  });

  it("calculates input and output token costs correctly", () => {
    // haiku: input=$1/M, output=$5/M
    // 1_000_000 input + 1_000_000 output = $1 + $5 = $6.0000
    const result = calculateSessionCost("claude-haiku-4-5", [
      { input_tokens: 1_000_000, output_tokens: 1_000_000 },
    ]);
    assert.equal(result, "Session cost: $6.0000");
  });

  it("calculates cache creation token cost", () => {
    // haiku: cacheWrite5m=$1.25/M
    // 1_000_000 cache_creation = $1.25
    const result = calculateSessionCost("claude-haiku-4-5", [
      { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000 },
    ]);
    assert.equal(result, "Session cost: $1.2500");
  });

  it("calculates cache read token cost", () => {
    // haiku: cacheRead=$0.10/M
    // 1_000_000 cache_read = $0.10
    const result = calculateSessionCost("claude-haiku-4-5", [
      { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 },
    ]);
    assert.equal(result, "Session cost: $0.1000");
  });

  it("accumulates costs across multiple usages", () => {
    // haiku: input=$1/M, output=$5/M
    // usage1: 500_000 input + 200_000 output = $0.50 + $1.00 = $1.50
    // usage2: 500_000 input + 300_000 output = $0.50 + $1.50 = $2.00
    // total = $3.50
    const result = calculateSessionCost("claude-haiku-4-5", [
      { input_tokens: 500_000, output_tokens: 200_000 },
      { input_tokens: 500_000, output_tokens: 300_000 },
    ]);
    assert.equal(result, "Session cost: $3.5000");
  });
});
