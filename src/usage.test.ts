import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert";
import {
  appendModelUsage,
  filterExpiredModelUsage,
  getExpiredTime,
  getPrettyContextWindowUsage,
  getPrettyTokenUsage,
  getPrettyUsage,
  getUsageMoneyForModel,
  isUsageLimitDisabled,
  sumUsageTokens,
  syncInitialModelUsageForLimitWindow,
  syncNewModelUsageForLimitWindow,
} from "./usage.ts";
import { actions, getState } from "./state.ts";
import { fsDeps } from "./deps.ts";
import { dirname } from "node:path";
import type { LanguageModelUsage } from "ai";
import { setupFakeDeps, testFs } from "./test-helpers.ts";
import { getUsageLogPath } from "./paths.ts";

describe("usage", () => {
  describe("getPrettyTokenUsage", () => {
    beforeEach(() => {
      setupFakeDeps();
      actions.resetState();
      actions.setPricingPerModel({
        "claude-haiku-4-5": {
          inputPerMillion: 1,
          outputPerMillion: 5,
          cacheReadPerMillion: 0.25,
          cacheWritePerMillion: 1.25,
        },
        "claude-sonnet-4-6": {
          inputPerMillion: 3,
          outputPerMillion: 15,
          cacheReadPerMillion: 0.75,
          cacheWritePerMillion: 3.75,
        },
        "claude-opus-4-6": {
          inputPerMillion: 5,
          outputPerMillion: 25,
          cacheReadPerMillion: 1.25,
          cacheWritePerMillion: 6.25,
        },
      });
      actions.setUsageLimitDuration("60m");
      actions.setUsageLimitDollar(10);
    });

    it("known model with no modelUsage returns $0.0000", () => {
      actions.setModel("claude-haiku-4-5");
      const result = getPrettyTokenUsage();
      assert.equal(result, "$0.000 in session, $0.000 of $10 limit");
    });

    it("calculates prompt token costs correctly", () => {
      // haiku: input=$1/M, 2_000_000 prompt = $2.0000
      actions.setModel("claude-haiku-4-5");

      appendModelUsage({
        inputTokens: 2_000_000,
        outputTokens: 0,
        inputTokenDetails: {
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      } as LanguageModelUsage);
      const result = getPrettyTokenUsage();
      assert.equal(result, "$2.000 in session, $2.000 of $10 limit");
    });

    it("calculates completion token costs correctly", () => {
      // haiku: output=$5/M, 600_000 completion = $3.0000
      actions.setModel("claude-haiku-4-5");
      appendModelUsage({
        inputTokens: 0,
        outputTokens: 600_000,
        inputTokenDetails: {
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      } as LanguageModelUsage);
      const result = getPrettyTokenUsage();
      assert.equal(result, "$3.000 in session, $3.000 of $10 limit");
    });

    it("calculates cache read token costs correctly", () => {
      // haiku: cacheRead=$0.25/M
      // 1_000_000 input tokens, all cache reads = $0.25
      actions.setModel("claude-haiku-4-5");
      appendModelUsage({
        inputTokens: 1_000_000,
        outputTokens: 0,
        inputTokenDetails: {
          cacheReadTokens: 1_000_000,
          cacheWriteTokens: 0,
        },
      } as LanguageModelUsage);
      const result = getPrettyTokenUsage();
      assert.equal(result, "$0.250 in session, $0.250 of $10 limit");
    });

    it("calculates cache write token costs correctly", () => {
      // haiku: cacheWrite=$1.25/M
      // 1_000_000 input tokens, all cache writes = $1.25
      actions.setModel("claude-haiku-4-5");
      appendModelUsage({
        inputTokens: 1_000_000,
        outputTokens: 0,
        inputTokenDetails: {
          cacheReadTokens: 0,
          cacheWriteTokens: 1_000_000,
        },
      } as LanguageModelUsage);
      const result = getPrettyTokenUsage();
      assert.equal(result, "$1.250 in session, $1.250 of $10 limit");
    });

    it("calculates combined input, output, and cache costs correctly", () => {
      // haiku: input=$1/M, output=$5/M, cacheRead=$0.25/M, cacheWrite=$1.25/M
      // 900_000 input (500_000 uncached + 300_000 cacheRead + 100_000 cacheWrite) + 200_000 output
      // = $0.50 + $1.00 + $0.075 + $0.125 = $1.70
      actions.setModel("claude-haiku-4-5");
      appendModelUsage({
        inputTokens: 900_000,
        outputTokens: 200_000,
        inputTokenDetails: {
          cacheReadTokens: 300_000,
          cacheWriteTokens: 100_000,
        },
      } as LanguageModelUsage);
      const result = getPrettyTokenUsage();
      assert.equal(result, "$1.700 in session, $1.700 of $10 limit");
    });

    it("shows cost against the dollar limit when configured", () => {
      actions.setModel("claude-haiku-4-5");
      actions.setUsageLimitDuration("60m");
      actions.setUsageLimitDollar(10);
      appendModelUsage({
        inputTokens: 900_000,
        outputTokens: 200_000,
        inputTokenDetails: {
          cacheReadTokens: 300_000,
          cacheWriteTokens: 100_000,
        },
      } as LanguageModelUsage);
      const result = getPrettyTokenUsage();
      assert.equal(result, "$1.700 in session, $1.700 of $10 limit");
    });

    it("shows session and limit window costs separately when they differ", () => {
      actions.setModel("claude-haiku-4-5");
      appendModelUsage({
        inputTokens: 900_000,
        outputTokens: 200_000,
        inputTokenDetails: {
          cacheReadTokens: 300_000,
          cacheWriteTokens: 100_000,
        },
      } as LanguageModelUsage);
      actions.setModelUsageForLimitWindow({
        "claude-haiku-4-5": [
          {
            inputTokens: 100_000,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            date: 1_000,
          },
        ],
      });
      const result = getPrettyTokenUsage();
      assert.equal(result, "$1.700 in session, $0.100 of $10 limit");
    });

    it("shows only session cost when the usage limit is disabled", () => {
      actions.setModel("claude-haiku-4-5");
      actions.setUsageLimitDuration(undefined);
      actions.setUsageLimitDollar(undefined);
      appendModelUsage({
        inputTokens: 900_000,
        outputTokens: 200_000,
        inputTokenDetails: {
          cacheReadTokens: 300_000,
          cacheWriteTokens: 100_000,
        },
      } as LanguageModelUsage);
      const result = getPrettyTokenUsage();
      assert.equal(result, "$1.700 in session");
    });

    it("accumulates all token types across multiple modelUsage", () => {
      // haiku: input=$1/M, output=$5/M, cacheRead=$0.25/M, cacheWrite=$1.25/M
      // usage1: 800_000 input (200_000 uncached + 400_000 cacheRead + 200_000 cacheWrite) + 100_000 output
      //   = $0.20 + $0.50 + $0.10 + $0.25 = $1.05
      // usage2: 1_600_000 input (500_000 uncached + 500_000 cacheRead + 600_000 cacheWrite) + 200_000 output
      //   = $0.50 + $1.00 + $0.125 + $0.75 = $2.375
      // total = $3.425
      actions.setModel("claude-haiku-4-5");
      appendModelUsage({
        inputTokens: 800_000,
        outputTokens: 100_000,
        inputTokenDetails: {
          cacheReadTokens: 400_000,
          cacheWriteTokens: 200_000,
        },
      } as LanguageModelUsage);
      appendModelUsage({
        inputTokens: 1_600_000,
        outputTokens: 200_000,
        inputTokenDetails: {
          cacheReadTokens: 500_000,
          cacheWriteTokens: 600_000,
        },
      } as LanguageModelUsage);
      const result = getPrettyTokenUsage();
      assert.equal(result, "$3.425 in session, $3.425 of $10 limit");
    });

    it("falls back to the input price when cache pricing is omitted", () => {
      actions.setPricingPerModel({
        "test-model": {
          inputPerMillion: 2,
          outputPerMillion: 10,
        },
      });
      actions.setModel("test-model");
      appendModelUsage({
        inputTokens: 2_000_000,
        outputTokens: 0,
        inputTokenDetails: {
          cacheReadTokens: 1_000_000,
          cacheWriteTokens: 500_000,
        },
      } as LanguageModelUsage);
      const result = getPrettyTokenUsage();
      assert.equal(result, "$4.000 in session, $4.000 of $10 limit");
    });

    it("formats cost with commas for large totals", () => {
      // opus: input=$5/M
      // 200_000_000 input tokens = (200_000_000 * 5) / 1_000_000 = $1,000.0000
      actions.setModel("claude-opus-4-6");
      appendModelUsage({
        inputTokens: 200_000_000,
        outputTokens: 0,
        inputTokenDetails: {
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      } as LanguageModelUsage);
      const result = getPrettyTokenUsage();
      assert.equal(result, "$1,000.000 in session, $1,000.000 of $10 limit");
    });

    it("formats cost with commas for very large totals across multiple modelUsage", () => {
      // opus: input=$5/M, output=$25/M
      // usage1: 300_000_000 input + 40_000_000 output = $1,500 + $1,000 = $2,500
      // usage2: 400_000_000 input + 120_000_000 output = $2,000 + $3,000 = $5,000
      // total = $7,500.000
      actions.setModel("claude-opus-4-6");
      appendModelUsage({
        inputTokens: 300_000_000,
        outputTokens: 40_000_000,
        inputTokenDetails: {
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      } as LanguageModelUsage);
      appendModelUsage({
        inputTokens: 400_000_000,
        outputTokens: 120_000_000,
        inputTokenDetails: {
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      } as LanguageModelUsage);
      const result = getPrettyTokenUsage();
      assert.equal(result, "$7,500.000 in session, $7,500.000 of $10 limit");
    });
  });

  describe("getPrettyTokenUsage no pricing configured", () => {
    beforeEach(() => {
      setupFakeDeps();
      actions.resetState();
    });

    it("returns token counts for no modelUsage", () => {
      actions.setModel("unknown-model");
      const result = getPrettyTokenUsage();
      assert.equal(result, "0 tokens in session");
    });

    it("returns token counts for modelUsage with no pricing configured", () => {
      actions.setModel("unknown-model");
      appendModelUsage({
        inputTokens: 100,
        outputTokens: 50,
        inputTokenDetails: {
          cacheReadTokens: 25,
          cacheWriteTokens: 10,
        },
      } as LanguageModelUsage);
      const result = getPrettyTokenUsage();
      assert.equal(result, "150 tokens in session");
    });

    it("formats token counts with commas for numbers above 999", () => {
      actions.setModel("unknown-model");
      appendModelUsage({
        inputTokens: 1_500,
        outputTokens: 2_500,
        inputTokenDetails: {
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      } as LanguageModelUsage);
      const result = getPrettyTokenUsage();
      assert.equal(result, "4,000 tokens in session");
    });

    it("formats token counts with commas for very large numbers", () => {
      actions.setModel("unknown-model");
      appendModelUsage({
        inputTokens: 1_234_567,
        outputTokens: 9_876_543,
        inputTokenDetails: {
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      } as LanguageModelUsage);
      const result = getPrettyTokenUsage();
      assert.equal(result, "11,111,110 tokens in session");
    });

    it("accumulates token counts across multiple modelUsage and formats with commas", () => {
      actions.setModel("unknown-model");
      appendModelUsage({
        inputTokens: 50_000,
        outputTokens: 10_000,
        inputTokenDetails: {
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      } as LanguageModelUsage);
      appendModelUsage({
        inputTokens: 125_000,
        outputTokens: 25_000,
        inputTokenDetails: {
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      } as LanguageModelUsage);
      const result = getPrettyTokenUsage();
      assert.equal(result, "210,000 tokens in session");
    });
  });

  describe("getPrettyContextWindowUsage", () => {
    beforeEach(() => {
      setupFakeDeps();
      actions.resetState();
    });

    it("returns empty string when the model has no context window configured", () => {
      actions.setModel("unknown-model");
      const result = getPrettyContextWindowUsage();
      assert.strictEqual(result, "");
    });

    it("returns 0% when no tokens are used", () => {
      actions.setModel("test-model");
      actions.setContextWindowPerModel({ "test-model": 10_000 });
      const result = getPrettyContextWindowUsage();
      assert.strictEqual(result, "0% of context window");
    });

    it("returns the percent of the context window used", () => {
      actions.setModel("test-model");
      actions.setContextWindowPerModel({ "test-model": 10_000 });
      actions.appendToMessageParams({ role: "user", content: "hi" }, 5_000);
      const result = getPrettyContextWindowUsage();
      assert.strictEqual(result, "50% of context window");
    });

    it("floors partial percents", () => {
      actions.setModel("test-model");
      actions.setContextWindowPerModel({ "test-model": 10_000 });
      actions.appendToMessageParams({ role: "user", content: "hi" }, 1_666);
      const result = getPrettyContextWindowUsage();
      assert.strictEqual(result, "16% of context window");
    });

    it("returns percents above 100", () => {
      actions.setModel("test-model");
      actions.setContextWindowPerModel({ "test-model": 10_000 });
      actions.appendToMessageParams({ role: "user", content: "hi" }, 15_000);
      const result = getPrettyContextWindowUsage();
      assert.strictEqual(result, "150% of context window");
    });
  });

  describe("getPrettyUsage", () => {
    beforeEach(() => {
      setupFakeDeps();
      actions.resetState();
    });

    it("returns just token usage when the model has no context window configured", () => {
      actions.setModel("unknown-model");
      const result = getPrettyUsage();
      assert.strictEqual(result, "0 tokens in session");
    });

    it("includes context window usage when configured", () => {
      actions.setModel("test-model");
      actions.setContextWindowPerModel({ "test-model": 10_000 });
      actions.appendToMessageParams({ role: "user", content: "hi" }, 5_000);
      const result = getPrettyUsage();
      assert.strictEqual(result, "0 tokens in session, 50% of context window");
    });
  });

  describe("appendModelUsage", () => {
    beforeEach(() => {
      setupFakeDeps();
      actions.resetState();
      actions.setModel("gpt-4");
      actions.setPricingPerModel({
        "gpt-4": {
          inputPerMillion: 1,
          outputPerMillion: 5,
          cacheReadPerMillion: 0.25,
          cacheWritePerMillion: 1.25,
        },
        claude: {
          inputPerMillion: 1,
          outputPerMillion: 5,
          cacheReadPerMillion: 0.25,
          cacheWritePerMillion: 1.25,
        },
      });
      actions.setUsageLimitDuration("60m");
      actions.setUsageLimitDollar(10);
    });

    it("appends the full usage on the first call", () => {
      mock.method(Date, "now", () => 1_000);

      appendModelUsage({
        inputTokens: 100,
        outputTokens: 50,
        inputTokenDetails: {
          cacheReadTokens: 10,
          cacheWriteTokens: 5,
        },
      } as LanguageModelUsage);

      const expectedUsage = {
        "gpt-4": [
          {
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 10,
            cacheWriteTokens: 5,
            date: 1_000,
          },
        ],
      };
      assert.deepStrictEqual(
        getState().app.modelUsageForLimitWindow,
        expectedUsage,
      );
      assert.deepStrictEqual(
        getState().app.modelUsageForSession,
        expectedUsage,
      );
    });

    it("appends the full usage on subsequent calls", () => {
      let now = 1_000;
      mock.method(Date, "now", () => now);

      appendModelUsage({
        inputTokens: 100,
        outputTokens: 50,
        inputTokenDetails: {
          cacheReadTokens: 10,
          cacheWriteTokens: 5,
        },
      } as LanguageModelUsage);

      now = 2_000;
      appendModelUsage({
        inputTokens: 150,
        outputTokens: 80,
        inputTokenDetails: {
          cacheReadTokens: 20,
          cacheWriteTokens: 10,
        },
      } as LanguageModelUsage);

      const expectedUsage = {
        "gpt-4": [
          {
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 10,
            cacheWriteTokens: 5,
            date: 1_000,
          },
          {
            inputTokens: 150,
            outputTokens: 80,
            cacheReadTokens: 20,
            cacheWriteTokens: 10,
            date: 2_000,
          },
        ],
      };
      assert.deepStrictEqual(
        getState().app.modelUsageForLimitWindow,
        expectedUsage,
      );
      assert.deepStrictEqual(
        getState().app.modelUsageForSession,
        expectedUsage,
      );
    });

    it("tracks different models separately", () => {
      let now = 1_000;
      mock.method(Date, "now", () => now);

      appendModelUsage({
        inputTokens: 100,
        outputTokens: 50,
        inputTokenDetails: {
          cacheReadTokens: 10,
          cacheWriteTokens: 5,
        },
      } as LanguageModelUsage);

      now = 2_000;
      actions.setModel("claude");
      appendModelUsage({
        inputTokens: 30,
        outputTokens: 15,
        inputTokenDetails: {
          cacheReadTokens: 3,
          cacheWriteTokens: 1,
        },
      } as LanguageModelUsage);

      const expectedUsage = {
        "gpt-4": [
          {
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 10,
            cacheWriteTokens: 5,
            date: 1_000,
          },
        ],
        claude: [
          {
            inputTokens: 30,
            outputTokens: 15,
            cacheReadTokens: 3,
            cacheWriteTokens: 1,
            date: 2_000,
          },
        ],
      };
      assert.deepStrictEqual(
        getState().app.modelUsageForLimitWindow,
        expectedUsage,
      );
      assert.deepStrictEqual(
        getState().app.modelUsageForSession,
        expectedUsage,
      );
    });

    it("defaults missing token detail values to 0", () => {
      mock.method(Date, "now", () => 1_000);

      appendModelUsage({
        inputTokens: 100,
        outputTokens: 50,
        inputTokenDetails: {
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
      } as LanguageModelUsage);

      const expectedUsage = {
        "gpt-4": [
          {
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            date: 1_000,
          },
        ],
      };
      assert.deepStrictEqual(
        getState().app.modelUsageForLimitWindow,
        expectedUsage,
      );
      assert.deepStrictEqual(
        getState().app.modelUsageForSession,
        expectedUsage,
      );
    });

    it("appends to session usage only when the usage limit is disabled", () => {
      mock.method(Date, "now", () => 1_000);
      actions.setPricingPerModel({});
      actions.setUsageLimitDuration(undefined);
      actions.setUsageLimitDollar(undefined);

      appendModelUsage({
        inputTokens: 100,
        outputTokens: 50,
        inputTokenDetails: {
          cacheReadTokens: 10,
          cacheWriteTokens: 5,
        },
      } as LanguageModelUsage);

      assert.deepStrictEqual(getState().app.modelUsageForSession, {
        "gpt-4": [
          {
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 10,
            cacheWriteTokens: 5,
            date: 1_000,
          },
        ],
      });
      assert.deepStrictEqual(getState().app.modelUsageForLimitWindow, {});
      assert.strictEqual(testFs._files.has(getUsageLogPath()), false);
    });
  });

  describe("syncNewModelUsageForLimitWindow", () => {
    beforeEach(() => {
      setupFakeDeps();
      actions.resetState();
      actions.setModel("gpt-4");
      actions.setPricingPerModel({
        "gpt-4": {
          inputPerMillion: 1,
          outputPerMillion: 5,
          cacheReadPerMillion: 0.25,
          cacheWritePerMillion: 1.25,
        },
      });
      actions.setUsageLimitDuration("60m");
      actions.setUsageLimitDollar(10);
      mock.method(Date, "now", () => 4_000_000);
    });

    it("creates the usage log directory and writes the usage entry", () => {
      const usage = {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 1,
        cacheWriteTokens: 0,
        date: 500_000,
      };

      syncNewModelUsageForLimitWindow("gpt-4", usage);

      assert.deepStrictEqual(getState().app.modelUsageForLimitWindow, {
        "gpt-4": [usage],
      });
      assert.deepStrictEqual(getState().app.modelUsageForSession, {});
      assert.strictEqual(
        testFs._files.get(getUsageLogPath()),
        `{
  "gpt-4": [
    {
      "inputTokens": 10,
      "outputTokens": 5,
      "cacheReadTokens": 1,
      "cacheWriteTokens": 0,
      "date": 500000
    }
  ]
}`,
      );
    });

    it("appends to an existing usage log", () => {
      testFs._files.set(
        getUsageLogPath(),
        `{
  "gpt-4": [
    {
      "inputTokens": 5,
      "outputTokens": 2,
      "cacheReadTokens": 0,
      "cacheWriteTokens": 0,
      "date": 500000
    }
  ]
}`,
      );
      const usage = {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 1,
        cacheWriteTokens: 0,
        date: 1_000_000,
      };

      syncNewModelUsageForLimitWindow("gpt-4", usage);

      assert.deepStrictEqual(getState().app.modelUsageForLimitWindow, {
        "gpt-4": [
          {
            inputTokens: 5,
            outputTokens: 2,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            date: 500_000,
          },
          usage,
        ],
      });
      assert.strictEqual(
        testFs._files.get(getUsageLogPath()),
        `{
  "gpt-4": [
    {
      "inputTokens": 5,
      "outputTokens": 2,
      "cacheReadTokens": 0,
      "cacheWriteTokens": 0,
      "date": 500000
    },
    {
      "inputTokens": 10,
      "outputTokens": 5,
      "cacheReadTokens": 1,
      "cacheWriteTokens": 0,
      "date": 1000000
    }
  ]
}`,
      );
    });

    it("overwrites a malformed usage log with the new entry", () => {
      testFs._files.set(getUsageLogPath(), "not-json");
      const usage = {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 1,
        cacheWriteTokens: 0,
        date: 500_000,
      };

      syncNewModelUsageForLimitWindow("gpt-4", usage);

      assert.deepStrictEqual(getState().app.modelUsageForLimitWindow, {
        "gpt-4": [usage],
      });
      assert.strictEqual(
        testFs._files.get(getUsageLogPath()),
        `{
  "gpt-4": [
    {
      "inputTokens": 10,
      "outputTokens": 5,
      "cacheReadTokens": 1,
      "cacheWriteTokens": 0,
      "date": 500000
    }
  ]
}`,
      );
    });

    it("appends to state even when the write fails", () => {
      mock.method(fsDeps, "writeFileSync", () => {
        throw new Error("write failed");
      });
      const usage = {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 1,
        cacheWriteTokens: 0,
        date: 500_000,
      };

      syncNewModelUsageForLimitWindow("gpt-4", usage);

      assert.deepStrictEqual(getState().app.modelUsageForLimitWindow, {
        "gpt-4": [usage],
      });
    });

    it("does nothing when the usage limit is disabled", () => {
      actions.setPricingPerModel({});
      actions.setUsageLimitDuration(undefined);
      actions.setUsageLimitDollar(undefined);
      const usage = {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 1,
        cacheWriteTokens: 0,
        date: 1_000,
      };

      syncNewModelUsageForLimitWindow("gpt-4", usage);

      assert.deepStrictEqual(getState().app.modelUsageForLimitWindow, {});
      assert.strictEqual(testFs._files.has(getUsageLogPath()), false);
    });

    it("does nothing when the model has no pricing configured", () => {
      actions.setPricingPerModel({});
      const usage = {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 1,
        cacheWriteTokens: 0,
        date: 500_000,
      };

      syncNewModelUsageForLimitWindow("gpt-4", usage);

      assert.deepStrictEqual(getState().app.modelUsageForLimitWindow, {});
      assert.strictEqual(testFs._files.has(getUsageLogPath()), false);
    });

    it("filters expired entries from the log and state", () => {
      testFs._files.set(
        getUsageLogPath(),
        JSON.stringify({
          "gpt-4": [
            {
              inputTokens: 5,
              outputTokens: 2,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              date: 500_000,
            },
            {
              inputTokens: 7,
              outputTokens: 3,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              date: 300_000,
            },
          ],
        }),
      );
      const usage = {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 1,
        cacheWriteTokens: 0,
        date: 1_000_000,
      };

      syncNewModelUsageForLimitWindow("gpt-4", usage);

      assert.deepStrictEqual(getState().app.modelUsageForLimitWindow, {
        "gpt-4": [
          {
            inputTokens: 5,
            outputTokens: 2,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            date: 500_000,
          },
          usage,
        ],
      });
      assert.strictEqual(
        testFs._files.get(getUsageLogPath()),
        JSON.stringify({
          "gpt-4": [
            {
              inputTokens: 5,
              outputTokens: 2,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              date: 500_000,
            },
            usage,
          ],
        }),
      );
    });

    it("keeps usage exactly at the duration boundary", () => {
      testFs._files.set(
        getUsageLogPath(),
        JSON.stringify({
          "gpt-4": [
            {
              inputTokens: 5,
              outputTokens: 2,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              date: 400_000,
            },
          ],
        }),
      );
      const usage = {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 1,
        cacheWriteTokens: 0,
        date: 1_000_000,
      };

      syncNewModelUsageForLimitWindow("gpt-4", usage);

      assert.deepStrictEqual(getState().app.modelUsageForLimitWindow, {
        "gpt-4": [
          {
            inputTokens: 5,
            outputTokens: 2,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            date: 400_000,
          },
          usage,
        ],
      });
    });

    it("drops models whose entries are all expired", () => {
      testFs._files.set(
        getUsageLogPath(),
        JSON.stringify({
          "gpt-4": [
            {
              inputTokens: 5,
              outputTokens: 2,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              date: 500_000,
            },
          ],
          claude: [
            {
              inputTokens: 5,
              outputTokens: 2,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              date: 100_000,
            },
          ],
        }),
      );
      const usage = {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 1,
        cacheWriteTokens: 0,
        date: 1_000_000,
      };

      syncNewModelUsageForLimitWindow("gpt-4", usage);

      assert.deepStrictEqual(getState().app.modelUsageForLimitWindow, {
        "gpt-4": [
          {
            inputTokens: 5,
            outputTokens: 2,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            date: 500_000,
          },
          usage,
        ],
      });
    });
  });

  describe("syncInitialModelUsageForLimitWindow", () => {
    beforeEach(() => {
      setupFakeDeps();
      actions.resetState();
      actions.setModel("gpt-4");
      actions.setPricingPerModel({
        "gpt-4": {
          inputPerMillion: 1,
          outputPerMillion: 5,
          cacheReadPerMillion: 0.25,
          cacheWritePerMillion: 1.25,
        },
      });
      actions.setUsageLimitDollar(10);
    });

    it("does nothing when all usage limit options are undefined", () => {
      actions.setPricingPerModel({});
      actions.setUsageLimitDuration(undefined);
      actions.setUsageLimitDollar(undefined);

      syncInitialModelUsageForLimitWindow();

      assert.deepStrictEqual(getState().app.modelUsageForLimitWindow, {});
    });

    it("does nothing when the model has no pricing configured", () => {
      actions.setPricingPerModel({});
      actions.setUsageLimitDuration("60m");
      testFs._dirs.add(dirname(getUsageLogPath()));
      testFs._files.set(
        getUsageLogPath(),
        JSON.stringify({
          "gpt-4": [
            {
              inputTokens: 10,
              outputTokens: 5,
              cacheReadTokens: 1,
              cacheWriteTokens: 0,
              date: 500,
            },
          ],
        }),
      );

      syncInitialModelUsageForLimitWindow();

      assert.deepStrictEqual(getState().app.modelUsageForLimitWindow, {});
      assert.strictEqual(testFs._files.has(getUsageLogPath()), true);
    });

    it("does nothing when the usage log directory does not exist", () => {
      actions.setUsageLimitDuration("60m");

      syncInitialModelUsageForLimitWindow();

      assert.deepStrictEqual(getState().app.modelUsageForLimitWindow, {});
    });

    it("filters modelUsage according to each duration suffix", () => {
      const now = 1_000_000_000;
      const cases = [
        ["100s", 100_000],
        ["10m", 600_000],
        ["2h", 7_200_000],
        ["3d", 259_200_000],
      ] as const;

      for (const [duration, windowMs] of cases) {
        actions.resetState();
        actions.setModel("gpt-4");
        actions.setPricingPerModel({
          "gpt-4": {
            inputPerMillion: 1,
            outputPerMillion: 5,
            cacheReadPerMillion: 0.25,
            cacheWritePerMillion: 1.25,
          },
        });
        actions.setUsageLimitDuration(duration);
        actions.setUsageLimitDollar(10);
        const recent = {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 1,
          cacheWriteTokens: 0,
          date: now - windowMs + 1,
        };
        const expired = {
          inputTokens: 5,
          outputTokens: 2,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          date: now - windowMs - 1,
        };
        testFs._dirs.add(dirname(getUsageLogPath()));
        testFs._files.set(
          getUsageLogPath(),
          JSON.stringify({ "gpt-4": [recent, expired] }),
        );
        mock.method(Date, "now", () => now);

        syncInitialModelUsageForLimitWindow();

        assert.deepStrictEqual(getState().app.modelUsageForLimitWindow, {
          "gpt-4": [recent],
        });
        assert.strictEqual(
          testFs._files.get(getUsageLogPath()),
          JSON.stringify({ "gpt-4": [recent] }),
        );
      }
    });

    it("keeps modelUsage exactly at the duration boundary", () => {
      actions.setUsageLimitDuration("60m");
      const boundary = {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 1,
        cacheWriteTokens: 0,
        date: 400_000,
      };
      testFs._dirs.add(dirname(getUsageLogPath()));
      testFs._files.set(
        getUsageLogPath(),
        JSON.stringify({ "gpt-4": [boundary] }),
      );
      mock.method(Date, "now", () => 4_000_000);

      syncInitialModelUsageForLimitWindow();

      assert.deepStrictEqual(getState().app.modelUsageForLimitWindow, {
        "gpt-4": [boundary],
      });
      assert.strictEqual(
        testFs._files.get(getUsageLogPath()),
        JSON.stringify({ "gpt-4": [boundary] }),
      );
    });

    it("overwrites a malformed usage log with an empty object", () => {
      actions.setUsageLimitDuration("60m");
      testFs._dirs.add(dirname(getUsageLogPath()));
      testFs._files.set(getUsageLogPath(), "not-json");

      syncInitialModelUsageForLimitWindow();

      assert.deepStrictEqual(getState().app.modelUsageForLimitWindow, {});
      assert.strictEqual(testFs._files.get(getUsageLogPath()), `{}`);
    });
  });

  describe("isUsageLimitDisabled", () => {
    beforeEach(() => {
      setupFakeDeps();
      actions.resetState();
    });

    it("returns true when the model has no pricing configured", () => {
      actions.setModel("unknown-model");
      assert.strictEqual(isUsageLimitDisabled(), true);
    });

    it("returns true when the usage limit duration is undefined", () => {
      actions.setModel("gpt-4");
      actions.setPricingPerModel({
        "gpt-4": {
          inputPerMillion: 1,
          outputPerMillion: 5,
        },
      });
      actions.setUsageLimitDollar(10);
      assert.strictEqual(isUsageLimitDisabled(), true);
    });

    it("returns true when the usage limit dollar is undefined", () => {
      actions.setModel("gpt-4");
      actions.setPricingPerModel({
        "gpt-4": {
          inputPerMillion: 1,
          outputPerMillion: 5,
        },
      });
      actions.setUsageLimitDuration("60m");
      assert.strictEqual(isUsageLimitDisabled(), true);
    });

    it("returns false when pricing, duration, and dollar are configured", () => {
      actions.setModel("gpt-4");
      actions.setPricingPerModel({
        "gpt-4": {
          inputPerMillion: 1,
          outputPerMillion: 5,
        },
      });
      actions.setUsageLimitDuration("60m");
      actions.setUsageLimitDollar(10);
      assert.strictEqual(isUsageLimitDisabled(), false);
    });
  });

  describe("filterExpiredModelUsage", () => {
    it("returns an empty object for an empty map", () => {
      const result = filterExpiredModelUsage({}, 100);
      assert.deepStrictEqual(result, {});
    });

    it("keeps entries at or after the expired time and drops older ones", () => {
      const map = {
        "gpt-4": [
          {
            inputTokens: 1,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            date: 100,
          },
          {
            inputTokens: 2,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            date: 200,
          },
        ],
      };
      const result = filterExpiredModelUsage(map, 150);
      assert.deepStrictEqual(result, {
        "gpt-4": [map["gpt-4"][1]],
      });
    });

    it("drops models whose entries are all expired", () => {
      const map = {
        "gpt-4": [
          {
            inputTokens: 1,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            date: 100,
          },
        ],
        claude: [
          {
            inputTokens: 2,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            date: 200,
          },
        ],
      };
      const result = filterExpiredModelUsage(map, 150);
      assert.deepStrictEqual(result, {
        claude: [map.claude[0]],
      });
    });
  });

  describe("getExpiredTime", () => {
    beforeEach(() => {
      setupFakeDeps();
      actions.resetState();
      mock.method(Date, "now", () => 1_000_000);
    });

    it("throws when the usage limit duration is undefined", () => {
      actions.setUsageLimitDuration(undefined);
      assert.throws(() => getExpiredTime(), /usageLimitDuration/);
    });

    it("computes the expired time for seconds", () => {
      actions.setUsageLimitDuration("100s");
      assert.strictEqual(getExpiredTime(), 1_000_000 - 100_000);
    });

    it("computes the expired time for minutes", () => {
      actions.setUsageLimitDuration("10m");
      assert.strictEqual(getExpiredTime(), 1_000_000 - 600_000);
    });

    it("computes the expired time for hours", () => {
      actions.setUsageLimitDuration("2h");
      assert.strictEqual(getExpiredTime(), 1_000_000 - 7_200_000);
    });

    it("computes the expired time for days", () => {
      actions.setUsageLimitDuration("3d");
      assert.strictEqual(getExpiredTime(), 1_000_000 - 259_200_000);
    });
  });

  describe("getUsageMoneyForModel", () => {
    beforeEach(() => {
      setupFakeDeps();
      actions.resetState();
      actions.setModel("gpt-4");
      actions.setPricingPerModel({
        "gpt-4": {
          inputPerMillion: 1,
          outputPerMillion: 5,
          cacheReadPerMillion: 0.25,
          cacheWritePerMillion: 1.25,
        },
      });
    });

    it("throws when the model has no pricing configured", () => {
      actions.setPricingPerModel({});
      assert.throws(
        () =>
          getUsageMoneyForModel(
            {
              inputTokens: 1,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
            },
            "gpt-4",
          ),
        /pricing/,
      );
    });

    it("computes the total cost from all token types", () => {
      const result = getUsageMoneyForModel(
        {
          inputTokens: 900_000,
          outputTokens: 200_000,
          cacheReadTokens: 300_000,
          cacheWriteTokens: 100_000,
        },
        "gpt-4",
      );
      assert.strictEqual(result, 1.7);
    });

    it("falls back to the input price when cache pricing is omitted", () => {
      actions.setPricingPerModel({
        "gpt-4": {
          inputPerMillion: 2,
          outputPerMillion: 10,
        },
      });
      const result = getUsageMoneyForModel(
        {
          inputTokens: 2_000_000,
          outputTokens: 0,
          cacheReadTokens: 1_000_000,
          cacheWriteTokens: 500_000,
        },
        "gpt-4",
      );
      assert.strictEqual(result, 4);
    });
  });

  describe("sumUsageTokens", () => {
    it("returns all zeros for an empty array", () => {
      const result = sumUsageTokens([]);
      assert.deepStrictEqual(result, {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });
    });

    it("sums all token types across multiple entries", () => {
      const result = sumUsageTokens([
        {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 10,
          cacheWriteTokens: 5,
          date: 1_000,
        },
        {
          inputTokens: 150,
          outputTokens: 80,
          cacheReadTokens: 20,
          cacheWriteTokens: 10,
          date: 2_000,
        },
      ]);
      assert.deepStrictEqual(result, {
        inputTokens: 250,
        outputTokens: 130,
        cacheReadTokens: 30,
        cacheWriteTokens: 15,
      });
    });
  });
});
