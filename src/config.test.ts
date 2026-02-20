/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { resetState, selectors } from "./state.ts";
import {
  initStateFromConfig,
  DEFAULT_CONFIG,
  GLOBAL_CONFIG_PATH,
} from "./config.ts";

const fsState = {
  globalExists: false,
  globalContent: "{}",
  localExists: false,
  localContent: "{}",
};

describe("initStateFromConfig", () => {
  let writeFileArgs: [string, string] | null = null;

  beforeEach(() => {
    resetState();
    writeFileArgs = null;
    fsState.globalExists = false;
    fsState.globalContent = "{}";
    fsState.localExists = false;
    fsState.localContent = "{}";

    mock.method(fs, "existsSync", ((path: unknown): boolean => {
      return path === GLOBAL_CONFIG_PATH
        ? fsState.globalExists
        : fsState.localExists;
    }) as unknown as typeof fs.existsSync);

    mock.method(fs, "readFileSync", ((path: unknown) => ({
      toString: (): string => {
        return path === GLOBAL_CONFIG_PATH
          ? fsState.globalContent
          : fsState.localContent;
      },
    })) as unknown as typeof fs.readFileSync);

    mock.method(fs, "writeFileSync", ((path: string, content: string) => {
      writeFileArgs = [path, content];
    }) as unknown as typeof fs.writeFileSync);
  });

  afterEach(() => {
    mock.restoreAll();
  });

  describe("when local config exists", () => {
    beforeEach(() => {
      fsState.localExists = true;
      fsState.globalExists = true;
    });

    it("uses its model over the global config, default config", () => {
      fsState.globalContent = JSON.stringify({ model: "claude-sonnet-4-6" });
      fsState.localContent = JSON.stringify({ model: "claude-haiku-4-5" });
      initStateFromConfig();

      assert.equal(selectors.getModel(), "claude-haiku-4-5");
    });

    it("uses its disableCostMessage over the global config, default config", () => {
      fsState.globalContent = JSON.stringify({ disableCostMessage: false });
      fsState.localContent = JSON.stringify({ disableCostMessage: true });

      initStateFromConfig();

      assert.equal(selectors.getDisableCostMessage(), true);
    });

    it("uses its pricingPerModel over the global config, default config", () => {
      const localPricing = structuredClone(DEFAULT_CONFIG.pricingPerModel);
      localPricing["claude-opus-4-6"].inputPerToken = 999;

      fsState.globalContent = JSON.stringify({
        pricingPerModel: DEFAULT_CONFIG.pricingPerModel,
      });
      fsState.localContent = JSON.stringify({ pricingPerModel: localPricing });

      initStateFromConfig();

      assert.deepEqual(selectors.getPricingPerModel(), localPricing);
    });
  });

  describe("when local config does not exist", () => {
    beforeEach(() => {
      fsState.localExists = false;
      fsState.globalExists = true;
    });

    describe("when the global config exists", () => {
      it("uses its model over the default config", () => {
        fsState.globalContent = JSON.stringify({ model: "claude-haiku-4-5" });
        initStateFromConfig();
        assert.equal(selectors.getModel(), "claude-haiku-4-5");
      });

      it("uses its disableCostMessage over the default config", () => {
        fsState.globalContent = JSON.stringify({ disableCostMessage: true });
        initStateFromConfig();
        assert.equal(selectors.getDisableCostMessage(), true);
      });

      it("uses its pricingPerModel over the default config", () => {
        const globalPricing = structuredClone(DEFAULT_CONFIG.pricingPerModel);
        globalPricing["claude-opus-4-6"].inputPerToken = 999;
        fsState.globalContent = JSON.stringify({
          pricingPerModel: globalPricing,
        });
        initStateFromConfig();
        assert.deepEqual(selectors.getPricingPerModel(), globalPricing);
      });
    });

    describe("when the global config does not exist", () => {
      beforeEach(() => {
        fsState.globalExists = false;
      });

      it("writes the global config as the default config", () => {
        initStateFromConfig();

        assert.ok(writeFileArgs !== null);
        assert.deepEqual(JSON.parse(writeFileArgs[1]), DEFAULT_CONFIG);
      });

      it("uses the default model", () => {
        initStateFromConfig();
        assert.equal(selectors.getModel(), DEFAULT_CONFIG.model);
      });

      it("uses the default disableCostMessage", () => {
        initStateFromConfig();
        assert.equal(
          selectors.getDisableCostMessage(),
          DEFAULT_CONFIG.disableCostMessage,
        );
      });

      it("uses the default pricingPerModel", () => {
        initStateFromConfig();
        assert.deepEqual(
          selectors.getPricingPerModel(),
          DEFAULT_CONFIG.pricingPerModel,
        );
      });
    });
  });

  it("throws on invalid JSON in global config", () => {
    fsState.globalExists = true;
    fsState.globalContent = "not valid json";

    assert.throws(() => {
      initStateFromConfig();
    }, /Failed to parse config as JSON/);
  });

  it("throws on invalid JSON in local config", () => {
    fsState.localExists = true;
    fsState.localContent = "not valid json";

    assert.throws(() => {
      initStateFromConfig();
    }, /Failed to parse config as JSON/);
  });
});
