/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  isAbortError,
  tryCatch,
  tryCatchAsync,
  calculateSessionCost,
  executeBat,
  type TokenUsage,
} from "./utils.ts";

describe("utils", () => {
  describe("isAbortError", () => {
    it("returns true for an Error with name === 'AbortError'", () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      assert.equal(isAbortError(err), true);
    });

    it("returns false for a plain Error", () => {
      assert.equal(isAbortError(new Error("plain")), false);
    });

    it("returns false for null", () => {
      assert.equal(isAbortError(null), false);
    });

    it("returns false for a string", () => {
      assert.equal(isAbortError("AbortError"), false);
    });
  });

  describe("tryCatch", () => {
    it("returns {ok: true, value} when the callback succeeds", () => {
      const result = tryCatch(() => 42);
      assert.deepEqual(result, { ok: true, value: 42 });
    });

    it("returns {ok: false, error} when the callback throws", () => {
      const err = new Error("boom");
      const result = tryCatch(() => {
        throw err;
      });
      assert.deepEqual(result, { ok: false, error: err });
    });
  });

  describe("tryCatchAsync", () => {
    it("returns {ok: true, value} for a resolved promise", async () => {
      const result = await tryCatchAsync(Promise.resolve(42));
      assert.deepEqual(result, { ok: true, value: 42 });
    });

    it("returns {ok: false, error} for a rejected promise", async () => {
      const err = new Error("boom");
      const result = await tryCatchAsync(Promise.reject(err));
      assert.deepEqual(result, { ok: false, error: err });
    });
  });

  const noUsages: TokenUsage[] = [];

  describe("calculateSessionCost", () => {
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
        {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 1_000_000,
        },
      ]);
      assert.equal(result, "Session cost: $1.2500");
    });

    it("calculates cache read token cost", () => {
      // haiku: cacheRead=$0.10/M
      // 1_000_000 cache_read = $0.10
      const result = calculateSessionCost("claude-haiku-4-5", [
        {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 1_000_000,
        },
      ]);
      assert.equal(result, "Session cost: $0.1000");
    });

    it("treats null cache token fields as zero", () => {
      const result = calculateSessionCost("claude-haiku-4-5", [
        {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: null,
          cache_read_input_tokens: null,
        },
      ]);
      assert.equal(result, "Session cost: $0.0000");
    });

    it("calculates costs correctly for claude-sonnet-4-6", () => {
      // sonnet: input=$3/M, output=$15/M
      // 1_000_000 input + 1_000_000 output = $3 + $15 = $18.0000
      const result = calculateSessionCost("claude-sonnet-4-6", [
        { input_tokens: 1_000_000, output_tokens: 1_000_000 },
      ]);
      assert.equal(result, "Session cost: $18.0000");
    });

    it("calculates costs correctly for claude-opus-4-6", () => {
      // opus: input=$5/M, output=$25/M
      // 1_000_000 input + 1_000_000 output = $5 + $25 = $30.0000
      const result = calculateSessionCost("claude-opus-4-6", [
        { input_tokens: 1_000_000, output_tokens: 1_000_000 },
      ]);
      assert.equal(result, "Session cost: $30.0000");
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
});

describe("executeBat", () => {
  let written: (string | Buffer)[];
  let originalWrite: typeof process.stdout.write;

  beforeEach(() => {
    written = [];
    originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (data: string | Buffer) => {
      written.push(data);
      return true;
    };
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
  });

  it("writes bat output when bat is available and spawn succeeds", async () => {
    const batOutput = Buffer.from("# rendered by bat");

    await executeBat("# raw content", {
      checkBat: () => Promise.resolve(true),
      spawnBat: () => ({ ok: true, value: { stdout: batOutput } }),
    });

    assert.deepEqual(written, [batOutput]);
  });

  it("falls back to plain text when bat is not available", async () => {
    await executeBat("hello world", {
      checkBat: () => Promise.resolve(false),
      spawnBat: () => {
        throw new Error("should not be called");
      },
    });

    assert.equal(written.at(-1), "hello world");
  });

  it("falls back to plain text when bat spawn fails", async () => {
    await executeBat("some content", {
      checkBat: () => Promise.resolve(true),
      spawnBat: () => ({ ok: false, error: new Error("spawn failed") }),
    });

    assert.deepEqual(written, ["some content"]);
  });
});
