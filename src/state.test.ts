/* eslint-disable @typescript-eslint/no-floating-promises, @typescript-eslint/no-non-null-assertion */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { TokenUsage } from "./utils.ts";
import { getState, resetState, dispatch, actions, selectors } from "./state.ts";
import { DEFAULT_CONFIG } from "./config.ts";

beforeEach(() => {
  resetState();
});

describe("state", () => {
  it("resetState restores initial state after mutations", () => {
    dispatch(actions.setRunning(false));
    dispatch(actions.setInterrupted(true));
    dispatch(actions.appendToMessageParams({ role: "user", content: "hi" }));
    resetState();
    const s = getState();
    assert.equal(s.appState.running, true);
    assert.equal(s.appState.interrupted, false);
    assert.deepEqual(s.appState.messageParams, []);
    assert.deepEqual(s.appState.messageUsages, []);
  });

  it("initial state", () => {
    const s = getState();
    assert.equal(s.appState.running, true);
    assert.equal(s.appState.interrupted, false);
    assert.deepEqual(s.appState.messageParams, []);
    assert.deepEqual(s.appState.messageUsages, []);
  });

  it("set-interrupted", () => {
    dispatch(actions.setInterrupted(true));
    assert.equal(getState().appState.interrupted, true);

    dispatch(actions.setInterrupted(false));
    assert.equal(getState().appState.interrupted, false);
  });

  it("set-running", () => {
    dispatch(actions.setRunning(false));
    assert.equal(getState().appState.running, false);

    dispatch(actions.setRunning(true));
    assert.equal(getState().appState.running, true);
  });

  describe("append-to-message-params", () => {
    it("appends new message to the list", () => {
      dispatch(actions.appendToMessageParams({ role: "user", content: "hi" }));
      assert.equal(getState().appState.messageParams.length, 1);
      assert.deepEqual(getState().appState.messageParams[0], {
        role: "user",
        content: "hi",
      });
    });

    it("appends multiple messages in order", () => {
      dispatch(actions.appendToMessageParams({ role: "user", content: "hi" }));
      dispatch(
        actions.appendToMessageParams({ role: "assistant", content: "hello" }),
      );

      const params = getState().appState.messageParams;
      assert.equal(params.length, 2);
      assert.equal(params[0]!.role, "user");
      assert.equal(params[1]!.role, "assistant");
    });

    it("passes through messages with string content untouched", () => {
      dispatch(
        actions.appendToMessageParams({ role: "user", content: "hello" }),
      );
      dispatch(
        actions.appendToMessageParams({ role: "assistant", content: "world" }),
      );

      const params = getState().appState.messageParams;
      assert.equal(params[0]!.content, "hello");
    });
  });

  it("append-to-message-usages", () => {
    const usage1: TokenUsage = { inputTokens: 10, outputTokens: 5 };
    const usage2: TokenUsage = { inputTokens: 20, outputTokens: 8 };

    dispatch(actions.appendToMessageUsages(usage1));
    dispatch(actions.appendToMessageUsages(usage2));

    assert.deepEqual(getState().appState.messageUsages, [usage1, usage2]);
  });

  it("set-model", () => {
    dispatch(actions.setModel("claude-sonnet-4-6"));
    assert.equal(getState().configState.model, "claude-sonnet-4-6");

    dispatch(actions.setModel("claude-haiku-4-5"));
    assert.equal(getState().configState.model, "claude-haiku-4-5");
  });

  it("set-provider", () => {
    dispatch(actions.setProvider("anthropic"));
    assert.equal(getState().configState.provider, "anthropic");

    dispatch(actions.setProvider("openai-compatible"));
    assert.equal(getState().configState.provider, "openai-compatible");
  });

  it("set-base-url", () => {
    dispatch(actions.setBaseURL("https://api.example.com/v1"));
    assert.equal(
      getState().configState.baseURL,
      "https://api.example.com/v1",
    );

    dispatch(actions.setBaseURL("MISSING"));
    assert.equal(getState().configState.baseURL, "MISSING");
  });

  it("set-pricing-per-model", () => {
    const newPricing = structuredClone(DEFAULT_CONFIG.pricingPerModel);
    newPricing["claude-opus-4-6"]!.inputPerToken = 999;
    dispatch(actions.setPricingPerModel(newPricing));
    assert.deepEqual(getState().configState.pricingPerModel, newPricing);
  });

  it("set-disable-usage-message", () => {
    dispatch(actions.setDisableUsageMessage(true));
    assert.equal(getState().configState.disableUsageMessage, true);

    dispatch(actions.setDisableUsageMessage(false));
    assert.equal(getState().configState.disableUsageMessage, false);
  });
});

describe("selectors", () => {
  it("getInterrupted", () => {
    assert.equal(selectors.getInterrupted(), false);
    dispatch(actions.setInterrupted(true));
    assert.equal(selectors.getInterrupted(), true);
  });

  it("getRunning", () => {
    assert.equal(selectors.getRunning(), true);
    dispatch(actions.setRunning(false));
    assert.equal(selectors.getRunning(), false);
  });

  it("getMessageParams", () => {
    assert.deepEqual(selectors.getMessageParams(), []);
    dispatch(actions.appendToMessageParams({ role: "user", content: "hi" }));
    assert.equal(selectors.getMessageParams().length, 1);
  });

  it("getMessageUsages", () => {
    assert.deepEqual(selectors.getMessageUsages(), []);
    const usage: TokenUsage = { inputTokens: 1, outputTokens: 2 };
    dispatch(actions.appendToMessageUsages(usage));
    assert.deepEqual(selectors.getMessageUsages(), [usage]);
  });

  it("getModel", () => {
    assert.equal(selectors.getModel(), DEFAULT_CONFIG.model);
    dispatch(actions.setModel("claude-haiku-4-5"));
    assert.equal(selectors.getModel(), "claude-haiku-4-5");
  });

  it("getProvider", () => {
    assert.equal(selectors.getProvider(), DEFAULT_CONFIG.provider);
    dispatch(actions.setProvider("anthropic"));
    assert.equal(selectors.getProvider(), "anthropic");
  });

  it("getBaseURL", () => {
    assert.equal(selectors.getBaseURL(), "MISSING");
    dispatch(actions.setBaseURL("https://api.example.com/v1"));
    assert.equal(selectors.getBaseURL(), "https://api.example.com/v1");
  });

  it("getPricingPerModel", () => {
    assert.deepEqual(
      selectors.getPricingPerModel(),
      DEFAULT_CONFIG.pricingPerModel,
    );
    const newPricing = structuredClone(DEFAULT_CONFIG.pricingPerModel);
    newPricing["claude-sonnet-4-6"]!.outputPerToken = 42;
    dispatch(actions.setPricingPerModel(newPricing));
    assert.deepEqual(selectors.getPricingPerModel(), newPricing);
  });

  it("getDisableUsageMessage", () => {
    assert.equal(selectors.getDisableUsageMessage(), false);
    dispatch(actions.setDisableUsageMessage(true));
    assert.equal(selectors.getDisableUsageMessage(), true);
  });
});
