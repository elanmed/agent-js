import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert";
import os from "node:os";
import { dispatch, actions, selectors } from "./state.ts";
import { initState, DEFAULT_CONFIG } from "./config.ts";
import {
  getGlobalConfigPath,
  getLocalConfigPath,
  getGlobalAgentsPath,
} from "./paths.ts";
import { testFs, setupFakeDeps } from "./test-helpers.ts";
import { parseCliArgsDeps } from "./args.ts";

describe("config", () => {
  beforeEach(() => {
    dispatch(actions.resetState());
    setupFakeDeps();
    mock.method(os, "homedir", () => "/fake-home");
    mock.method(parseCliArgsDeps, "getArgv", () => ["node", "script.js"]);
  });

  describe("when local config exists", () => {
    it("uses its model over the global config, default config", () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          model: "claude-sonnet-4-6",
          baseURL: "https://api.example.com",
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          model: "claude-haiku-4-5",
          baseURL: "https://api.example.com",
        }),
      );

      initState();

      assert.equal(selectors.getModel(), "claude-haiku-4-5");
    });

    it("uses its provider over the global config, default config", () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          model: "claude-sonnet-4-6",
          provider: "openai-compatible",
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          model: "claude-sonnet-4-6",
          provider: "anthropic",
        }),
      );

      initState();

      assert.equal(selectors.getProvider(), "anthropic");
    });

    it("uses its disableUsageMessage over the global config, default config", () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          model: "claude-sonnet-4-6",
          baseURL: "https://api.example.com",
          disableUsageMessage: false,
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          model: "claude-sonnet-4-6",
          baseURL: "https://api.example.com",
          disableUsageMessage: true,
        }),
      );

      initState();

      assert.equal(selectors.getDisableUsageMessage(), true);
    });

    it("uses its editorLog over the global config, default config", () => {
      testFs._files.set(
        getGlobalConfigPath(),
        JSON.stringify({
          model: "claude-sonnet-4-6",
          baseURL: "https://api.example.com",
          editorLog: false,
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          model: "claude-sonnet-4-6",
          baseURL: "https://api.example.com",
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
          model: "claude-sonnet-4-6",
          baseURL: "https://api.example.com",
          diffStyle: "lines",
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          model: "claude-sonnet-4-6",
          baseURL: "https://api.example.com",
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
          model: "test-model",
          baseURL: "https://api.example.com",
          pricingPerModel: DEFAULT_CONFIG.pricingPerModel,
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          model: "test-model",
          baseURL: "https://api.example.com",
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
          model: "claude-sonnet-4-6",
          baseURL: "https://api.example.com",
          keymaps: {
            edit: { name: "v", ctrl: false, meta: false, shift: false },
            editLog: { name: "o", ctrl: false, meta: false, shift: false },
            clear: { name: "j", ctrl: false, meta: false, shift: false },
          },
        }),
      );
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          model: "claude-sonnet-4-6",
          baseURL: "https://api.example.com",
          keymaps: {
            edit: { name: "e", ctrl: true, meta: false, shift: false },
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

    it("merges partial keymaps with defaults", () => {
      testFs._files.set(
        getLocalConfigPath(),
        JSON.stringify({
          model: "claude-sonnet-4-6",
          baseURL: "https://api.example.com",
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
            model: "claude-haiku-4-5",
            baseURL: "https://api.example.com",
          }),
        );

        initState();
        assert.equal(selectors.getModel(), "claude-haiku-4-5");
      });

      it("uses its provider over the default config", () => {
        testFs._files.set(
        getGlobalConfigPath(),
          JSON.stringify({
            model: "claude-sonnet-4-6",
            provider: "anthropic",
          }),
        );

        initState();
        assert.equal(selectors.getProvider(), "anthropic");
      });

      it("uses its disableUsageMessage over the default config", () => {
        testFs._files.set(
        getGlobalConfigPath(),
          JSON.stringify({
            model: "claude-sonnet-4-6",
            baseURL: "https://api.example.com",
            disableUsageMessage: true,
          }),
        );

        initState();
        assert.equal(selectors.getDisableUsageMessage(), true);
      });

      it("uses its editorLog over the default config", () => {
        testFs._files.set(
        getGlobalConfigPath(),
          JSON.stringify({
            model: "claude-sonnet-4-6",
            baseURL: "https://api.example.com",
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
            model: "claude-sonnet-4-6",
            baseURL: "https://api.example.com",
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
            model: "test-model",
            baseURL: "https://api.example.com",
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
            model: "claude-sonnet-4-6",
            baseURL: "https://api.example.com",
            keymaps: {
              edit: { name: "v", ctrl: false, meta: false, shift: false },
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
        model: "claude-sonnet-4-6",
        baseURL: "https://api.example.com",
      }),
    );

    initState();
    assert.equal(selectors.getDebugLog(), true);
  });

  it("sets agentsContext from dep", () => {
    testFs._files.set(getGlobalAgentsPath(), "hello");
    testFs._files.set(
        getGlobalConfigPath(),
      JSON.stringify({
        model: "claude-sonnet-4-6",
        baseURL: "https://api.example.com",
      }),
    );

    initState();
    assert.equal(
      selectors.getAgentsContext(),
      `\nAGENTS.md context files:\nPath: ${getGlobalAgentsPath()}\nContent: hello\n`,
    );
  });

  it("sets skillsContext from dep", () => {
    testFs._files.set(
        getGlobalConfigPath(),
      JSON.stringify({
        model: "claude-sonnet-4-6",
        baseURL: "https://api.example.com",
      }),
    );

    initState();
    assert.equal(
      selectors.getSkillsContext().includes("Available skills:"),
      true,
    );
  });
});
