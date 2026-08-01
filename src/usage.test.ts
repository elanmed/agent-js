import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert";
import {
  appendModelUsage,
  getPrettySessionUsage,
  syncInitialModelUsage,
  syncNewModelUsage,
} from "./usage.ts";
import { actions, getState } from "./state.ts";
import { fsDeps } from "./deps.ts";
import { dirname } from "node:path";
import type { LanguageModelUsage } from "ai";
import { setupFakeDeps, testFs } from "./test-helpers.ts";
import { getUsageLogPath } from "./paths.ts";

describe("usage", () => {
  describe("getPrettySessionUsage", () => {
    beforeEach(() => {
      setupFakeDeps();
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
      actions.setUsageLimitDuration("60m");
      actions.setUsageLimitDollar(10);
    });

    it("known model with no modelUsage returns $0.0000", () => {
      actions.setModel("claude-haiku-4-5");
      const result = getPrettySessionUsage();
      assert.equal(result, "$0.000 of $10");
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
      const result = getPrettySessionUsage();
      assert.equal(result, "$2.000 of $10");
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
      const result = getPrettySessionUsage();
      assert.equal(result, "$3.000 of $10");
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
      const result = getPrettySessionUsage();
      assert.equal(result, "$0.250 of $10");
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
      const result = getPrettySessionUsage();
      assert.equal(result, "$1.250 of $10");
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
      const result = getPrettySessionUsage();
      assert.equal(result, "$1.700 of $10");
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
      const result = getPrettySessionUsage();
      assert.equal(result, "$1.700 of $10");
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
      const result = getPrettySessionUsage();
      assert.equal(result, "$3.425 of $10");
    });

    it("falls back to the input price when cache pricing is omitted", () => {
      actions.setPricingPerModel({
        "test-model": {
          inputPerToken: 2,
          outputPerToken: 10,
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
      const result = getPrettySessionUsage();
      assert.equal(result, "$4.000 of $10");
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
      const result = getPrettySessionUsage();
      assert.equal(result, "$1,000.000 of $10");
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
      const result = getPrettySessionUsage();
      assert.equal(result, "$7,500.000 of $10");
    });
  });

  describe("getPrettySessionUsage no pricing configured", () => {
    beforeEach(() => {
      setupFakeDeps();
      actions.resetState();
    });

    it("returns token counts for no modelUsage", () => {
      actions.setModel("unknown-model");
      const result = getPrettySessionUsage();
      assert.equal(result, "0 in, 0 out");
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
      const result = getPrettySessionUsage();
      assert.equal(result, "100 in, 50 out");
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
      const result = getPrettySessionUsage();
      assert.equal(result, "1,500 in, 2,500 out");
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
      const result = getPrettySessionUsage();
      assert.equal(result, "1,234,567 in, 9,876,543 out");
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
      const result = getPrettySessionUsage();
      assert.equal(result, "175,000 in, 35,000 out");
    });
  });

  describe("appendModelUsage", () => {
    beforeEach(() => {
      setupFakeDeps();
      actions.resetState();
      actions.setModel("gpt-4");
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

      assert.deepStrictEqual(getState().app.modelUsage, {
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

      assert.deepStrictEqual(getState().app.modelUsage, {
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
      });
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

      assert.deepStrictEqual(getState().app.modelUsage, {
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
      });
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

      assert.deepStrictEqual(getState().app.modelUsage, {
        "gpt-4": [
          {
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            date: 1_000,
          },
        ],
      });
    });
  });

  describe("syncNewModelUsage", () => {
    beforeEach(() => {
      setupFakeDeps();
      actions.resetState();
      actions.setModel("gpt-4");
      actions.setPricingPerModel({
        "gpt-4": {
          inputPerToken: 1,
          outputPerToken: 5,
          cacheReadPerToken: 0.25,
          cacheWritePerToken: 1.25,
        },
      });
      actions.setUsageLimitDuration("60m");
      actions.setUsageLimitDollar(10);
    });

    it("creates the usage log directory and writes the usage entry", () => {
      const usage = {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 1,
        cacheWriteTokens: 0,
        date: 1_000,
      };

      syncNewModelUsage("gpt-4", usage);

      assert.deepStrictEqual(getState().app.modelUsage, {
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
      "date": 1000
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
      "date": 500
    }
  ]
}`,
      );
      const usage = {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 1,
        cacheWriteTokens: 0,
        date: 1_000,
      };

      syncNewModelUsage("gpt-4", usage);

      assert.deepStrictEqual(getState().app.modelUsage, {
        "gpt-4": [
          {
            inputTokens: 5,
            outputTokens: 2,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            date: 500,
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
      "date": 500
    },
    {
      "inputTokens": 10,
      "outputTokens": 5,
      "cacheReadTokens": 1,
      "cacheWriteTokens": 0,
      "date": 1000
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
        date: 1_000,
      };

      syncNewModelUsage("gpt-4", usage);

      assert.deepStrictEqual(getState().app.modelUsage, {
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
      "date": 1000
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
        date: 1_000,
      };

      syncNewModelUsage("gpt-4", usage);

      assert.deepStrictEqual(getState().app.modelUsage, {
        "gpt-4": [usage],
      });
    });

    it("appends to state without writing when the usage limit is disabled", () => {
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

      syncNewModelUsage("gpt-4", usage);

      assert.deepStrictEqual(getState().app.modelUsage, {
        "gpt-4": [usage],
      });
      assert.strictEqual(testFs._files.has(getUsageLogPath()), false);
    });

    it("appends to state without writing when the model has no pricing configured", () => {
      actions.setPricingPerModel({});
      const usage = {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 1,
        cacheWriteTokens: 0,
        date: 1_000,
      };

      syncNewModelUsage("gpt-4", usage);

      assert.deepStrictEqual(getState().app.modelUsage, {
        "gpt-4": [usage],
      });
      assert.strictEqual(testFs._files.has(getUsageLogPath()), false);
    });
  });

  describe("syncInitialModelUsage", () => {
    beforeEach(() => {
      setupFakeDeps();
      actions.resetState();
      actions.setModel("gpt-4");
      actions.setPricingPerModel({
        "gpt-4": {
          inputPerToken: 1,
          outputPerToken: 5,
          cacheReadPerToken: 0.25,
          cacheWritePerToken: 1.25,
        },
      });
      actions.setUsageLimitDollar(10);
    });

    it("does nothing when all usage limit options are undefined", () => {
      actions.setPricingPerModel({});
      actions.setUsageLimitDuration(undefined);
      actions.setUsageLimitDollar(undefined);

      syncInitialModelUsage();

      assert.deepStrictEqual(getState().app.modelUsage, {});
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

      syncInitialModelUsage();

      assert.deepStrictEqual(getState().app.modelUsage, {});
      assert.strictEqual(testFs._files.has(getUsageLogPath()), true);
    });

    it("does nothing when the usage log directory does not exist", () => {
      actions.setUsageLimitDuration("60m");

      syncInitialModelUsage();

      assert.deepStrictEqual(getState().app.modelUsage, {});
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
            inputPerToken: 1,
            outputPerToken: 5,
            cacheReadPerToken: 0.25,
            cacheWritePerToken: 1.25,
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

        syncInitialModelUsage();

        assert.deepStrictEqual(getState().app.modelUsage, {
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

      syncInitialModelUsage();

      assert.deepStrictEqual(getState().app.modelUsage, {
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

      syncInitialModelUsage();

      assert.deepStrictEqual(getState().app.modelUsage, {});
      assert.strictEqual(testFs._files.get(getUsageLogPath()), `{}`);
    });
  });
});
