import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
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
      getRecursiveAgentsMdFilesStr: () => Promise.resolve(""),
      colorLog: () => {
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
    it("uses its model over the global config, default config", async () => {
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

      await initState(fs);

      assert.equal(selectors.getModel(), "claude-haiku-4-5");
    });

    it("uses its provider over the global config, default config", async () => {
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

      await initState(fs);

      assert.equal(selectors.getProvider(), "anthropic");
    });

    it("uses its disableUsageMessage over the global config, default config", async () => {
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

      await initState(fs);

      assert.equal(selectors.getDisableUsageMessage(), true);
    });

    it("uses its diffStyle over the global config, default config", async () => {
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

      await initState(fs);

      assert.equal(selectors.getDiffStyle(), "unified");
    });

    it("uses its pricingPerModel over the global config, default config", async () => {
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

      await initState(fs);

      assert.deepEqual(selectors.getPricingPerModel(), localPricing);
    });

    it("uses its keymaps over the global config, default config", async () => {
      const { fs } = makeFs({
        globalExists: true,
        globalContent: JSON.stringify({
          model: "claude-sonnet-4-6",
          baseURL: "https://api.example.com",
          keymaps: {
            editor: { name: "e", ctrl: true, meta: false, shift: false },
          },
        }),
        localExists: true,
        localContent: JSON.stringify({
          model: "claude-sonnet-4-6",
          baseURL: "https://api.example.com",
          keymaps: {
            editor: { name: "v", ctrl: false, meta: false, shift: false },
          },
        }),
      });

      await initState(fs);

      assert.deepEqual(selectors.getKeymaps(), {
        editor: { name: "v", ctrl: false, meta: false, shift: false },
      });
    });
  });

  describe("when local config does not exist", () => {
    describe("when the global config exists", () => {
      it("uses its model over the default config", async () => {
        const { fs } = makeFs({
          globalExists: true,
          globalContent: JSON.stringify({
            model: "claude-haiku-4-5",
            baseURL: "https://api.example.com",
          }),
        });

        await initState(fs);
        assert.equal(selectors.getModel(), "claude-haiku-4-5");
      });

      it("uses its provider over the default config", async () => {
        const { fs } = makeFs({
          globalExists: true,
          globalContent: JSON.stringify({
            model: "claude-sonnet-4-6",
            provider: "anthropic",
          }),
        });

        await initState(fs);
        assert.equal(selectors.getProvider(), "anthropic");
      });

      it("uses its disableUsageMessage over the default config", async () => {
        const { fs } = makeFs({
          globalExists: true,
          globalContent: JSON.stringify({
            model: "claude-sonnet-4-6",
            baseURL: "https://api.example.com",
            disableUsageMessage: true,
          }),
        });

        await initState(fs);
        assert.equal(selectors.getDisableUsageMessage(), true);
      });

      it("uses its diffStyle over the default config", async () => {
        const { fs } = makeFs({
          globalExists: true,
          globalContent: JSON.stringify({
            model: "claude-sonnet-4-6",
            baseURL: "https://api.example.com",
            diffStyle: "unified",
          }),
        });

        await initState(fs);
        assert.equal(selectors.getDiffStyle(), "unified");
      });

      it("uses its pricingPerModel over the default config", async () => {
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

        await initState(fs);
        assert.deepEqual(selectors.getPricingPerModel(), globalPricing);
      });

      it("uses its keymaps over the default config", async () => {
        const { fs } = makeFs({
          globalExists: true,
          globalContent: JSON.stringify({
            model: "claude-sonnet-4-6",
            baseURL: "https://api.example.com",
            keymaps: {
              editor: { name: "e", ctrl: true, meta: false, shift: false },
            },
          }),
        });

        await initState(fs);
        assert.deepEqual(selectors.getKeymaps(), {
          editor: { name: "e", ctrl: true, meta: false, shift: false },
        });
      });
    });

    describe("when the global config does not exist", () => {
      it("throws when model is not configured", async () => {
        const { fs } = makeFs();
        await assert.rejects(async () => {
          await initState(fs);
        }, /A `model` is required/);
      });

      it("throws when baseURL is not configured for openai-compatible provider", async () => {
        const { fs } = makeFs({
          globalExists: true,
          globalContent: JSON.stringify({ model: "some-model" }),
        });
        await assert.rejects(async () => {
          await initState(fs);
        }, /A `baseURL` is required when `provider=openai-compatible`/);
      });
    });
  });

  it("throws on invalid JSON in global config", async () => {
    const { fs } = makeFs({
      globalExists: true,
      globalContent: "not valid json",
    });

    await assert.rejects(async () => {
      await initState(fs);
    }, /Failed to parse config as JSON/);
  });

  it("throws on invalid JSON in local config", async () => {
    const { fs } = makeFs({
      localExists: true,
      localContent: "not valid json",
    });

    await assert.rejects(async () => {
      await initState(fs);
    }, /Failed to parse config as JSON/);
  });

  it("sets debug from args", async () => {
    const { fs } = makeFs({
      globalExists: true,
      globalContent: JSON.stringify({
        model: "claude-sonnet-4-6",
        baseURL: "https://api.example.com",
      }),
    });

    await initState({
      ...fs,
      parseCliArgs: () => ({ debug: true, resumeSessionId: null }),
    });
    assert.equal(selectors.getDebugLog(), true);
  });

  it("sets agentsMdFilesStr from dep", async () => {
    const { fs } = makeFs({
      globalExists: true,
      globalContent: JSON.stringify({
        model: "claude-sonnet-4-6",
        baseURL: "https://api.example.com",
      }),
    });

    await initState({
      ...fs,
      getRecursiveAgentsMdFilesStr: () =>
        Promise.resolve("FILEPATH: AGENTS.md\nhello"),
    });
    assert.equal(selectors.getAgentsMdFilesStr(), "FILEPATH: AGENTS.md\nhello");
  });
});
