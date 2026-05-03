/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-empty-function */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import {
  isAbortError,
  tryCatch,
  tryCatchAsync,
  calculateSessionUsage,
  normalizeLine,
  getMessageFromError,
  isSameKey,
  formatMarkdown,
  fencePrint,
  getAvailableSlashCommands,
  getRecursiveAgentsMdFilesStr,
  type FencePrintDeps,
  type GetAvailableSlashCommandsDeps,
  type GetRecursiveAgentsMdFilesStrDeps,
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

  describe("calculateSessionUsage", () => {
    it("known model with no usages returns $0.0000", () => {
      dispatch(actions.setModel("claude-haiku-4-5"));
      const result = calculateSessionUsage();
      assert.equal(result, "$0.0000");
    });

    it("calculates prompt token costs correctly", () => {
      // haiku: input=$1/M, 2_000_000 prompt = $2.0000
      dispatch(actions.setModel("claude-haiku-4-5"));
      dispatch(
        actions.appendToMessageUsages({
          inputTokens: 2_000_000,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }),
      );
      const result = calculateSessionUsage();
      assert.equal(result, "$2.0000");
    });

    it("calculates completion token costs correctly", () => {
      // haiku: output=$5/M, 600_000 completion = $3.0000
      dispatch(actions.setModel("claude-haiku-4-5"));
      dispatch(
        actions.appendToMessageUsages({
          inputTokens: 0,
          outputTokens: 600_000,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }),
      );
      const result = calculateSessionUsage();
      assert.equal(result, "$3.0000");
    });

    it("calculates cache read token costs correctly", () => {
      // haiku: cacheRead=$0.25/M
      // 1_000_000 cache read tokens = $0.25
      dispatch(actions.setModel("claude-haiku-4-5"));
      dispatch(
        actions.appendToMessageUsages({
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 1_000_000,
          cacheWriteTokens: 0,
        }),
      );
      const result = calculateSessionUsage();
      assert.equal(result, "$0.2500");
    });

    it("calculates cache write token costs correctly", () => {
      // haiku: cacheWrite=$1.25/M
      // 1_000_000 cache write tokens = $1.25
      dispatch(actions.setModel("claude-haiku-4-5"));
      dispatch(
        actions.appendToMessageUsages({
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 1_000_000,
        }),
      );
      const result = calculateSessionUsage();
      assert.equal(result, "$1.2500");
    });

    it("calculates combined input, output, and cache costs correctly", () => {
      // haiku: input=$1/M, output=$5/M, cacheRead=$0.25/M, cacheWrite=$1.25/M
      // 500_000 input + 200_000 output + 300_000 cacheRead + 100_000 cacheWrite
      // = $0.50 + $1.00 + $0.075 + $0.125 = $1.70
      dispatch(actions.setModel("claude-haiku-4-5"));
      dispatch(
        actions.appendToMessageUsages({
          inputTokens: 500_000,
          outputTokens: 200_000,
          cacheReadTokens: 300_000,
          cacheWriteTokens: 100_000,
        }),
      );
      const result = calculateSessionUsage();
      assert.equal(result, "$1.7000");
    });

    it("accumulates all token types across multiple usages", () => {
      // haiku: input=$1/M, output=$5/M, cacheRead=$0.25/M, cacheWrite=$1.25/M
      // usage1: 200_000 input + 100_000 output + 400_000 cacheRead + 200_000 cacheWrite
      //   = $0.20 + $0.50 + $0.10 + $0.25 = $1.05
      // usage2: 300_000 input + 100_000 output + 100_000 cacheRead + 400_000 cacheWrite
      //   = $0.30 + $0.50 + $0.025 + $0.50 = $1.325
      // total = $2.375
      dispatch(actions.setModel("claude-haiku-4-5"));
      dispatch(
        actions.appendToMessageUsages({
          inputTokens: 200_000,
          outputTokens: 100_000,
          cacheReadTokens: 400_000,
          cacheWriteTokens: 200_000,
        }),
      );
      dispatch(
        actions.appendToMessageUsages({
          inputTokens: 300_000,
          outputTokens: 100_000,
          cacheReadTokens: 100_000,
          cacheWriteTokens: 400_000,
        }),
      );
      const result = calculateSessionUsage();
      assert.equal(result, "$2.3750");
    });

    it("formats cost with commas for large totals", () => {
      // opus: input=$5/M
      // 200_000_000 input tokens = (200_000_000 * 5) / 1_000_000 = $1,000.0000
      dispatch(actions.setModel("claude-opus-4-6"));
      dispatch(
        actions.appendToMessageUsages({
          inputTokens: 200_000_000,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }),
      );
      const result = calculateSessionUsage();
      assert.equal(result, "$1,000.0000");
    });

    it("formats cost with commas for very large totals across multiple usages", () => {
      // opus: input=$5/M, output=$25/M
      // usage1: 300_000_000 input + 40_000_000 output = $1,500 + $1,000 = $2,500
      // usage2: 100_000_000 input + 80_000_000 output = $500 + $2,000 = $2,500
      // total = $5,000.0000
      dispatch(actions.setModel("claude-opus-4-6"));
      dispatch(
        actions.appendToMessageUsages({
          inputTokens: 300_000_000,
          outputTokens: 40_000_000,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }),
      );
      dispatch(
        actions.appendToMessageUsages({
          inputTokens: 100_000_000,
          outputTokens: 80_000_000,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }),
      );
      const result = calculateSessionUsage();
      assert.equal(result, "$5,000.0000");
    });
  });

  describe("calculateSessionUsage no pricing configured", () => {
    it("returns token counts for no usages", () => {
      dispatch(actions.setModel("unknown-model"));
      const result = calculateSessionUsage();
      assert.equal(result, "0 in, 0 out");
    });

    it("returns token counts for usages with no pricing configured", () => {
      dispatch(actions.setModel("unknown-model"));
      dispatch(
        actions.appendToMessageUsages({
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 25,
          cacheWriteTokens: 10,
        }),
      );
      const result = calculateSessionUsage();
      assert.equal(result, "100 in, 50 out");
    });

    it("formats token counts with commas for numbers above 999", () => {
      dispatch(actions.setModel("unknown-model"));
      dispatch(
        actions.appendToMessageUsages({
          inputTokens: 1_500,
          outputTokens: 2_500,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }),
      );
      const result = calculateSessionUsage();
      assert.equal(result, "1,500 in, 2,500 out");
    });

    it("formats token counts with commas for very large numbers", () => {
      dispatch(actions.setModel("unknown-model"));
      dispatch(
        actions.appendToMessageUsages({
          inputTokens: 1_234_567,
          outputTokens: 9_876_543,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }),
      );
      const result = calculateSessionUsage();
      assert.equal(result, "1,234,567 in, 9,876,543 out");
    });

    it("accumulates token counts across multiple usages and formats with commas", () => {
      dispatch(actions.setModel("unknown-model"));
      dispatch(
        actions.appendToMessageUsages({
          inputTokens: 50_000,
          outputTokens: 10_000,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }),
      );
      dispatch(
        actions.appendToMessageUsages({
          inputTokens: 75_000,
          outputTokens: 15_000,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }),
      );
      const result = calculateSessionUsage();
      assert.equal(result, "125,000 in, 25,000 out");
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

  describe("formatMarkdown", () => {
    it("formats markdown tables with aligned columns", async () => {
      const unaligned = "|a|b|\n|-|-|\n|x|y|";
      const result = await formatMarkdown(unaligned);
      assert.ok(result.includes("| a   | b   |"));
    });

    it("returns original content when formatting fails", async () => {
      const invalid = null as unknown as string;
      const result = await formatMarkdown(invalid);
      assert.equal(result, invalid);
    });
  });

  describe("fencePrint", () => {
    let captured: string[] = [];

    beforeEach(() => {
      captured = [];
    });

    function makeFencePrintDeps(
      overrides: Partial<FencePrintDeps> = {},
    ): FencePrintDeps {
      return {
        colorPrint: (text: string | Uint8Array) => {
          captured.push(text.toString());
        },
        ...overrides,
      };
    }

    it("truncates labels longer than 50 characters", () => {
      const longText = "a".repeat(60);
      fencePrint(longText, {}, makeFencePrintDeps());
      assert.deepStrictEqual(captured, [`── ${"a".repeat(46)}... ─`]);
    });

    it("does not truncate labels under 50 characters", () => {
      const shortText = "short label";
      fencePrint(shortText, {}, makeFencePrintDeps());
      assert.deepStrictEqual(captured, [
        `── short label (0 in, 0 out) ─────────────────────────`,
      ]);
    });
  });

  describe("getAvailableSlashCommands", () => {
    function makeDeps(
      overrides: Partial<GetAvailableSlashCommandsDeps> = {},
    ): GetAvailableSlashCommandsDeps {
      return {
        getCwd: () => "/test/project",
        existsSync: () => true,
        readdirSync: () => [],
        ...overrides,
      };
    }

    it("returns empty array when commands directory does not exist", () => {
      const deps = makeDeps({ existsSync: () => false });
      const result = getAvailableSlashCommands(deps);
      assert.deepStrictEqual(result, []);
    });

    it("returns empty array when readdir throws", () => {
      const deps = makeDeps({
        readdirSync: () => {
          throw new Error("permission denied");
        },
      });
      const result = getAvailableSlashCommands(deps);
      assert.deepStrictEqual(result, []);
    });

    it("returns empty array when commands directory is empty", () => {
      const deps = makeDeps({ readdirSync: () => [] });
      const result = getAvailableSlashCommands(deps);
      assert.deepStrictEqual(result, []);
    });

    it("returns command names without file extensions", () => {
      const deps = makeDeps({
        readdirSync: () => ["help.ts", "status.js", "deploy.mjs"],
      });
      const result = getAvailableSlashCommands(deps);
      assert.deepStrictEqual(result, ["help", "status", "deploy"]);
    });

    it("returns command names for files without extensions", () => {
      const deps = makeDeps({
        readdirSync: () => ["help", "status"],
      });
      const result = getAvailableSlashCommands(deps);
      assert.deepStrictEqual(result, ["help", "status"]);
    });

    it("uses cwd from deps to build path", () => {
      let capturedPath = "";
      const deps = makeDeps({
        getCwd: () => "/custom/project",
        existsSync: (path) => {
          capturedPath = path;
          return true;
        },
      });
      getAvailableSlashCommands(deps);
      assert.equal(capturedPath, "/custom/project/.agent-js/commands");
    });
  });

  describe("getRecursiveAgentsMdFilesStr", () => {
    function makeDeps(
      overrides: Partial<GetRecursiveAgentsMdFilesStrDeps> = {},
    ): GetRecursiveAgentsMdFilesStrDeps {
      return {
        glob: async function* () {},
        readFileSync: () => Buffer.from(""),
        debugLog: () => undefined,
        ...overrides,
      };
    }

    it("returns empty string when no AGENTS.md files found", async () => {
      const deps = makeDeps({
        glob: async function* () {},
      });
      const result = await getRecursiveAgentsMdFilesStr(deps);
      assert.equal(result, "");
    });

    it("returns formatted content for single file", async () => {
      const deps = makeDeps({
        glob: async function* () {
          yield "AGENTS.md";
        },
        readFileSync: () => Buffer.from("# Agent Instructions"),
      });
      const result = await getRecursiveAgentsMdFilesStr(deps);
      assert.equal(result, "FILEPATH: AGENTS.md\n# Agent Instructions");
    });

    it("returns formatted content for multiple files", async () => {
      const deps = makeDeps({
        glob: async function* () {
          yield "AGENTS.md";
          yield "src/AGENTS.md";
        },
        readFileSync: (path) => {
          if (path === "AGENTS.md") return Buffer.from("Root content");
          return Buffer.from("Src content");
        },
      });
      const result = await getRecursiveAgentsMdFilesStr(deps);
      assert.equal(
        result,
        "FILEPATH: AGENTS.md\nRoot content\nFILEPATH: src/AGENTS.md\nSrc content",
      );
    });

    it("skips files that fail to read", async () => {
      const deps = makeDeps({
        glob: async function* () {
          yield "AGENTS.md";
          yield "src/AGENTS.md";
        },
        readFileSync: (path) => {
          if (path === "AGENTS.md") throw new Error("Permission denied");
          return Buffer.from("Src content");
        },
      });
      const result = await getRecursiveAgentsMdFilesStr(deps);
      assert.equal(result, "FILEPATH: src/AGENTS.md\nSrc content");
    });
  });
});
