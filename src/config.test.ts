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
import { parseCliArgs } from "./args.ts";

interface FsState {
  globalExists: boolean;
  globalContent: string;
  localExists: boolean;
  localContent: string;
}

function makeFs(overrides: Partial<FsState> = {}): {
  fs: InitStateDeps;
  state: FsState;
  written: [string, string][];
} {
  const state: FsState = {
    globalExists: false,
    globalContent: "{}",
    localExists: false,
    localContent: "{}",
    ...overrides,
  };
  const written: [string, string][] = [];

  return {
    fs: {
      existsSync: (path: string): boolean =>
        path === GLOBAL_CONFIG_PATH ? state.globalExists : state.localExists,
      readFileSync: (path: string): string =>
        path === GLOBAL_CONFIG_PATH ? state.globalContent : state.localContent,
      mkdirSync: () => {
        /* noop */
      },
      writeFileSync: (path: string, content: string) => {
        written.push([path, content]);
        if (path === LOCAL_CONFIG_PATH) state.localContent = content;
        if (path === GLOBAL_CONFIG_PATH) state.globalContent = content;
      },
      parseCliArgs,
      getRecursiveAgentsMdFilesStr: () => "",
      colorPrint: () => {
        /* noop */
      },
    } satisfies InitStateDeps,
    state,
    written,
  };
}

describe("initState", () => {
  beforeEach(() => {
    dispatch(actions.resetState());
  });

  describe("when local config exists", () => {
    it("uses its model over the global config, default config", () => {
      const { fs } = makeFs({
        globalExists: true,
        globalContent: JSON.stringify({
          model: "claude-sonnet-4-6",
          baseURL: "https://api.example.com",
        }),
        localExists: true,
        localContent: JSON.stringify({
          model: "claude-haiku-4-5",
          baseURL: "https://api.example.com",
        }),
      });

      initState(fs);

      assert.equal(selectors.getModel(), "claude-haiku-4-5");
    });

    it("uses its provider over the global config, default config", () => {
      const { fs } = makeFs({
        globalExists: true,
        globalContent: JSON.stringify({
          model: "claude-sonnet-4-6",
          provider: "openai-compatible",
        }),
        localExists: true,
        localContent: JSON.stringify({
          model: "claude-sonnet-4-6",
          provider: "anthropic",
        }),
      });

      initState(fs);

      assert.equal(selectors.getProvider(), "anthropic");
    });

    it("uses its disableUsageMessage over the global config, default config", () => {
      const { fs } = makeFs({
        globalExists: true,
        globalContent: JSON.stringify({
          model: "claude-sonnet-4-6",
          baseURL: "https://api.example.com",
          disableUsageMessage: false,
        }),
        localExists: true,
        localContent: JSON.stringify({
          model: "claude-sonnet-4-6",
          baseURL: "https://api.example.com",
          disableUsageMessage: true,
        }),
      });

      initState(fs);

      assert.equal(selectors.getDisableUsageMessage(), true);
    });

    it("uses its editorLog over the global config, default config", () => {
      const { fs } = makeFs({
        globalExists: true,
        globalContent: JSON.stringify({
          model: "claude-sonnet-4-6",
          baseURL: "https://api.example.com",
          editorLog: false,
        }),
        localExists: true,
        localContent: JSON.stringify({
          model: "claude-sonnet-4-6",
          baseURL: "https://api.example.com",
          editorLog: true,
        }),
      });

      initState(fs);

      assert.equal(selectors.getEditorLog(), true);
    });

    it("uses its diffStyle over the global config, default config", () => {
      const { fs } = makeFs({
        globalExists: true,
        globalContent: JSON.stringify({
          model: "claude-sonnet-4-6",
          baseURL: "https://api.example.com",
          diffStyle: "lines",
        }),
        localExists: true,
        localContent: JSON.stringify({
          model: "claude-sonnet-4-6",
          baseURL: "https://api.example.com",
          diffStyle: "unified",
        }),
      });

      initState(fs);

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

      const { fs } = makeFs({
        globalExists: true,
        globalContent: JSON.stringify({
          model: "test-model",
          baseURL: "https://api.example.com",
          pricingPerModel: DEFAULT_CONFIG.pricingPerModel,
        }),
        localExists: true,
        localContent: JSON.stringify({
          model: "test-model",
          baseURL: "https://api.example.com",
          pricingPerModel: localPricing,
        }),
      });

      initState(fs);

      assert.deepEqual(selectors.getPricingPerModel(), localPricing);
    });

    it("uses its keymaps over the global config, default config", () => {
      const { fs } = makeFs({
        globalExists: true,
        globalContent: JSON.stringify({
          model: "claude-sonnet-4-6",
          baseURL: "https://api.example.com",
          keymaps: {
            edit: { name: "v", ctrl: false, meta: false, shift: false },
            editLog: { name: "o", ctrl: false, meta: false, shift: false },
            clear: { name: "j", ctrl: false, meta: false, shift: false },
          },
        }),
        localExists: true,
        localContent: JSON.stringify({
          model: "claude-sonnet-4-6",
          baseURL: "https://api.example.com",
          keymaps: {
            edit: { name: "e", ctrl: true, meta: false, shift: false },
            editLog: { name: "l", ctrl: true, meta: false, shift: false },
            clear: { name: "k", ctrl: true, meta: false, shift: false },
          },
        }),
      });

      initState(fs);

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
      const { fs } = makeFs({
        localExists: true,
        localContent: JSON.stringify({
          model: "claude-sonnet-4-6",
          baseURL: "https://api.example.com",
          keymaps: {
            edit: { name: "v", ctrl: false, meta: false, shift: false },
          },
        }),
      });

      initState(fs);

      // Custom edit keymap
      assert.deepEqual(selectors.getKeymapEdit(), {
        name: "v",
        ctrl: false,
        meta: false,
        shift: false,
      });
      // Default editLog keymap
      assert.deepEqual(
        selectors.getKeymapEditLog(),
        DEFAULT_CONFIG.keymaps.editLog,
      );
      // Default clear keymap
      assert.deepEqual(
        selectors.getKeymapClear(),
        DEFAULT_CONFIG.keymaps.clear,
      );
    });
  });

  describe("when local config does not exist", () => {
    describe("when the global config exists", () => {
      it("uses its model over the default config", () => {
        const { fs } = makeFs({
          globalExists: true,
          globalContent: JSON.stringify({
            model: "claude-haiku-4-5",
            baseURL: "https://api.example.com",
          }),
        });

        initState(fs);
        assert.equal(selectors.getModel(), "claude-haiku-4-5");
      });

      it("uses its provider over the default config", () => {
        const { fs } = makeFs({
          globalExists: true,
          globalContent: JSON.stringify({
            model: "claude-sonnet-4-6",
            provider: "anthropic",
          }),
        });

        initState(fs);
        assert.equal(selectors.getProvider(), "anthropic");
      });

      it("uses its disableUsageMessage over the default config", () => {
        const { fs } = makeFs({
          globalExists: true,
          globalContent: JSON.stringify({
            model: "claude-sonnet-4-6",
            baseURL: "https://api.example.com",
            disableUsageMessage: true,
          }),
        });

        initState(fs);
        assert.equal(selectors.getDisableUsageMessage(), true);
      });

      it("uses its editorLog over the default config", () => {
        const { fs } = makeFs({
          globalExists: true,
          globalContent: JSON.stringify({
            model: "claude-sonnet-4-6",
            baseURL: "https://api.example.com",
            editorLog: true,
          }),
        });

        initState(fs);
        assert.equal(selectors.getEditorLog(), true);
      });

      it("uses its diffStyle over the default config", () => {
        const { fs } = makeFs({
          globalExists: true,
          globalContent: JSON.stringify({
            model: "claude-sonnet-4-6",
            baseURL: "https://api.example.com",
            diffStyle: "unified",
          }),
        });

        initState(fs);
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

        const { fs } = makeFs({
          globalExists: true,
          globalContent: JSON.stringify({
            model: "test-model",
            baseURL: "https://api.example.com",
            pricingPerModel: globalPricing,
          }),
        });

        initState(fs);
        assert.deepEqual(selectors.getPricingPerModel(), globalPricing);
      });

      it("uses its keymaps over the default config", () => {
        const { fs } = makeFs({
          globalExists: true,
          globalContent: JSON.stringify({
            model: "claude-sonnet-4-6",
            baseURL: "https://api.example.com",
            keymaps: {
              edit: { name: "v", ctrl: false, meta: false, shift: false },
              editLog: { name: "o", ctrl: false, meta: false, shift: false },
              clear: { name: "j", ctrl: false, meta: false, shift: false },
            },
          }),
        });

        initState(fs);

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
        const { fs } = makeFs();
        assert.throws(() => {
          initState(fs);
        }, /A `model` is required/);
      });

      it("throws when baseURL is not configured for openai-compatible provider", () => {
        const { fs } = makeFs({
          globalExists: true,
          globalContent: JSON.stringify({ model: "some-model" }),
        });
        assert.throws(() => {
          initState(fs);
        }, /A `baseURL` is required when `provider=openai-compatible`/);
      });
    });
  });

  it("throws on invalid JSON in global config", () => {
    const { fs } = makeFs({
      globalExists: true,
      globalContent: "not valid json",
    });

    assert.throws(() => {
      initState(fs);
    }, /Failed to parse config as JSON/);
  });

  it("throws on invalid JSON in local config", () => {
    const { fs } = makeFs({
      localExists: true,
      localContent: "not valid json",
    });

    assert.throws(() => {
      initState(fs);
    }, /Failed to parse config as JSON/);
  });

  it("sets debug from args", () => {
    const { fs } = makeFs({
      globalExists: true,
      globalContent: JSON.stringify({
        model: "claude-sonnet-4-6",
        baseURL: "https://api.example.com",
      }),
    });

    initState({
      ...fs,
      parseCliArgs: () => ({ debug: true, resumeSessionId: null }),
    });
    assert.equal(selectors.getDebugLog(), true);
  });

  it("sets agentsMdFilesStr from dep", () => {
    const { fs } = makeFs({
      globalExists: true,
      globalContent: JSON.stringify({
        model: "claude-sonnet-4-6",
        baseURL: "https://api.example.com",
      }),
    });

    initState({
      ...fs,
      getRecursiveAgentsMdFilesStr: () => "FILEPATH: AGENTS.md\nhello",
    });
    assert.equal(selectors.getAgentsMdFilesStr(), "FILEPATH: AGENTS.md\nhello");
  });
});
