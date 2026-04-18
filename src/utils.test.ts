import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  isAbortError,
  tryCatch,
  tryCatchAsync,
  calculateSessionUsage,
  normalizeLine,
  getMessageFromError,
  fenceLog,
  isSameKey,
  type TokenUsage,
} from "./utils.ts";
import { dispatch, actions } from "./state.ts";

beforeEach(() => {
  dispatch(actions.resetState());

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
      assert.equal(result, "$0.0000");
    });

    it("calculates prompt token costs correctly", () => {
      // haiku: input=$1/M, 2_000_000 prompt = $2.0000
      const result = calculateSessionUsage("claude-haiku-4-5", [
        {
          inputTokens: 2_000_000,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      ]);
      assert.equal(result, "$2.0000");
    });

    it("calculates completion token costs correctly", () => {
      // haiku: output=$5/M, 600_000 completion = $3.0000
      const result = calculateSessionUsage("claude-haiku-4-5", [
        {
          inputTokens: 0,
          outputTokens: 600_000,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      ]);
      assert.equal(result, "$3.0000");
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
      assert.equal(result, "$0.2500");
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
      assert.equal(result, "$1.2500");
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
      assert.equal(result, "$1.7000");
    });

    it("accumulates all token types across multiple usages", () => {
      // haiku: input=$1/M, output=$5/M, cacheRead=$0.25/M, cacheWrite=$1.25/M
      // usage1: 200_000 input + 100_000 output + 400_000 cacheRead + 200_000 cacheWrite
      //   = $0.20 + $0.50 + $0.10 + $0.25 = $1.05
      // usage2: 300_000 input + 100_000 output + 100_000 cacheRead + 400_000 cacheWrite
      //   = $0.30 + $0.50 + $0.025 + $0.50 = $1.325
      // total = $2.375
      const result = calculateSessionUsage("claude-haiku-4-5", [
        {
          inputTokens: 200_000,
          outputTokens: 100_000,
          cacheReadTokens: 400_000,
          cacheWriteTokens: 200_000,
        },
        {
          inputTokens: 300_000,
          outputTokens: 100_000,
          cacheReadTokens: 100_000,
          cacheWriteTokens: 400_000,
        },
      ]);
      assert.equal(result, "$2.3750");
    });
  });

  describe("calculateSessionUsage no pricing configured", () => {
    it("returns token counts for no usages", () => {
      const result = calculateSessionUsage("unknown-model", []);
      assert.equal(result, "0 in, 0 out");
    });

    it("returns token counts for usages with no pricing configured", () => {
      const result = calculateSessionUsage("unknown-model", [
        {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 25,
          cacheWriteTokens: 10,
        },
      ]);
      assert.equal(result, "100 in, 50 out");
    });
  });

  describe("fenceLog", () => {
    it("produces a single grey line with the label inline", () => {
      const written: string[] = [];
      const deps = {
        colorLog: (text: Uint8Array | string) => {
          written.push(text.toString());
        },
        getColumns: () => 80,
      };
      fenceLog("Output", deps);
      const output = written.join("");
      assert.ok(output.includes(" Output "));
      assert.ok(output.includes("─"));
      assert.ok(!output.includes("=".repeat(5)));
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

  describe("isSameKey", () => {
    it("returns true when all fields match", () => {
      assert.equal(
        isSameKey(
          { name: "e", ctrl: true, meta: false, shift: false },
          { name: "e", ctrl: true, meta: false, shift: false },
        ),
        true,
      );
    });

    it("returns false when name differs", () => {
      assert.equal(
        isSameKey(
          { name: "e", ctrl: true, meta: false, shift: false },
          { name: "x", ctrl: true, meta: false, shift: false },
        ),
        false,
      );
    });

    it("returns false when ctrl differs", () => {
      assert.equal(
        isSameKey(
          { name: "e", ctrl: true, meta: false, shift: false },
          { name: "e", ctrl: false, meta: false, shift: false },
        ),
        false,
      );
    });

    it("returns false when meta differs", () => {
      assert.equal(
        isSameKey(
          { name: "x", ctrl: false, meta: true, shift: false },
          { name: "x", ctrl: false, meta: false, shift: false },
        ),
        false,
      );
    });

    it("returns false when shift differs", () => {
      assert.equal(
        isSameKey(
          { name: "x", ctrl: false, meta: false, shift: true },
          { name: "x", ctrl: false, meta: false, shift: false },
        ),
        false,
      );
    });
  });
});
