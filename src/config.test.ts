import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert";
import { getState } from "./state.ts";
import { initState, DEFAULT_CONFIG } from "./config.ts";
import {
  getGlobalConfigPath,
  getLocalConfigPath,
  getGlobalContextDir,
} from "./paths.ts";
import { testFs, setupTestContext } from "./test-helpers.ts";
import { parseCliArgsDeps } from "./args.ts";

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
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          model: "test-model",
          pricingPerModel: localPricing,
        }),
      );

      await initState();

      assert.deepEqual(getState().config.pricingPerModel, localPricing);
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
});
