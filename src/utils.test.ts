/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  isAbortError,
  tryCatch,
  tryCatchAsync,
  calculateSessionUsage,
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

  describe("calculateSessionUsage", () => {
    it("known model with no usages returns $0.0000", () => {
      const result = calculateSessionUsage("claude-haiku-4-5", noUsages);
      assert.equal(result, "Session usage: $0.0000");
    });

    it("returns token counts for a model with no pricing configured", () => {
      const result = calculateSessionUsage("unknown-model", noUsages);
      assert.ok(result.includes("0 in"));
      assert.ok(result.includes("0 out"));
    });

    it("calculates prompt and completion token costs correctly", () => {
      // haiku: input=$1/M, output=$5/M
      // 1_000_000 prompt + 1_000_000 completion = $1 + $5 = $6.0000
      const result = calculateSessionUsage("claude-haiku-4-5", [
        { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      ]);
      assert.equal(result, "Session usage: $6.0000");
    });

    it("calculates costs correctly for claude-sonnet-4-6", () => {
      // sonnet: input=$3/M, output=$15/M
      // 1_000_000 prompt + 1_000_000 completion = $3 + $15 = $18.0000
      const result = calculateSessionUsage("claude-sonnet-4-6", [
        { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      ]);
      assert.equal(result, "Session usage: $18.0000");
    });

    it("calculates costs correctly for claude-opus-4-6", () => {
      // opus: input=$5/M, output=$25/M
      // 1_000_000 prompt + 1_000_000 completion = $5 + $25 = $30.0000
      const result = calculateSessionUsage("claude-opus-4-6", [
        { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      ]);
      assert.equal(result, "Session usage: $30.0000");
    });

    it("accumulates costs across multiple usages", () => {
      // haiku: input=$1/M, output=$5/M
      // usage1: 500_000 prompt + 200_000 completion = $0.50 + $1.00 = $1.50
      // usage2: 500_000 prompt + 300_000 completion = $0.50 + $1.50 = $2.00
      // total = $3.50
      const result = calculateSessionUsage("claude-haiku-4-5", [
        { inputTokens: 500_000, outputTokens: 200_000 },
        { inputTokens: 500_000, outputTokens: 300_000 },
      ]);
      assert.equal(result, "Session usage: $3.5000");
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
