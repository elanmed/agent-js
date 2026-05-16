import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert";
import { formatMarkdown, calculateSessionUsage, executeBat } from "./print.ts";
import { dispatch, actions } from "./state.ts";
import { processDeps, childProcessDeps } from "./deps.ts";
import { stripAnsi } from "./test-helpers.ts";

describe("print", () => {
  describe("formatMarkdown", () => {
    it("formats markdown tables with aligned columns", async () => {
      const unaligned = `|a|b|
|-|-|
|x|y|`;
      const result = await formatMarkdown(unaligned);
      assert.strictEqual(
        result,
        `| a   | b   |
| --- | --- |
| x   | y   |
`,
      );
    });

    it("returns original content when formatting fails", async () => {
      const invalid = null as unknown as string;
      const result = await formatMarkdown(invalid);
      assert.equal(result, invalid);
    });
  });

  describe("calculateSessionUsage", () => {
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
    beforeEach(() => {
      dispatch(actions.resetState());
    });

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

      describe("executeBat", () => {
        beforeEach(() => {
          mock.restoreAll();
          dispatch(actions.resetState());
          dispatch(actions.setModel("test-model"));
        });

        it("formats markdown and outputs the content through bat when available", async () => {
          let captured = "";
          mock.method(processDeps.stdout, "write", (out: string) => {
            captured += out;
          });

          await executeBat("# Hello\n");

          assert.strictEqual(stripAnsi(captured), "# Hello\n\n");
        });

        it("falls back to plain text when bat is not available", async () => {
          mock.method(
            childProcessDeps,
            "exec",
            (
              _cmd: string,
              cb: (error: Error | null, ...args: string[]) => void,
            ) => {
              cb(new Error("not found"), "", "");
            },
          );

          let captured = "";
          mock.method(processDeps.stdout, "write", (out: string) => {
            captured += out;
          });

          await executeBat("test content\n");

          assert.strictEqual(
            stripAnsi(captured),
            `\`bat\` is not available, falling back to plain text rendering
test content

`,
          );
        });

        it("falls back to plain text when bat spawn fails", async () => {
          mock.method(childProcessDeps, "spawnSync", () => {
            throw new Error("spawn failed");
          });

          let captured = "";
          mock.method(processDeps.stdout, "write", (out: string) => {
            captured += out;
          });

          await executeBat("test content\n");

          assert.strictEqual(stripAnsi(captured), "test content\n\n");
        });
      });
      const result = calculateSessionUsage();
      assert.equal(result, "125,000 in, 25,000 out");
    });
  });
});
