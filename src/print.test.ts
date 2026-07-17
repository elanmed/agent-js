import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert";
import {
  formatMarkdown,
  calculateSessionUsage,
  calculateApiDuration,
  executeBat,
  startLoadingState,
  stopLoadingState,
  colorPrint,
  flushAndStopLoadingState,
} from "./print.ts";
import { actions, getState } from "./state.ts";
import { processDeps } from "./deps.ts";
import childProcess from "node:child_process";
import { stripAnsi, mockExec } from "./test-helpers.ts";

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

  describe("startLoadingState", () => {
    it("writes loadingStateFrames cyclically", async () => {
      actions.resetState();
      const callbacks: (() => void)[] = [];
      mock.method(globalThis, "setInterval", (cb: () => void) => {
        callbacks.push(cb);
        return {} as ReturnType<typeof setInterval>;
      });
      mock.method(globalThis, "clearInterval", () => {
        callbacks.length = 0;
      });
      actions.setLoadingStateFrames(["a", "b", "c"]);
      let captured = "";
      mock.method(processDeps.stdout, "write", (out: string) => {
        captured += out;
      });

      startLoadingState();
      callbacks.forEach((cb) => cb());
      callbacks.forEach((cb) => cb());
      callbacks.forEach((cb) => cb());
      callbacks.forEach((cb) => cb());
      const stopPromise = stopLoadingState();
      callbacks.forEach((cb) => cb());
      callbacks.forEach((cb) => cb());
      await stopPromise;

      assert.strictEqual(captured, "\ra\rb\rc\ra\rb\rc\ra\r \r");
    });

    it("uses default loadingStateFrames when none set", async () => {
      actions.resetState();
      const callbacks: (() => void)[] = [];
      mock.method(globalThis, "setInterval", (cb: () => void) => {
        callbacks.push(cb);
        return {} as ReturnType<typeof setInterval>;
      });
      mock.method(globalThis, "clearInterval", () => {
        callbacks.length = 0;
      });
      let captured = "";
      mock.method(processDeps.stdout, "write", (out: string) => {
        captured += out;
      });

      startLoadingState();
      callbacks.forEach((cb) => cb());
      callbacks.forEach((cb) => cb());
      const stopPromise = stopLoadingState();
      callbacks.forEach((cb) => cb());
      callbacks.forEach((cb) => cb());
      await stopPromise;

      assert.strictEqual(captured, "\r|\r/\r-\r\\\r|\r \r");
    });

    it("stopLoadingState gracefully handles multiple calls", async () => {
      actions.resetState();
      const callbacks: (() => void)[] = [];
      mock.method(globalThis, "setInterval", (cb: () => void) => {
        callbacks.push(cb);
        return {} as ReturnType<typeof setInterval>;
      });
      mock.method(globalThis, "clearInterval", () => {
        callbacks.length = 0;
      });
      mock.method(processDeps.stdout, "write", () => undefined);
      actions.setLoadingStateFrames(["a", "b", "c"]);

      startLoadingState();
      callbacks.forEach((cb) => cb());

      const stop1 = stopLoadingState();
      const stop2 = stopLoadingState();
      assert.strictEqual(stop1, stop2);

      callbacks.forEach((cb) => cb());
      callbacks.forEach((cb) => cb());
      await stop1;
      await stop2;
    });

    it("serializes concurrent colorPrint calls", async () => {
      actions.resetState();
      const callbacks: (() => void)[] = [];
      mock.method(globalThis, "setInterval", (cb: () => void) => {
        callbacks.push(cb);
        return callbacks.length as unknown as ReturnType<typeof setInterval>;
      });
      mock.method(globalThis, "clearInterval", () => {
        callbacks.length = 0;
      });
      mock.method(processDeps.stdout, "write", () => undefined);
      actions.setLoadingStateFrames(["a", "b", "c"]);

      startLoadingState();
      callbacks.forEach((cb) => cb());

      const p1 = colorPrint("X");
      const p2 = colorPrint("Y");
      const p3 = colorPrint("Z");

      await new Promise((r) => setTimeout(r, 0));

      callbacks.forEach((cb) => cb());
      callbacks.forEach((cb) => cb());

      await Promise.all([p1, p2, p3]);

      assert.strictEqual(getState().app.stdout, "X\nY\nZ\n");
    });

    it("flushAndStopLoadingState drains queue then stops spinner", async () => {
      actions.resetState();
      const callbacks: (() => void)[] = [];
      mock.method(globalThis, "setInterval", (cb: () => void) => {
        callbacks.push(cb);
        return callbacks.length as unknown as ReturnType<typeof setInterval>;
      });
      mock.method(globalThis, "clearInterval", () => {
        callbacks.length = 0;
      });
      mock.method(processDeps.stdout, "write", () => undefined);
      actions.setLoadingStateFrames(["a", "b", "c"]);

      startLoadingState();
      callbacks.forEach((cb) => cb());

      const printPromise = colorPrint("X");
      const flushPromise = flushAndStopLoadingState();

      await new Promise((r) => setTimeout(r, 0));

      callbacks.forEach((cb) => cb());
      callbacks.forEach((cb) => cb());

      await Promise.all([printPromise, flushPromise]);

      assert.strictEqual(getState().app.loadingStateTimeout, null);
      assert.strictEqual(getState().app.loadingStateFrameIdx, 0);
      assert.strictEqual(getState().app.stdout, "X\n");
    });
  });

  describe("calculateApiDuration", () => {
    beforeEach(() => {
      actions.resetState();
    });

    it("formats sub-second duration as milliseconds", () => {
      mock.method(Date, "now", () => 1_000);
      actions.setApiStartTime();
      mock.method(Date, "now", () => 1_500);
      actions.setApiEndTime();
      const result = calculateApiDuration();
      assert.strictEqual(result, "500ms");
    });

    it("formats seconds and milliseconds", () => {
      mock.method(Date, "now", () => 1_000);
      actions.setApiStartTime();
      mock.method(Date, "now", () => 6_500);
      actions.setApiEndTime();
      const result = calculateApiDuration();
      assert.strictEqual(result, "5s 500ms");
    });

    it("formats minutes, seconds, and milliseconds", () => {
      mock.method(Date, "now", () => 1_000);
      actions.setApiStartTime();
      mock.method(Date, "now", () => 126_500);
      actions.setApiEndTime();
      const result = calculateApiDuration();
      assert.strictEqual(result, "2m 5s 500ms");
    });
  });

  describe("calculateSessionUsage", () => {
    beforeEach(() => {
      actions.resetState();
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
      });
    });

    it("known model with no usages returns $0.0000", () => {
      actions.setModel("claude-haiku-4-5");
      const result = calculateSessionUsage();
      assert.equal(result, "$0.0000");
    });

    it("calculates prompt token costs correctly", () => {
      // haiku: input=$1/M, 2_000_000 prompt = $2.0000
      actions.setModel("claude-haiku-4-5");

      actions.appendToMessageUsages({
        inputTokens: 2_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });
      const result = calculateSessionUsage();
      assert.equal(result, "$2.0000");
    });

    it("calculates completion token costs correctly", () => {
      // haiku: output=$5/M, 600_000 completion = $3.0000
      actions.setModel("claude-haiku-4-5");
      actions.appendToMessageUsages({
        inputTokens: 0,
        outputTokens: 600_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });
      const result = calculateSessionUsage();
      assert.equal(result, "$3.0000");
    });

    it("calculates cache read token costs correctly", () => {
      // haiku: cacheRead=$0.25/M
      // 1_000_000 cache read tokens = $0.25
      actions.setModel("claude-haiku-4-5");
      actions.appendToMessageUsages({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 0,
      });
      const result = calculateSessionUsage();
      assert.equal(result, "$0.2500");
    });

    it("calculates cache write token costs correctly", () => {
      // haiku: cacheWrite=$1.25/M
      // 1_000_000 cache write tokens = $1.25
      actions.setModel("claude-haiku-4-5");
      actions.appendToMessageUsages({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 1_000_000,
      });
      const result = calculateSessionUsage();
      assert.equal(result, "$1.2500");
    });

    it("calculates combined input, output, and cache costs correctly", () => {
      // haiku: input=$1/M, output=$5/M, cacheRead=$0.25/M, cacheWrite=$1.25/M
      // 500_000 input + 200_000 output + 300_000 cacheRead + 100_000 cacheWrite
      // = $0.50 + $1.00 + $0.075 + $0.125 = $1.70
      actions.setModel("claude-haiku-4-5");
      actions.appendToMessageUsages({
        inputTokens: 500_000,
        outputTokens: 200_000,
        cacheReadTokens: 300_000,
        cacheWriteTokens: 100_000,
      });
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
      actions.setModel("claude-haiku-4-5");
      actions.appendToMessageUsages({
        inputTokens: 200_000,
        outputTokens: 100_000,
        cacheReadTokens: 400_000,
        cacheWriteTokens: 200_000,
      });
      actions.appendToMessageUsages({
        inputTokens: 300_000,
        outputTokens: 100_000,
        cacheReadTokens: 100_000,
        cacheWriteTokens: 400_000,
      });
      const result = calculateSessionUsage();
      assert.equal(result, "$2.3750");
    });

    it("formats cost with commas for large totals", () => {
      // opus: input=$5/M
      // 200_000_000 input tokens = (200_000_000 * 5) / 1_000_000 = $1,000.0000
      actions.setModel("claude-opus-4-6");
      actions.appendToMessageUsages({
        inputTokens: 200_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });
      const result = calculateSessionUsage();
      assert.equal(result, "$1,000.0000");
    });

    it("formats cost with commas for very large totals across multiple usages", () => {
      // opus: input=$5/M, output=$25/M
      // usage1: 300_000_000 input + 40_000_000 output = $1,500 + $1,000 = $2,500
      // usage2: 100_000_000 input + 80_000_000 output = $500 + $2,000 = $2,500
      // total = $5,000.0000
      actions.setModel("claude-opus-4-6");
      actions.appendToMessageUsages({
        inputTokens: 300_000_000,
        outputTokens: 40_000_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });
      actions.appendToMessageUsages({
        inputTokens: 100_000_000,
        outputTokens: 80_000_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });
      const result = calculateSessionUsage();
      assert.equal(result, "$5,000.0000");
    });
  });

  describe("calculateSessionUsage no pricing configured", () => {
    beforeEach(() => {
      actions.resetState();
    });

    it("returns token counts for no usages", () => {
      actions.setModel("unknown-model");
      const result = calculateSessionUsage();
      assert.equal(result, "0 in, 0 out");
    });

    it("returns token counts for usages with no pricing configured", () => {
      actions.setModel("unknown-model");
      actions.appendToMessageUsages({
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 25,
        cacheWriteTokens: 10,
      });
      const result = calculateSessionUsage();
      assert.equal(result, "100 in, 50 out");
    });

    it("formats token counts with commas for numbers above 999", () => {
      actions.setModel("unknown-model");
      actions.appendToMessageUsages({
        inputTokens: 1_500,
        outputTokens: 2_500,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });
      const result = calculateSessionUsage();
      assert.equal(result, "1,500 in, 2,500 out");
    });

    it("formats token counts with commas for very large numbers", () => {
      actions.setModel("unknown-model");
      actions.appendToMessageUsages({
        inputTokens: 1_234_567,
        outputTokens: 9_876_543,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });
      const result = calculateSessionUsage();
      assert.equal(result, "1,234,567 in, 9,876,543 out");
    });

    it("accumulates token counts across multiple usages and formats with commas", () => {
      actions.setModel("unknown-model");
      actions.appendToMessageUsages({
        inputTokens: 50_000,
        outputTokens: 10_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });
      actions.appendToMessageUsages({
        inputTokens: 75_000,
        outputTokens: 15_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });

      describe("executeBat", () => {
        beforeEach(() => {
          mock.restoreAll();
          actions.resetState();
          actions.setModel("test-model");
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
          mockExec({ stdout: "", error: new Error("not found") });

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
          mock.method(childProcess, "spawnSync", () => {
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
