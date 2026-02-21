/* eslint-disable @typescript-eslint/no-floating-promises, @typescript-eslint/no-non-null-assertion */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
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

    it("sets cache_control to null on prior messages with array content", () => {
      dispatch(
        actions.appendToMessageParams({
          role: "user",
          content: [
            {
              type: "text",
              text: "first",
              cache_control: { type: "ephemeral" },
            },
          ],
        }),
      );

      dispatch(
        actions.appendToMessageParams({
          role: "assistant",
          content: [{ type: "text", text: "second" }],
        }),
      );

      const params = getState().appState.messageParams;
      assert.equal(params.length, 2);
      const firstContent = params[0]!.content;
      assert.ok(Array.isArray(firstContent));
      assert.equal(
        (firstContent[0] as { cache_control: unknown }).cache_control,
        null,
      );
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

  it("append-to-message-responses", () => {
    const usage1 = {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    } as Anthropic.Messages.Usage;
    const usage2 = {
      input_tokens: 20,
      output_tokens: 8,
      cache_creation_input_tokens: 2,
      cache_read_input_tokens: 1,
    } as Anthropic.Messages.Usage;

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

  it("set-pricing-per-model", () => {
    const newPricing = structuredClone(DEFAULT_CONFIG.pricingPerModel);
    newPricing["claude-opus-4-6"].inputPerToken = 999;
    dispatch(actions.setPricingPerModel(newPricing));
    assert.deepEqual(getState().configState.pricingPerModel, newPricing);
  });

  it("set-disable-cost-message", () => {
    dispatch(actions.setDisableCostMessage(true));
    assert.equal(getState().configState.disableCostMessage, true);

    dispatch(actions.setDisableCostMessage(false));
    assert.equal(getState().configState.disableCostMessage, false);
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
    const usage = {
      input_tokens: 1,
      output_tokens: 2,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    } as Anthropic.Messages.Usage;
    dispatch(actions.appendToMessageUsages(usage));
    assert.deepEqual(selectors.getMessageUsages(), [usage]);
  });

  it("getModel", () => {
    assert.equal(selectors.getModel(), DEFAULT_CONFIG.model);
    dispatch(actions.setModel("claude-haiku-4-5"));
    assert.equal(selectors.getModel(), "claude-haiku-4-5");
  });

  it("getPricingPerModel", () => {
    assert.deepEqual(
      selectors.getPricingPerModel(),
      DEFAULT_CONFIG.pricingPerModel,
    );
    const newPricing = structuredClone(DEFAULT_CONFIG.pricingPerModel);
    newPricing["claude-sonnet-4-6"].outputPerToken = 42;
    dispatch(actions.setPricingPerModel(newPricing));
    assert.deepEqual(selectors.getPricingPerModel(), newPricing);
  });

  it("getDisableCostMessage", () => {
    assert.equal(selectors.getDisableCostMessage(), false);
    dispatch(actions.setDisableCostMessage(true));
    assert.equal(selectors.getDisableCostMessage(), true);
  });
});
