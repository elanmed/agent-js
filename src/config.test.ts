/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { resetState, selectors } from "./state.ts";
import {
  initStateFromConfig,
  DEFAULT_CONFIG,
  GLOBAL_CONFIG_PATH,
  LOCAL_CONFIG_PATH,
} from "./config.ts";

const fsState = {
  globalExists: false,
  globalContent: "{}",
  localExists: false,
  localContent: "{}",
};

let originalExistsSync = fs.existsSync;
let originalReadFileSync = fs.readFileSync;
let originalMkdirSync = fs.mkdirSync;
let originalWriteFileSync = fs.writeFileSync;

describe("initStateFromConfig", () => {
  let writeFileArgs: [string, string] | null = null;

  beforeEach(() => {
    resetState();
    writeFileArgs = null;
    fsState.globalExists = false;
    fsState.globalContent = "{}";
    fsState.localExists = false;
    fsState.localContent = "{}";

    originalExistsSync = fs.existsSync;
    originalReadFileSync = fs.readFileSync;
    originalMkdirSync = fs.mkdirSync;
    originalWriteFileSync = fs.writeFileSync;

    fs.existsSync = ((path: unknown): boolean => {
      return path === GLOBAL_CONFIG_PATH
        ? fsState.globalExists
        : fsState.localExists;
    }) as typeof fs.existsSync;

    fs.readFileSync = ((path: unknown) => ({
      toString: (): string => {
        return path === GLOBAL_CONFIG_PATH
          ? fsState.globalContent
          : fsState.localContent;
      },
    })) as typeof fs.readFileSync;

    fs.mkdirSync = (() => undefined) as typeof fs.mkdirSync;
    fs.writeFileSync = ((path: string, content: string) => {
      if (path === GLOBAL_CONFIG_PATH || path === LOCAL_CONFIG_PATH) {
        writeFileArgs = [path, content];
      }
      if (path === LOCAL_CONFIG_PATH) {
        fsState.localContent = content;
      }
      if (path === GLOBAL_CONFIG_PATH) {
        fsState.globalContent = content;
      }
    }) as typeof fs.writeFileSync;
  });

  afterEach(() => {
    fs.existsSync = originalExistsSync;
    fs.readFileSync = originalReadFileSync;
    fs.mkdirSync = originalMkdirSync;
    fs.writeFileSync = originalWriteFileSync;
  });

  describe("when local config exists", () => {
    beforeEach(() => {
      fsState.localExists = true;
      fsState.globalExists = true;
    });

    it("uses its model over the global config, default config", () => {
      fsState.globalContent = JSON.stringify({
        model: "claude-sonnet-4-6",
        baseURL: "https://api.example.com",
      });
      fsState.localContent = JSON.stringify({
        model: "claude-haiku-4-5",
        baseURL: "https://api.example.com",
      });
      initStateFromConfig();

      assert.equal(selectors.getModel(), "claude-haiku-4-5");
    });

    it("uses its provider over the global config, default config", () => {
      fsState.globalContent = JSON.stringify({
        model: "claude-sonnet-4-6",
        provider: "openai-compatible",
      });
      fsState.localContent = JSON.stringify({
        model: "claude-sonnet-4-6",
        provider: "anthropic",
      });

      initStateFromConfig();

      assert.equal(selectors.getProvider(), "anthropic");
    });

    it("uses its disableUsageMessage over the global config, default config", () => {
      fsState.globalContent = JSON.stringify({
        model: "claude-sonnet-4-6",
        baseURL: "https://api.example.com",
        disableUsageMessage: false,
      });
      fsState.localContent = JSON.stringify({
        model: "claude-sonnet-4-6",
        baseURL: "https://api.example.com",
        disableUsageMessage: true,
      });

      initStateFromConfig();

      assert.equal(selectors.getDisableUsageMessage(), true);
    });

    it("uses its diffStyle over the global config, default config", () => {
      fsState.globalContent = JSON.stringify({
        model: "claude-sonnet-4-6",
        baseURL: "https://api.example.com",
        diffStyle: "lines",
      });
      fsState.localContent = JSON.stringify({
        model: "claude-sonnet-4-6",
        baseURL: "https://api.example.com",
        diffStyle: "unified",
      });

      initStateFromConfig();

      assert.equal(selectors.getDiffStyle(), "unified");
    });

    it("uses its pricingPerModel over the global config, default config", () => {
      const localPricing = structuredClone(DEFAULT_CONFIG.pricingPerModel);
      const localOpusPricing = localPricing["claude-opus-4-6"];
      assert.ok(localOpusPricing);
      localOpusPricing.inputPerToken = 999;

      fsState.globalContent = JSON.stringify({
        model: "claude-sonnet-4-6",
        baseURL: "https://api.example.com",
        pricingPerModel: DEFAULT_CONFIG.pricingPerModel,
      });
      fsState.localContent = JSON.stringify({
        model: "claude-sonnet-4-6",
        baseURL: "https://api.example.com",
        pricingPerModel: localPricing,
      });

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
        fsState.globalContent = JSON.stringify({
          model: "claude-haiku-4-5",
          baseURL: "https://api.example.com",
        });
        initStateFromConfig();
        assert.equal(selectors.getModel(), "claude-haiku-4-5");
      });

      it("uses its provider over the default config", () => {
        fsState.globalContent = JSON.stringify({
          model: "claude-sonnet-4-6",
          provider: "anthropic",
        });
        initStateFromConfig();
        assert.equal(selectors.getProvider(), "anthropic");
      });

      it("uses its disableUsageMessage over the default config", () => {
        fsState.globalContent = JSON.stringify({
          model: "claude-sonnet-4-6",
          baseURL: "https://api.example.com",
          disableUsageMessage: true,
        });
        initStateFromConfig();
        assert.equal(selectors.getDisableUsageMessage(), true);
      });

      it("uses its diffStyle over the default config", () => {
        fsState.globalContent = JSON.stringify({
          model: "claude-sonnet-4-6",
          baseURL: "https://api.example.com",
          diffStyle: "unified",
        });
        initStateFromConfig();
        assert.equal(selectors.getDiffStyle(), "unified");
      });

      it("uses its pricingPerModel over the default config", () => {
        const globalPricing = structuredClone(DEFAULT_CONFIG.pricingPerModel);
        const globalOpusPricing = globalPricing["claude-opus-4-6"];
        assert.ok(globalOpusPricing);
        globalOpusPricing.inputPerToken = 999;
        fsState.globalContent = JSON.stringify({
          model: "claude-sonnet-4-6",
          baseURL: "https://api.example.com",
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
        try {
          initStateFromConfig();
        } catch {
          // Expected to throw due to missing model
        }

        assert.ok(writeFileArgs !== null);
        assert.deepEqual(JSON.parse(writeFileArgs[1]), DEFAULT_CONFIG);
      });

      it("throws when model is not configured", () => {
        assert.throws(() => {
          initStateFromConfig();
        }, /A `model` is required/);
      });

      it("throws when baseURL is not configured for openai-compatible provider", () => {
        fsState.globalContent = JSON.stringify({ model: "some-model" });
        fsState.globalExists = true;
        assert.throws(() => {
          initStateFromConfig();
        }, /A `baseURL` is required when `provider=openai-compatible`/);
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
