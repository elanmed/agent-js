/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  isAbortError,
  tryCatch,
  tryCatchAsync,
  calculateSessionUsage,
  normalizeLine,
  getMessageFromError,
  type TokenUsage,
} from "./utils.ts";
import { resetState, dispatch, actions } from "./state.ts";

beforeEach(() => {
  resetState();
  // Set up custom pricing for testing
  dispatch(
    actions.setPricingPerModel({
      "claude-haiku-4-5": {
        inputPerToken: 1,
        outputPerToken: 5,
        cacheReadPerToken: 0.25,
        cacheWritePerToken: 1.25,
      },
      "claude-sonnet-4-6": {
        inputPerToken: 3,
        outputPerToken: 15,
        cacheReadPerToken: 0.75,
        cacheWritePerToken: 3.75,
      },
      "claude-opus-4-6": {
        inputPerToken: 5,
        outputPerToken: 25,
        cacheReadPerToken: 1.25,
        cacheWritePerToken: 6.25,
      },
    }),
  );
});

describe("utils", () => {
  describe("getMessageFromError", () => {
    it("returns the message from an Error instance", () => {
      assert.equal(
        getMessageFromError(new Error("test message")),
        "test message",
      );
    });

    it("returns JSON string for non-Error values", () => {
      assert.equal(getMessageFromError("string error"), '"string error"');
      assert.equal(getMessageFromError(42), "42");
      assert.equal(getMessageFromError(null), "null");
    });
  });

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
        {
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      ]);
      assert.equal(result, "Session usage: $6.0000");
    });

    it("calculates costs correctly for claude-sonnet-4-6", () => {
      // sonnet: input=$3/M, output=$15/M
      // 1_000_000 prompt + 1_000_000 completion = $3 + $15 = $18.0000
      const result = calculateSessionUsage("claude-sonnet-4-6", [
        {
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      ]);
      assert.equal(result, "Session usage: $18.0000");
    });

    it("calculates costs correctly for claude-opus-4-6", () => {
      // opus: input=$5/M, output=$25/M
      // 1_000_000 prompt + 1_000_000 completion = $5 + $25 = $30.0000
      const result = calculateSessionUsage("claude-opus-4-6", [
        {
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      ]);
      assert.equal(result, "Session usage: $30.0000");
    });

    it("accumulates costs across multiple usages", () => {
      // haiku: input=$1/M, output=$5/M
      // usage1: 500_000 prompt + 200_000 completion = $0.50 + $1.00 = $1.50
      // usage2: 500_000 prompt + 300_000 completion = $0.50 + $1.50 = $2.00
      // total = $3.50
      const result = calculateSessionUsage("claude-haiku-4-5", [
        {
          inputTokens: 500_000,
          outputTokens: 200_000,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
        {
          inputTokens: 500_000,
          outputTokens: 300_000,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      ]);
      assert.equal(result, "Session usage: $3.5000");
    });

    it("calculates cache read token costs correctly", () => {
      // haiku: cacheRead=$0.25/M
      // 1_000_000 cache read tokens = $0.25
      const result = calculateSessionUsage("claude-haiku-4-5", [
        {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 1_000_000,
          cacheWriteTokens: 0,
        },
      ]);
      assert.equal(result, "Session usage: $0.2500");
    });

    it("calculates cache write token costs correctly", () => {
      // haiku: cacheWrite=$1.25/M
      // 1_000_000 cache write tokens = $1.25
      const result = calculateSessionUsage("claude-haiku-4-5", [
        {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 1_000_000,
        },
      ]);
      assert.equal(result, "Session usage: $1.2500");
    });

    it("calculates combined input, output, and cache costs correctly", () => {
      // haiku: input=$1/M, output=$5/M, cacheRead=$0.25/M, cacheWrite=$1.25/M
      // 500_000 input + 200_000 output + 300_000 cacheRead + 100_000 cacheWrite
      // = $0.50 + $1.00 + $0.075 + $0.125 = $1.70
      const result = calculateSessionUsage("claude-haiku-4-5", [
        {
          inputTokens: 500_000,
          outputTokens: 200_000,
          cacheReadTokens: 300_000,
          cacheWriteTokens: 100_000,
        },
      ]);
      assert.equal(result, "Session usage: $1.7000");
    });

    it("accumulates cache costs across multiple usages", () => {
      // haiku: cacheRead=$0.25/M, cacheWrite=$1.25/M
      // usage1: 500_000 cacheRead + 200_000 cacheWrite = $0.125 + $0.25 = $0.375
      // usage2: 500_000 cacheRead + 300_000 cacheWrite = $0.125 + $0.375 = $0.50
      // total = $0.875
      const result = calculateSessionUsage("claude-haiku-4-5", [
        {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 500_000,
          cacheWriteTokens: 200_000,
        },
        {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 500_000,
          cacheWriteTokens: 300_000,
        },
      ]);
      assert.equal(result, "Session usage: $0.8750");
    });
  });

  describe("normalizeLine", () => {
    it("trims whitespace and appends newline", () => {
      assert.equal(normalizeLine("  hello  "), "hello\n");
    });

    it("trims leading whitespace", () => {
      assert.equal(normalizeLine("\t\tcontent"), "content\n");
    });

    it("trims trailing whitespace", () => {
      assert.equal(normalizeLine("content\n\n"), "content\n");
    });

    it("handles empty string", () => {
      assert.equal(normalizeLine(""), "\n");
    });

    it("handles already normalized string", () => {
      assert.equal(normalizeLine("already\n"), "already\n");
    });
  });
});
