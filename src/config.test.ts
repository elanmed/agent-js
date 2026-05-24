import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert";
import { dispatch, actions, selectors } from "./state.ts";
import { initState, DEFAULT_CONFIG } from "./config.ts";
import {
  getGlobalConfigPath,
  getLocalConfigPath,
  getGlobalContextDir,
} from "./paths.ts";
import { testFs, setupFakeDeps } from "./test-helpers.ts";
import { parseCliArgsDeps } from "./args.ts";

const defaultConfig = {
  model: "claude-sonnet-4-6",
  baseURL: "https://api.example.com",
};

describe("config", () => {
  beforeEach(() => {
    dispatch(actions.resetState());
    setupFakeDeps();
    mock.method(parseCliArgsDeps, "getArgv", () => ["node", "script.js"]);
  });

  describe("when local config exists", () => {
    it("uses its model over the global config, default config", () => {
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

      initState();

      assert.equal(selectors.getModel(), "claude-haiku-4-5");
    });

    it("uses its provider over the global config, default config", () => {
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

      initState();

      assert.equal(selectors.getProvider(), "anthropic");
    });

    it("uses its editorLog over the global config, default config", () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          editorLog: false,
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          editorLog: true,
        }),
      );

      initState();

      assert.equal(selectors.getEditorLog(), true);
    });

    it("uses its diffStyle over the global config, default config", () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          diffStyle: "lines",
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          diffStyle: "unified",
        }),
      );

      initState();

      assert.equal(selectors.getDiffStyle(), "unified");
    });

    it("uses its pricingPerModel over the global config, default config", () => {
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

      initState();

      assert.deepEqual(selectors.getPricingPerModel(), localPricing);
    });

    it("uses its keymaps over the global config, default config", () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          keymaps: {
            edit: { name: "v", ctrl: false, meta: false, shift: false },
            editPaste: { name: "p", ctrl: false, meta: false, shift: false },
            editLog: { name: "o", ctrl: false, meta: false, shift: false },
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
            editPaste: { name: "t", ctrl: true, meta: false, shift: false },
            editLog: { name: "l", ctrl: true, meta: false, shift: false },
            clear: { name: "k", ctrl: true, meta: false, shift: false },
          },
        }),
      );

      initState();

      assert.deepEqual(selectors.getKeymapEdit(), {
        name: "e",
        ctrl: true,
        meta: false,
        shift: false,
      });
      assert.deepEqual(selectors.getKeymapEditPaste(), {
        name: "t",
        ctrl: true,
        meta: false,
        shift: false,
      });
      assert.deepEqual(selectors.getKeymapEditLog(), {
        name: "l",
        ctrl: true,
        meta: false,
        shift: false,
      });
      assert.deepEqual(selectors.getKeymapClear(), {
        name: "k",
        ctrl: true,
        meta: false,
        shift: false,
      });
    });

    it("uses its customSlashCommandDirs over the global config, default config", () => {
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

      initState();

      assert.deepStrictEqual(selectors.getCustomSlashCommandDirs(), [
        "/local-dir",
      ]);
    });

    it("uses its customSkillDirs over the global config, default config", () => {
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

      initState();

      assert.deepStrictEqual(selectors.getCustomSkillDirs(), ["/local-skills"]);
    });

    it("merges partial keymaps with defaults", () => {
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          ...defaultConfig,
          keymaps: {
            edit: { name: "v", ctrl: false, meta: false, shift: false },
          },
        }),
      );

      initState();

      assert.deepEqual(selectors.getKeymapEdit(), {
        name: "v",
        ctrl: false,
        meta: false,
        shift: false,
      });
      assert.deepEqual(
        selectors.getKeymapEditPaste(),
        DEFAULT_CONFIG.keymaps.editPaste,
      );
      assert.deepEqual(
        selectors.getKeymapEditLog(),
        DEFAULT_CONFIG.keymaps.editLog,
      );
      assert.deepEqual(
        selectors.getKeymapClear(),
        DEFAULT_CONFIG.keymaps.clear,
      );
    });
  });

  describe("when local config does not exist", () => {
    describe("when the global config exists", () => {
      it("uses its model over the default config", () => {
        testFs._files.set(
          getGlobalConfigPath(),
          JSON.stringify({
            ...defaultConfig,
            model: "claude-haiku-4-5",
          }),
        );

        initState();
        assert.equal(selectors.getModel(), "claude-haiku-4-5");
      });

      it("uses its provider over the default config", () => {
        testFs._files.set(
          getGlobalConfigPath(),
          JSON.stringify({
            ...defaultConfig,
            provider: "anthropic",
          }),
        );

        initState();
        assert.equal(selectors.getProvider(), "anthropic");
      });

      it("uses its editorLog over the default config", () => {
        testFs._files.set(
          getGlobalConfigPath(),
          JSON.stringify({
            ...defaultConfig,
            editorLog: true,
          }),
        );

        initState();
        assert.equal(selectors.getEditorLog(), true);
      });

      it("uses its diffStyle over the default config", () => {
        testFs._files.set(
          getGlobalConfigPath(),
          JSON.stringify({
            ...defaultConfig,
            diffStyle: "unified",
          }),
        );

        initState();
        assert.equal(selectors.getDiffStyle(), "unified");
      });

      it("uses its pricingPerModel over the default config", () => {
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

        initState();
        assert.deepEqual(selectors.getPricingPerModel(), globalPricing);
      });

      it("uses its keymaps over the default config", () => {
        testFs._files.set(
          getGlobalConfigPath(),
          JSON.stringify({
            ...defaultConfig,
            keymaps: {
              edit: { name: "v", ctrl: false, meta: false, shift: false },
              editPaste: { name: "p", ctrl: false, meta: false, shift: false },
              editLog: { name: "o", ctrl: false, meta: false, shift: false },
              clear: { name: "j", ctrl: false, meta: false, shift: false },
            },
          }),
        );

        initState();

        assert.deepEqual(selectors.getKeymapEdit(), {
          name: "v",
          ctrl: false,
          meta: false,
          shift: false,
        });
        assert.deepEqual(selectors.getKeymapEditPaste(), {
          name: "p",
          ctrl: false,
          meta: false,
          shift: false,
        });
        assert.deepEqual(selectors.getKeymapEditLog(), {
          name: "o",
          ctrl: false,
          meta: false,
          shift: false,
        });
        assert.deepEqual(selectors.getKeymapClear(), {
          name: "j",
          ctrl: false,
          meta: false,
          shift: false,
        });
      });

      it("uses its customSkillDirs over the default config", () => {
        testFs._files.set(
          getGlobalConfigPath(),
          JSON.stringify({
            ...defaultConfig,
            customSkillDirs: ["/global-skills"],
          }),
        );

        initState();

        assert.deepStrictEqual(selectors.getCustomSkillDirs(), [
          "/global-skills",
        ]);
      });
    });

    describe("when the global config does not exist", () => {
      it("throws when model is not configured", () => {
        assert.throws(() => {
          initState();
        }, /A `model` is required/);
      });

      it("throws when baseURL is not configured for openai-compatible provider", () => {
        testFs._files.set(
          getGlobalConfigPath(),
          JSON.stringify({ model: "some-model" }),
        );
        assert.throws(() => {
          initState();
        }, /A `baseURL` is required when `provider=openai-compatible`/);
      });
    });
  });

  it("throws on invalid JSON in global config", () => {
    testFs._files.set(getGlobalConfigPath(), "not valid json");

    assert.throws(() => {
      initState();
    }, /Failed to parse config as JSON/);
  });

  it("throws on invalid JSON in local config", () => {
    testFs._files.set(getLocalConfigPath(), "not valid json");

    assert.throws(() => {
      initState();
    }, /Failed to parse config as JSON/);
  });

  it("sets debug from args", () => {
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

    initState();
    assert.equal(selectors.getDebugLog(), true);
  });

  it("sets contextStr from dep", () => {
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

    initState();
    assert.equal(
      selectors.getContextStr(),
      `\nAGENTS.md context files:\nPath: /fake-home/.config/.agent-js/context/AGENTS.md\nContent: hello\n`,
    );
  });

  it("sets skillsStr from dep", () => {
    testFs._files.set(
      getGlobalConfigPath(),
      JSON.stringify({
        ...defaultConfig,
      }),
    );

    initState();
    assert.equal(selectors.getSkillsStr(), "");
  });
});
