import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { dispatch, actions, selectors } from "./state.ts";
import {
  initState,
  DEFAULT_CONFIG,
  GLOBAL_CONFIG_PATH,
  LOCAL_CONFIG_PATH,
} from "./config.ts";
import type { InitStateDeps } from "./config.ts";
import { makeFsDeps } from "./fs-deps.ts";

function makeDeps(overrides: Partial<InitStateDeps> = {}): InitStateDeps {
  return {
    fs: makeFsDeps(),
    parseCliArgs: () => ({ debug: false, resumeSessionId: null }),
    getRecursiveAgentsMdFilesStr: () => "",
    colorPrint: () => undefined,
    ...overrides,
  };
}

describe("initState", () => {
  beforeEach(() => {
    dispatch(actions.resetState());
  });

  describe("when local config exists", () => {
    it("uses its model over the global config, default config", () => {
      const deps = makeDeps();
      deps.fs._files.set(
        GLOBAL_CONFIG_PATH,
        JSON.stringify({
          model: "claude-sonnet-4-6",
          baseURL: "https://api.example.com",
        }),
      );
      deps.fs._files.set(
        LOCAL_CONFIG_PATH,
        JSON.stringify({
          model: "claude-haiku-4-5",
          baseURL: "https://api.example.com",
        }),
      );

      initState(deps);

      assert.equal(selectors.getModel(), "claude-haiku-4-5");
    });

    it("uses its provider over the global config, default config", () => {
      const deps = makeDeps();
      deps.fs._files.set(
        GLOBAL_CONFIG_PATH,
        JSON.stringify({
          model: "claude-sonnet-4-6",
          provider: "openai-compatible",
        }),
      );
      deps.fs._files.set(
        LOCAL_CONFIG_PATH,
        JSON.stringify({
          model: "claude-sonnet-4-6",
          provider: "anthropic",
        }),
      );

      initState(deps);

      assert.equal(selectors.getProvider(), "anthropic");
    });

    it("uses its disableUsageMessage over the global config, default config", () => {
      const deps = makeDeps();
      deps.fs._files.set(
        GLOBAL_CONFIG_PATH,
        JSON.stringify({
          model: "claude-sonnet-4-6",
          baseURL: "https://api.example.com",
          disableUsageMessage: false,
        }),
      );
      deps.fs._files.set(
        LOCAL_CONFIG_PATH,
        JSON.stringify({
          model: "claude-sonnet-4-6",
          baseURL: "https://api.example.com",
          disableUsageMessage: true,
        }),
      );

      initState(deps);

      assert.equal(selectors.getDisableUsageMessage(), true);
    });

    it("uses its editorLog over the global config, default config", () => {
      const deps = makeDeps();
      deps.fs._files.set(
        GLOBAL_CONFIG_PATH,
        JSON.stringify({
          model: "claude-sonnet-4-6",
          baseURL: "https://api.example.com",
          editorLog: false,
        }),
      );
      deps.fs._files.set(
        LOCAL_CONFIG_PATH,
        JSON.stringify({
          model: "claude-sonnet-4-6",
          baseURL: "https://api.example.com",
          editorLog: true,
        }),
      );

      initState(deps);

      assert.equal(selectors.getEditorLog(), true);
    });

    it("uses its diffStyle over the global config, default config", () => {
      const deps = makeDeps();
      deps.fs._files.set(
        GLOBAL_CONFIG_PATH,
        JSON.stringify({
          model: "claude-sonnet-4-6",
          baseURL: "https://api.example.com",
          diffStyle: "lines",
        }),
      );
      deps.fs._files.set(
        LOCAL_CONFIG_PATH,
        JSON.stringify({
          model: "claude-sonnet-4-6",
          baseURL: "https://api.example.com",
          diffStyle: "unified",
        }),
      );

      initState(deps);

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

      const deps = makeDeps();
      deps.fs._files.set(
        GLOBAL_CONFIG_PATH,
        JSON.stringify({
          model: "test-model",
          baseURL: "https://api.example.com",
          pricingPerModel: DEFAULT_CONFIG.pricingPerModel,
        }),
      );
      deps.fs._files.set(
        LOCAL_CONFIG_PATH,
        JSON.stringify({
          model: "test-model",
          baseURL: "https://api.example.com",
          pricingPerModel: localPricing,
        }),
      );

      initState(deps);

      assert.deepEqual(selectors.getPricingPerModel(), localPricing);
    });

    it("uses its keymaps over the global config, default config", () => {
      const deps = makeDeps();
      deps.fs._files.set(
        GLOBAL_CONFIG_PATH,
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
      deps.fs._files.set(
        LOCAL_CONFIG_PATH,
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

      initState(deps);

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
      const deps = makeDeps();
      deps.fs._files.set(
        LOCAL_CONFIG_PATH,
        JSON.stringify({
          model: "claude-sonnet-4-6",
          baseURL: "https://api.example.com",
          keymaps: {
            edit: { name: "v", ctrl: false, meta: false, shift: false },
          },
        }),
      );

      initState(deps);

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
        const deps = makeDeps();
        deps.fs._files.set(
          GLOBAL_CONFIG_PATH,
          JSON.stringify({
            model: "claude-haiku-4-5",
            baseURL: "https://api.example.com",
          }),
        );

        initState(deps);
        assert.equal(selectors.getModel(), "claude-haiku-4-5");
      });

      it("uses its provider over the default config", () => {
        const deps = makeDeps();
        deps.fs._files.set(
          GLOBAL_CONFIG_PATH,
          JSON.stringify({
            model: "claude-sonnet-4-6",
            provider: "anthropic",
          }),
        );

        initState(deps);
        assert.equal(selectors.getProvider(), "anthropic");
      });

      it("uses its disableUsageMessage over the default config", () => {
        const deps = makeDeps();
        deps.fs._files.set(
          GLOBAL_CONFIG_PATH,
          JSON.stringify({
            model: "claude-sonnet-4-6",
            baseURL: "https://api.example.com",
            disableUsageMessage: true,
          }),
        );

        initState(deps);
        assert.equal(selectors.getDisableUsageMessage(), true);
      });

      it("uses its editorLog over the default config", () => {
        const deps = makeDeps();
        deps.fs._files.set(
          GLOBAL_CONFIG_PATH,
          JSON.stringify({
            model: "claude-sonnet-4-6",
            baseURL: "https://api.example.com",
            editorLog: true,
          }),
        );

        initState(deps);
        assert.equal(selectors.getEditorLog(), true);
      });

      it("uses its diffStyle over the default config", () => {
        const deps = makeDeps();
        deps.fs._files.set(
          GLOBAL_CONFIG_PATH,
          JSON.stringify({
            model: "claude-sonnet-4-6",
            baseURL: "https://api.example.com",
            diffStyle: "unified",
          }),
        );

        initState(deps);
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

        const deps = makeDeps();
        deps.fs._files.set(
          GLOBAL_CONFIG_PATH,
          JSON.stringify({
            model: "test-model",
            baseURL: "https://api.example.com",
            pricingPerModel: globalPricing,
          }),
        );

        initState(deps);
        assert.deepEqual(selectors.getPricingPerModel(), globalPricing);
      });

      it("uses its keymaps over the default config", () => {
        const deps = makeDeps();
        deps.fs._files.set(
          GLOBAL_CONFIG_PATH,
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

        initState(deps);

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
        const deps = makeDeps();
        assert.throws(() => {
          initState(deps);
        }, /A `model` is required/);
      });

      it("throws when baseURL is not configured for openai-compatible provider", () => {
        const deps = makeDeps();
        deps.fs._files.set(
          GLOBAL_CONFIG_PATH,
          JSON.stringify({ model: "some-model" }),
        );
        assert.throws(() => {
          initState(deps);
        }, /A `baseURL` is required when `provider=openai-compatible`/);
      });
    });
  });

  it("throws on invalid JSON in global config", () => {
    const deps = makeDeps();
    deps.fs._files.set(GLOBAL_CONFIG_PATH, "not valid json");

    assert.throws(() => {
      initState(deps);
    }, /Failed to parse config as JSON/);
  });

  it("throws on invalid JSON in local config", () => {
    const deps = makeDeps();
    deps.fs._files.set(LOCAL_CONFIG_PATH, "not valid json");

    assert.throws(() => {
      initState(deps);
    }, /Failed to parse config as JSON/);
  });

  it("sets debug from args", () => {
    const deps = makeDeps({
      parseCliArgs: () => ({ debug: true, resumeSessionId: null }),
    });
    deps.fs._files.set(
      GLOBAL_CONFIG_PATH,
      JSON.stringify({
        model: "claude-sonnet-4-6",
        baseURL: "https://api.example.com",
      }),
    );

    initState(deps);
    assert.equal(selectors.getDebugLog(), true);
  });

  it("sets agentsMdFilesStr from dep", () => {
    const deps = makeDeps({
      getRecursiveAgentsMdFilesStr: () => "FILEPATH: AGENTS.md\nhello",
    });
    deps.fs._files.set(
      GLOBAL_CONFIG_PATH,
      JSON.stringify({
        model: "claude-sonnet-4-6",
        baseURL: "https://api.example.com",
      }),
    );

    initState(deps);
    assert.equal(selectors.getAgentsMdFilesStr(), "FILEPATH: AGENTS.md\nhello");
  });
});
