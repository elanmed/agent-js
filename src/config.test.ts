import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert";
import { getState } from "./state.ts";
import {
  initState,
  initStateForDebug,
  defaultConfig,
  ConfigSchema,
  DefaultedConfigSchema,
} from "./config.ts";
import {
  getGlobalConfigPath,
  getLocalConfigPath,
  getGlobalContextDir,
  getUsageLogPath,
} from "./paths.ts";
import { testFs, setupTestContext } from "./test-helpers.ts";
import { parseCliArgsDeps } from "./args.ts";
import { dirname } from "node:path";

const testConfig = {
  model: "claude-sonnet-4-6",
  baseURL: "https://api.example.com",
};

describe("config", () => {
  beforeEach(() => {
    setupTestContext();
    mock.method(parseCliArgsDeps, "getArgv", () => ["node", "script.js"]);
  });

  it("ConfigSchema and DefaultedConfigSchema have the same keys", () => {
    assert.deepStrictEqual(
      Object.keys(ConfigSchema.shape).sort(),
      Object.keys(DefaultedConfigSchema.shape).sort(),
    );
  });

  describe("when local config exists", () => {
    it("uses its model over the global config, default config", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...testConfig,
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...testConfig,
          model: "claude-haiku-4-5",
        }),
      );

      await initState();

      assert.equal(getState().config.model, "claude-haiku-4-5");
    });

    it("uses its provider over the global config, default config", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          model: testConfig.model,
          provider: "openai-compatible",
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          model: testConfig.model,
          provider: "anthropic",
        }),
      );

      await initState();

      assert.equal(getState().config.provider, "anthropic");
    });

    it("merges pricingPerModel per model, local overriding global", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...testConfig,
          model: "test-model",
          pricingPerModel: {
            "global-model": {
              inputPerMillion: 1,
              outputPerMillion: 2,
            },
            "shared-model": {
              inputPerMillion: 10,
              outputPerMillion: 20,
            },
          },
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...testConfig,
          model: "test-model",
          pricingPerModel: {
            "local-model": {
              inputPerMillion: 3,
              outputPerMillion: 4,
            },
            "shared-model": {
              inputPerMillion: 30,
              outputPerMillion: 40,
            },
          },
        }),
      );

      await initState();

      assert.deepEqual(getState().config.pricingPerModel, {
        "global-model": {
          inputPerMillion: 1,
          outputPerMillion: 2,
        },
        "shared-model": {
          inputPerMillion: 30,
          outputPerMillion: 40,
        },
        "local-model": {
          inputPerMillion: 3,
          outputPerMillion: 4,
        },
      });
    });

    it("merges contextWindowPerModel per model, local overriding global", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...testConfig,
          contextWindowPerModel: {
            "global-model": 100_000,
            "shared-model": 200_000,
          },
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...testConfig,
          contextWindowPerModel: {
            "local-model": 300_000,
            "shared-model": 400_000,
          },
        }),
      );

      await initState();

      assert.deepEqual(getState().config.contextWindowPerModel, {
        "global-model": 100_000,
        "shared-model": 400_000,
        "local-model": 300_000,
      });
    });

    it("uses its compactAtContextRatio over the global config, default config", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...testConfig,
          compactAtContextRatio: 0.8,
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...testConfig,
          compactAtContextRatio: 0.5,
        }),
      );

      await initState();

      assert.strictEqual(getState().config.compactAtContextRatio, 0.5);
    });

    it("uses its compactTargetRatio over the global config, default config", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...testConfig,
          compactTargetRatio: 0.4,
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...testConfig,
          compactTargetRatio: 0.25,
        }),
      );

      await initState();

      assert.strictEqual(getState().config.compactTargetRatio, 0.25);
    });

    it("uses its keymaps over the global config, default config", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...testConfig,
          keymaps: {
            edit: { name: "v", ctrl: false, meta: false, shift: false },
            paste: { name: "p", ctrl: false, meta: false, shift: false },
            history: { name: "o", ctrl: false, meta: false, shift: false },
            clear: { name: "j", ctrl: false, meta: false, shift: false },
          },
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...testConfig,
          keymaps: {
            edit: { name: "e", ctrl: true, meta: false, shift: false },
            paste: { name: "t", ctrl: true, meta: false, shift: false },
            history: { name: "l", ctrl: true, meta: false, shift: false },
            clear: { name: "k", ctrl: true, meta: false, shift: false },
          },
        }),
      );

      await initState();

      assert.deepEqual(getState().config.keymaps.edit, {
        name: "e",
        ctrl: true,
        meta: false,
        shift: false,
      });
      assert.deepEqual(getState().config.keymaps.paste, {
        name: "t",
        ctrl: true,
        meta: false,
        shift: false,
      });
      assert.deepEqual(getState().config.keymaps.history, {
        name: "l",
        ctrl: true,
        meta: false,
        shift: false,
      });
      assert.deepEqual(getState().config.keymaps.clear, {
        name: "k",
        ctrl: true,
        meta: false,
        shift: false,
      });
    });

    it("uses its customSlashCommandDirs over the global config, default config", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...testConfig,
          customSlashCommandDirs: ["/global-dir"],
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...testConfig,
          customSlashCommandDirs: ["/local-dir"],
        }),
      );

      await initState();

      assert.deepStrictEqual(getState().config.customSlashCommandDirs, [
        "/local-dir",
      ]);
    });

    it("uses its customSkillDirs over the global config, default config", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...testConfig,
          customSkillDirs: ["/global-skills"],
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...testConfig,
          customSkillDirs: ["/local-skills"],
        }),
      );

      await initState();

      assert.deepStrictEqual(getState().config.customSkillDirs, [
        "/local-skills",
      ]);
    });

    it("uses its loadingStateFrames over the global config, default config", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...testConfig,
          loadingStateFrames: ["⣾", "⣽", "⣻", "⢿"],
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...testConfig,
          loadingStateFrames: ["⠋", "⠙", "⠹", "⠸"],
        }),
      );

      await initState();

      assert.deepStrictEqual(getState().config.loadingStateFrames, [
        "⠋",
        "⠙",
        "⠹",
        "⠸",
      ]);
    });

    it("uses its loadingStateFrameDuration over the global config, default config", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...testConfig,
          loadingStateFrameDuration: 100,
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...testConfig,
          loadingStateFrameDuration: 200,
        }),
      );

      await initState();

      assert.strictEqual(getState().config.loadingStateFrameDuration, 200);
    });

    it("uses its promptPrefix over the global config, default config", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...testConfig,
          promptPrefix: "> ",
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...testConfig,
          promptPrefix: "🤖 ",
        }),
      );

      await initState();

      assert.strictEqual(getState().config.promptPrefix, "🤖 ");
    });

    it("uses its usageLimit over the global config, default config", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...testConfig,
          usageLimit: { duration: "2h", dollarAmount: 10 },
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...testConfig,
          usageLimit: { duration: "60m", dollarAmount: 20 },
        }),
      );

      await initState();

      assert.deepStrictEqual(getState().config.usageLimit, {
        duration: "60m",
        dollarAmount: 20,
      });
    });

    it("falls back to global usageLimit when local omits it", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...testConfig,
          usageLimit: { duration: "2h", dollarAmount: 10 },
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...testConfig,
        }),
      );

      await initState();

      assert.deepStrictEqual(getState().config.usageLimit, {
        duration: "2h",
        dollarAmount: 10,
      });
    });

    it("rejects config with an unknown key", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...testConfig,
          contextPerModel: { "deepseek-v4-flash-free": 4000 },
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...testConfig,
        }),
      );

      await assert.rejects(initState(), /Unrecognized key/);
    });

    it("rejects usageLimit without duration", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...testConfig,
          usageLimit: { dollarAmount: 10 },
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...testConfig,
        }),
      );

      await assert.rejects(initState(), /Invalid input: expected string/);
    });

    it("rejects usageLimit without dollarAmount", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...testConfig,
          usageLimit: { duration: "2h" },
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...testConfig,
        }),
      );

      await assert.rejects(initState(), /Invalid input: expected number/);
    });

    it("rejects non-string usageLimit.duration", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...testConfig,
          usageLimit: { duration: 3_600_000, dollarAmount: 10 },
        }),
      );

      await assert.rejects(initState(), /Invalid input: expected string/);
    });

    it("rejects usageLimit.duration with an invalid suffix", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...testConfig,
          usageLimit: { duration: "10x", dollarAmount: 10 },
        }),
      );

      await assert.rejects(
        initState(),
        /usageLimit\.duration must be of the format/,
      );
    });

    it("rejects usageLimit.duration without a suffix", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...testConfig,
          usageLimit: { duration: "3600000", dollarAmount: 10 },
        }),
      );

      await assert.rejects(
        initState(),
        /usageLimit\.duration must be of the format/,
      );
    });

    it("rejects usageLimit.duration with a non-numeric prefix", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...testConfig,
          usageLimit: { duration: "abch", dollarAmount: 10 },
        }),
      );

      await assert.rejects(
        initState(),
        /usageLimit\.duration must be of the format/,
      );
    });

    it("rejects non-number usageLimit.dollarAmount", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...testConfig,
          usageLimit: { duration: "2h", dollarAmount: "five" },
        }),
      );

      await assert.rejects(initState(), /Invalid input: expected number/);
    });

    it("rejects compactAtContextRatio above 1", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...testConfig,
          compactAtContextRatio: 1.5,
        }),
      );

      await assert.rejects(initState(), /Too big: expected number to be <=1/);
    });

    it("rejects compactAtContextRatio below 0", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...testConfig,
          compactAtContextRatio: -0.1,
        }),
      );

      await assert.rejects(initState(), /Too small: expected number to be >=0/);
    });

    it("rejects non-number compactAtContextRatio", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...testConfig,
          compactAtContextRatio: "half",
        }),
      );

      await assert.rejects(initState(), /Invalid input: expected number/);
    });

    it("rejects compactTargetRatio above 1", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...testConfig,
          compactTargetRatio: 1.5,
        }),
      );

      await assert.rejects(initState(), /Too big: expected number to be <=1/);
    });

    it("rejects compactTargetRatio below 0", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...testConfig,
          compactTargetRatio: -0.1,
        }),
      );

      await assert.rejects(initState(), /Too small: expected number to be >=0/);
    });

    it("rejects non-number compactTargetRatio", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...testConfig,
          compactTargetRatio: "half",
        }),
      );

      await assert.rejects(initState(), /Invalid input: expected number/);
    });

    it("merges partial keymaps with defaults", async () => {
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...testConfig,
          keymaps: {
            edit: { name: "v", ctrl: false, meta: false, shift: false },
          },
        }),
      );

      await initState();

      assert.deepEqual(getState().config.keymaps.edit, {
        name: "v",
        ctrl: false,
        meta: false,
        shift: false,
      });
      assert.deepEqual(
        getState().config.keymaps.paste,
        defaultConfig.keymaps.paste,
      );
      assert.deepEqual(
        getState().config.keymaps.history,
        defaultConfig.keymaps.history,
      );
      assert.deepEqual(
        getState().config.keymaps.clear,
        defaultConfig.keymaps.clear,
      );
    });
  });

  describe("when local config does not exist", () => {
    describe("when the global config exists", () => {
      it("uses its model over the default config", async () => {
        testFs._files.set(
          getGlobalConfigPath(),
          JSON.stringify({
            ...testConfig,
            model: "claude-haiku-4-5",
          }),
        );

        await initState();
        assert.equal(getState().config.model, "claude-haiku-4-5");
      });

      it("uses its provider over the default config", async () => {
        testFs._files.set(
          getGlobalConfigPath(),
          JSON.stringify({
            model: testConfig.model,
            provider: "anthropic",
          }),
        );

        await initState();
        assert.equal(getState().config.provider, "anthropic");
      });

      it("throws when baseURL is provided with anthropic provider", async () => {
        testFs._files.set(
          getGlobalConfigPath(),
          JSON.stringify({
            model: testConfig.model,
            provider: "anthropic",
            baseURL: "https://api.example.com",
          }),
        );

        await assert.rejects(
          initState(),
          /A `baseURL` cannot be provided when `provider=anthropic`/,
        );
      });

      it("uses its pricingPerModel over the default config", async () => {
        const globalPricing = structuredClone(defaultConfig.pricingPerModel);
        globalPricing["test-model"] = {
          inputPerMillion: 999,
          outputPerMillion: 0,
          cacheReadPerMillion: 0,
          cacheWritePerMillion: 0,
        };

        testFs._files.set(
          getGlobalConfigPath(),
          JSON.stringify({
            ...testConfig,
            model: "test-model",
            pricingPerModel: globalPricing,
            usageLimit: { duration: "60m", dollarAmount: 10 },
          }),
        );

        await initState();
        assert.deepEqual(getState().config.pricingPerModel, globalPricing);
      });

      it("uses its keymaps over the default config", async () => {
        testFs._files.set(
          getGlobalConfigPath(),
          JSON.stringify({
            ...testConfig,
            keymaps: {
              edit: { name: "v", ctrl: false, meta: false, shift: false },
              paste: { name: "p", ctrl: false, meta: false, shift: false },
              history: {
                name: "o",
                ctrl: false,
                meta: false,
                shift: false,
              },
              clear: { name: "j", ctrl: false, meta: false, shift: false },
            },
          }),
        );

        await initState();

        assert.deepEqual(getState().config.keymaps.edit, {
          name: "v",
          ctrl: false,
          meta: false,
          shift: false,
        });
        assert.deepEqual(getState().config.keymaps.paste, {
          name: "p",
          ctrl: false,
          meta: false,
          shift: false,
        });
        assert.deepEqual(getState().config.keymaps.history, {
          name: "o",
          ctrl: false,
          meta: false,
          shift: false,
        });
        assert.deepEqual(getState().config.keymaps.clear, {
          name: "j",
          ctrl: false,
          meta: false,
          shift: false,
        });
      });

      it("uses its loadingStateFrames over the default config", async () => {
        testFs._files.set(
          getGlobalConfigPath(),
          JSON.stringify({
            ...testConfig,
            loadingStateFrames: ["⣾", "⣽", "⣻", "⢿"],
          }),
        );

        await initState();

        assert.deepStrictEqual(getState().config.loadingStateFrames, [
          "⣾",
          "⣽",
          "⣻",
          "⢿",
        ]);
      });

      it("uses its loadingStateFrameDuration over the default config", async () => {
        testFs._files.set(
          getGlobalConfigPath(),
          JSON.stringify({
            ...testConfig,
            loadingStateFrameDuration: 150,
          }),
        );

        await initState();

        assert.strictEqual(getState().config.loadingStateFrameDuration, 150);
      });

      it("uses its promptPrefix over the default config", async () => {
        testFs._files.set(
          getGlobalConfigPath(),
          JSON.stringify({
            ...testConfig,
            promptPrefix: "❯ ",
          }),
        );

        await initState();

        assert.strictEqual(getState().config.promptPrefix, "❯ ");
      });

      it("uses its usageLimit over the default config", async () => {
        testFs._files.set(
          getGlobalConfigPath(),
          JSON.stringify({
            ...testConfig,
            usageLimit: { duration: "2h", dollarAmount: 20 },
          }),
        );

        await initState();

        assert.deepStrictEqual(getState().config.usageLimit, {
          duration: "2h",
          dollarAmount: 20,
        });
      });

      it("uses undefined usageLimit when global config omits it", async () => {
        testFs._files.set(
          getGlobalConfigPath(),
          JSON.stringify({
            ...testConfig,
          }),
        );

        await initState();

        assert.strictEqual(getState().config.usageLimit, undefined);
      });

      it("uses its customSkillDirs over the default config", async () => {
        testFs._files.set(
          getGlobalConfigPath(),
          JSON.stringify({
            ...testConfig,
            customSkillDirs: ["/global-skills"],
          }),
        );

        await initState();

        assert.deepStrictEqual(getState().config.customSkillDirs, [
          "/global-skills",
        ]);
      });
    });

    describe("when the global config does not exist", () => {
      it("throws when model is not configured", async () => {
        await assert.rejects(
          initState(),
          /Invalid input: expected string, received undefined/,
        );
      });

      it("throws when baseURL is not configured for openai-compatible provider", async () => {
        testFs._files.set(
          getGlobalConfigPath(),
          JSON.stringify({ model: "some-model" }),
        );
        await assert.rejects(
          initState(),
          /A `baseURL` is required when `provider=openai-compatible`/,
        );
      });
    });
  });

  it("throws when loadingStateFrames have unequal lengths", async () => {
    testFs._files.set(
      getGlobalConfigPath(),
      JSON.stringify({
        ...testConfig,
        loadingStateFrames: ["..", "...", ".."],
      }),
    );

    await assert.rejects(
      initState(),
      /All loadingStateFrames strings must be the same length/,
    );
  });

  it("throws when loadingStateFrames has fewer than 2 entries", async () => {
    testFs._files.set(
      getGlobalConfigPath(),
      JSON.stringify({
        ...testConfig,
        loadingStateFrames: [".."],
      }),
    );

    await assert.rejects(
      initState(),
      /loadingStateFrames must be at least length 2/,
    );
  });

  it("throws when loadingStateFrames is empty", async () => {
    testFs._files.set(
      getGlobalConfigPath(),
      JSON.stringify({
        ...testConfig,
        loadingStateFrames: [],
      }),
    );

    await assert.rejects(
      initState(),
      /loadingStateFrames must be at least length 2/,
    );
  });

  it("accepts loadingStateFrames with equal-length entries", async () => {
    testFs._files.set(
      getGlobalConfigPath(),
      JSON.stringify({
        ...testConfig,
        loadingStateFrames: ["..", "..", ".."],
      }),
    );

    await initState();
    assert.deepStrictEqual(getState().config.loadingStateFrames, [
      "..",
      "..",
      "..",
    ]);
  });

  it("throws on invalid YAML in global config", async () => {
    testFs._files.set(getGlobalConfigPath(), "key: [unclosed");

    await assert.rejects(
      initState(),
      /Failed to parse config at \/fake-home\/\.config\/agent-js\/settings\.yaml as YAML/,
    );
  });

  it("throws on invalid YAML in local config", async () => {
    testFs._files.set(getLocalConfigPath(), "key: [unclosed");

    await assert.rejects(
      initState(),
      /Failed to parse config at \/test-cwd\/\.agent-js\/settings\.yaml as YAML/,
    );
  });

  it("sets debug from args", async () => {
    mock.method(parseCliArgsDeps, "getArgv", () => [
      "node",
      "script.js",
      "--debug",
    ]);
    testFs._files.set(
      getGlobalConfigPath(),
      JSON.stringify({
        ...testConfig,
      }),
    );

    await initState();
    assert.equal(getState().app.debugLog, true);
  });

  it("sets contextStr from dep", async () => {
    testFs._dirs.add(getGlobalContextDir());
    testFs._globResults.set(
      "/fake-home/.config/agent-js/context/**/AGENTS.md",
      ["/fake-home/.config/agent-js/context/AGENTS.md"],
    );
    testFs._files.set("/fake-home/.config/agent-js/context/AGENTS.md", "hello");
    testFs._files.set(
      getGlobalConfigPath(),
      JSON.stringify({
        ...testConfig,
      }),
    );

    await initState();
    assert.equal(
      getState().app.contextStr,
      `\nAGENTS.md context files:\nPath: /fake-home/.config/agent-js/context/AGENTS.md\nContent: hello\n`,
    );
  });

  it("sets skillsStr from dep", async () => {
    testFs._files.set(
      getGlobalConfigPath(),
      JSON.stringify({
        ...testConfig,
      }),
    );

    await initState();
    assert.equal(getState().app.skillsStr, "");
  });

  it("sets modelUsageForLimitWindow to an empty object", async () => {
    testFs._files.set(
      getGlobalConfigPath(),
      JSON.stringify({
        ...testConfig,
      }),
    );

    await initState();
    assert.deepStrictEqual(getState().app.modelUsageForLimitWindow, {});
    assert.deepStrictEqual(getState().app.modelUsageForSession, {});
  });

  it("loads recent model usages from the usage log", async () => {
    const recent = {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 1,
      cacheWriteTokens: 0,
      date: 500_000,
    };
    const expired = {
      inputTokens: 5,
      outputTokens: 2,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      date: 300_000,
    };
    testFs._dirs.add(dirname(getUsageLogPath()));
    testFs._files.set(
      getUsageLogPath(),
      JSON.stringify({ "gpt-4": [recent, expired] }),
    );
    testFs._files.set(
      getGlobalConfigPath(),
      JSON.stringify({
        ...testConfig,
        usageLimit: { duration: "60m", dollarAmount: 10 },
        pricingPerModel: {
          "claude-sonnet-4-6": {
            inputPerMillion: 3,
            outputPerMillion: 15,
            cacheReadPerMillion: 0.75,
            cacheWritePerMillion: 3.75,
          },
        },
      }),
    );
    mock.method(Date, "now", () => 4_000_000);

    await initState();

    assert.deepStrictEqual(getState().app.modelUsageForLimitWindow, {
      "gpt-4": [recent],
    });
  });

  it("sets sessionStartDate", async () => {
    mock.method(Date, "now", () => 1_234);
    testFs._files.set(
      getGlobalConfigPath(),
      JSON.stringify({
        ...testConfig,
      }),
    );

    await initState();
    assert.strictEqual(getState().app.sessionStartDate, 1_234);
  });

  describe("initStateForDebug", () => {
    it("sets debug flag and path when --debug is passed", () => {
      mock.method(parseCliArgsDeps, "getArgv", () => [
        "node",
        "script.js",
        "--debug",
      ]);

      initStateForDebug();

      assert.strictEqual(getState().app.debugLog, true);
      assert.strictEqual(
        getState().app.debugLogPath,
        "/fake-home/.config/agent-js/debug/debug-test-uuid.log",
      );
    });

    it("keeps debug flag off when --debug is not passed", () => {
      initStateForDebug();

      assert.strictEqual(getState().app.debugLog, false);
      assert.strictEqual(
        getState().app.debugLogPath,
        "/fake-home/.config/agent-js/debug/debug-test-uuid.log",
      );
    });
  });
});
