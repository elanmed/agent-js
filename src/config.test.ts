import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert";
import { actions, getState } from "./state.ts";
import { initState, DEFAULT_CONFIG } from "./config.ts";
import {
  getGlobalConfigPath,
  getLocalConfigPath,
  getGlobalContextDir,
  getUsageLogPath,
} from "./paths.ts";
import { testFs, setupTestContext } from "./test-helpers.ts";
import { parseCliArgsDeps } from "./args.ts";
import { dirname } from "node:path";

const defaultConfig = {
  model: "claude-sonnet-4-6",
  baseURL: "https://api.example.com",
};

describe("config", () => {
  beforeEach(() => {
    setupTestContext();
    mock.method(parseCliArgsDeps, "getArgv", () => ["node", "script.js"]);
  });

  describe("when local config exists", () => {
    it("uses its model over the global config, default config", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
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
          ...defaultConfig,
          provider: "openai-compatible",
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          provider: "anthropic",
        }),
      );

      await initState();

      assert.equal(getState().config.provider, "anthropic");
    });

    it("uses its pricingPerModel over the global config, default config", async () => {
      const localPricing = structuredClone(DEFAULT_CONFIG.pricingPerModel);
      localPricing["test-model"] = {
        inputPerToken: 999,
        outputPerToken: 0,
        cacheReadPerToken: 0,
        cacheWritePerToken: 0,
      };

      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          model: "test-model",
          pricingPerModel: DEFAULT_CONFIG.pricingPerModel,
          usageLimitDuration: "60m",
          usageLimitDollar: 10,
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          model: "test-model",
          pricingPerModel: localPricing,
          usageLimitDuration: "60m",
          usageLimitDollar: 10,
        }),
      );

      await initState();

      assert.deepEqual(getState().config.pricingPerModel, localPricing);
    });

    it("uses its contextWindowPerModel over the global config, default config", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          contextWindowPerModel: { "test-model": 100000 },
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          contextWindowPerModel: { "test-model": 200000 },
        }),
      );

      await initState();

      assert.deepEqual(getState().config.contextWindowPerModel, {
        "test-model": 200000,
      });
    });

    it("uses its compactAtContextRatio over the global config, default config", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          compactAtContextRatio: 0.8,
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          compactAtContextRatio: 0.5,
        }),
      );

      await initState();

      assert.strictEqual(getState().config.compactAtContextRatio, 0.5);
    });

    it("uses its keymaps over the global config, default config", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
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
          ...defaultConfig,
          keymaps: {
            edit: { name: "e", ctrl: true, meta: false, shift: false },
            paste: { name: "t", ctrl: true, meta: false, shift: false },
            history: { name: "l", ctrl: true, meta: false, shift: false },
            clear: { name: "k", ctrl: true, meta: false, shift: false },
          },
        }),
      );

      await initState();

      assert.deepEqual(getState().config.keymapEditPrompt, {
        name: "e",
        ctrl: true,
        meta: false,
        shift: false,
      });
      assert.deepEqual(getState().config.keymapEditPastePrompt, {
        name: "t",
        ctrl: true,
        meta: false,
        shift: false,
      });
      assert.deepEqual(getState().config.keymapChatHistory, {
        name: "l",
        ctrl: true,
        meta: false,
        shift: false,
      });
      assert.deepEqual(getState().config.keymapClear, {
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
          ...defaultConfig,
          customSlashCommandDirs: ["/global-dir"],
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          customSlashCommandDirs: ["/local-dir"],
        }),
      );

      await initState();

      assert.deepStrictEqual(getState().app.customSlashCommandDirs, [
        "/local-dir",
      ]);
    });

    it("uses its customSkillDirs over the global config, default config", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          customSkillDirs: ["/global-skills"],
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          customSkillDirs: ["/local-skills"],
        }),
      );

      await initState();

      assert.deepStrictEqual(getState().app.customSkillDirs, ["/local-skills"]);
    });

    it("uses its loadingStateFrames over the global config, default config", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          loadingStateFrames: ["⣾", "⣽", "⣻", "⢿"],
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
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
          ...defaultConfig,
          loadingStateFrameDuration: 100,
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
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
          ...defaultConfig,
          promptPrefix: "> ",
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          promptPrefix: "🤖 ",
        }),
      );

      await initState();

      assert.strictEqual(getState().config.promptPrefix, "🤖 ");
    });

    it("uses its usageLimitDuration over the global config, default config", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          usageLimitDuration: "2h",
          usageLimitDollar: 10,
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          usageLimitDuration: "60m",
          usageLimitDollar: 20,
        }),
      );

      await initState();

      assert.strictEqual(getState().config.usageLimitDuration, "60m");
      assert.strictEqual(getState().config.usageLimitDollar, 20);
    });

    it("falls back to global usageLimitDuration when local omits it", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          usageLimitDuration: "2h",
          usageLimitDollar: 10,
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          usageLimitDollar: 10,
        }),
      );

      await initState();

      assert.strictEqual(getState().config.usageLimitDuration, "2h");
      assert.strictEqual(getState().config.usageLimitDollar, 10);
    });

    it("uses its usageLimitDollar over the global config, default config", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          usageLimitDuration: "2h",
          usageLimitDollar: 10,
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          usageLimitDuration: "60m",
          usageLimitDollar: 5,
        }),
      );

      await initState();

      assert.strictEqual(getState().config.usageLimitDollar, 5);
      assert.strictEqual(getState().config.usageLimitDuration, "60m");
    });

    it("falls back to global usageLimitDollar when local omits it", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          usageLimitDuration: "2h",
          usageLimitDollar: 10,
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          usageLimitDuration: "2h",
        }),
      );

      await initState();

      assert.strictEqual(getState().config.usageLimitDollar, 10);
      assert.strictEqual(getState().config.usageLimitDuration, "2h");
    });

    it("rejects usageLimitDuration without usageLimitDollar", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          usageLimitDuration: "2h",
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
        }),
      );

      await assert.rejects(
        initState(),
        /Both `usageLimitDuration` and `usageLimitDollar` are required together/,
      );
    });

    it("rejects usageLimitDollar without usageLimitDuration", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          usageLimitDollar: 10,
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
        }),
      );

      await assert.rejects(
        initState(),
        /Both `usageLimitDuration` and `usageLimitDollar` are required together/,
      );
    });

    it("rejects non-string usageLimitDuration", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          usageLimitDuration: 3_600_000,
        }),
      );

      await assert.rejects(initState(), /Invalid input: expected string/);
    });

    it("rejects usageLimitDuration with an invalid suffix", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          usageLimitDuration: "10x",
        }),
      );

      await assert.rejects(
        initState(),
        /usageLimitDuration must be of the format/,
      );
    });

    it("rejects usageLimitDuration without a suffix", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          usageLimitDuration: "3600000",
        }),
      );

      await assert.rejects(
        initState(),
        /usageLimitDuration must be of the format/,
      );
    });

    it("rejects usageLimitDuration with a non-numeric prefix", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          usageLimitDuration: "abch",
        }),
      );

      await assert.rejects(
        initState(),
        /usageLimitDuration must be of the format/,
      );
    });

    it("rejects non-number usageLimitDollar", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          usageLimitDollar: "five",
        }),
      );

      await assert.rejects(initState(), /Invalid input: expected number/);
    });

    it("rejects compactAtContextRatio above 1", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          compactAtContextRatio: 1.5,
        }),
      );

      await assert.rejects(initState(), /Too big: expected number to be <=1/);
    });

    it("rejects compactAtContextRatio below 0", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          compactAtContextRatio: -0.1,
        }),
      );

      await assert.rejects(initState(), /Too small: expected number to be >=0/);
    });

    it("rejects non-number compactAtContextRatio", async () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          compactAtContextRatio: "half",
        }),
      );

      await assert.rejects(initState(), /Invalid input: expected number/);
    });

    it("merges partial keymaps with defaults", async () => {
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          keymaps: {
            edit: { name: "v", ctrl: false, meta: false, shift: false },
          },
        }),
      );

      await initState();

      assert.deepEqual(getState().config.keymapEditPrompt, {
        name: "v",
        ctrl: false,
        meta: false,
        shift: false,
      });
      assert.deepEqual(
        getState().config.keymapEditPastePrompt,
        DEFAULT_CONFIG.keymaps.paste,
      );
      assert.deepEqual(
        getState().config.keymapChatHistory,
        DEFAULT_CONFIG.keymaps.history,
      );
      assert.deepEqual(
        getState().config.keymapClear,
        DEFAULT_CONFIG.keymaps.clear,
      );
    });
  });

  describe("when local config does not exist", () => {
    describe("when the global config exists", () => {
      it("uses its model over the default config", async () => {
        testFs._files.set(
          getGlobalConfigPath(),
          JSON.stringify({
            ...defaultConfig,
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
            ...defaultConfig,
            provider: "anthropic",
          }),
        );

        await initState();
        assert.equal(getState().config.provider, "anthropic");
      });

      it("uses its pricingPerModel over the default config", async () => {
        const globalPricing = structuredClone(DEFAULT_CONFIG.pricingPerModel);
        globalPricing["test-model"] = {
          inputPerToken: 999,
          outputPerToken: 0,
          cacheReadPerToken: 0,
          cacheWritePerToken: 0,
        };

        testFs._files.set(
          getGlobalConfigPath(),
          JSON.stringify({
            ...defaultConfig,
            model: "test-model",
            pricingPerModel: globalPricing,
            usageLimitDuration: "60m",
            usageLimitDollar: 10,
          }),
        );

        await initState();
        assert.deepEqual(getState().config.pricingPerModel, globalPricing);
      });

      it("uses its keymaps over the default config", async () => {
        testFs._files.set(
          getGlobalConfigPath(),
          JSON.stringify({
            ...defaultConfig,
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

        assert.deepEqual(getState().config.keymapEditPrompt, {
          name: "v",
          ctrl: false,
          meta: false,
          shift: false,
        });
        assert.deepEqual(getState().config.keymapEditPastePrompt, {
          name: "p",
          ctrl: false,
          meta: false,
          shift: false,
        });
        assert.deepEqual(getState().config.keymapChatHistory, {
          name: "o",
          ctrl: false,
          meta: false,
          shift: false,
        });
        assert.deepEqual(getState().config.keymapClear, {
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
            ...defaultConfig,
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
            ...defaultConfig,
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
            ...defaultConfig,
            promptPrefix: "❯ ",
          }),
        );

        await initState();

        assert.strictEqual(getState().config.promptPrefix, "❯ ");
      });

      it("uses its usageLimitDuration over the default config", async () => {
        testFs._files.set(
          getGlobalConfigPath(),
          JSON.stringify({
            ...defaultConfig,
            usageLimitDuration: "2h",
            usageLimitDollar: 10,
          }),
        );

        await initState();

        assert.strictEqual(getState().config.usageLimitDuration, "2h");
        assert.strictEqual(getState().config.usageLimitDollar, 10);
      });

      it("uses its usageLimitDollar over the default config", async () => {
        testFs._files.set(
          getGlobalConfigPath(),
          JSON.stringify({
            ...defaultConfig,
            usageLimitDuration: "2h",
            usageLimitDollar: 20,
          }),
        );

        await initState();

        assert.strictEqual(getState().config.usageLimitDollar, 20);
        assert.strictEqual(getState().config.usageLimitDuration, "2h");
      });

      it("uses default limits when global config omits them", async () => {
        testFs._files.set(
          getGlobalConfigPath(),
          JSON.stringify({
            ...defaultConfig,
          }),
        );

        await initState();

        assert.strictEqual(getState().config.usageLimitDuration, undefined);
        assert.strictEqual(getState().config.usageLimitDollar, undefined);
      });

      it("uses its customSkillDirs over the default config", async () => {
        testFs._files.set(
          getGlobalConfigPath(),
          JSON.stringify({
            ...defaultConfig,
            customSkillDirs: ["/global-skills"],
          }),
        );

        await initState();

        assert.deepStrictEqual(getState().app.customSkillDirs, [
          "/global-skills",
        ]);
      });
    });

    describe("when the global config does not exist", () => {
      it("throws when model is not configured", async () => {
        await assert.rejects(initState(), /A `model` is required/);
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
        ...defaultConfig,
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
        ...defaultConfig,
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
        ...defaultConfig,
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
        ...defaultConfig,
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

  it("throws on invalid JSON in global config", async () => {
    testFs._files.set(getGlobalConfigPath(), "not valid json");

    await assert.rejects(initState(), /Failed to parse config as JSON/);
  });

  it("throws on invalid JSON in local config", async () => {
    testFs._files.set(getLocalConfigPath(), "not valid json");

    await assert.rejects(initState(), /Failed to parse config as JSON/);
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
        ...defaultConfig,
      }),
    );

    await initState();
    assert.equal(getState().app.debugLog, true);
  });

  it("sets contextStr from dep", async () => {
    testFs._dirs.add(getGlobalContextDir());
    testFs._globResults.set(
      "/fake-home/.config/.agent-js/context/**/AGENTS.md",
      ["/fake-home/.config/.agent-js/context/AGENTS.md"],
    );
    testFs._files.set(
      "/fake-home/.config/.agent-js/context/AGENTS.md",
      "hello",
    );
    testFs._files.set(
      getGlobalConfigPath(),
      JSON.stringify({
        ...defaultConfig,
      }),
    );

    await initState();
    assert.equal(
      getState().app.contextStr,
      `\nAGENTS.md context files:\nPath: /fake-home/.config/.agent-js/context/AGENTS.md\nContent: hello\n`,
    );
  });

  it("sets skillsStr from dep", async () => {
    testFs._files.set(
      getGlobalConfigPath(),
      JSON.stringify({
        ...defaultConfig,
      }),
    );

    await initState();
    assert.equal(getState().app.skillsStr, "");
  });

  it("sets modelUsage to an empty object", async () => {
    testFs._files.set(
      getGlobalConfigPath(),
      JSON.stringify({
        ...defaultConfig,
      }),
    );

    await initState();
    assert.deepStrictEqual(getState().app.modelUsage, {});
  });

  it("loads recent model usages from the usage log", async () => {
    actions.setUsageLimitDuration("60m");
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
        ...defaultConfig,
        usageLimitDuration: "60m",
        usageLimitDollar: 10,
        pricingPerModel: {
          "claude-sonnet-4-6": {
            inputPerToken: 3,
            outputPerToken: 15,
            cacheReadPerToken: 0.75,
            cacheWritePerToken: 3.75,
          },
        },
      }),
    );
    mock.method(Date, "now", () => 4_000_000);

    await initState();

    assert.deepStrictEqual(getState().app.modelUsage, {
      "gpt-4": [recent],
    });
  });

  it("sets sessionStartDate", async () => {
    mock.method(Date, "now", () => 1234);
    testFs._files.set(
      getGlobalConfigPath(),
      JSON.stringify({
        ...defaultConfig,
      }),
    );

    await initState();
    assert.strictEqual(getState().app.sessionStartDate, 1234);
  });
});
