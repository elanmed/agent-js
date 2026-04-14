/* eslint-disable @typescript-eslint/no-floating-promises */
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
    dispatch(actions.setQuestionAbortController(new AbortController()));
    dispatch(actions.setApiStreamAbortController(new AbortController()));
    resetState();
    const s = getState();
    assert.equal(s.appState.running, true);
    assert.equal(s.appState.interrupted, false);
    assert.deepEqual(s.appState.messageParams, []);
    assert.deepEqual(s.appState.messageUsages, []);
    assert.equal(s.abortControllers.question, null);
    assert.equal(s.abortControllers.apiStream, null);
  });

  it("initial state", () => {
    const s = getState();
    assert.equal(s.appState.running, true);
    assert.equal(s.appState.interrupted, false);
    assert.deepEqual(s.appState.messageParams, []);
    assert.deepEqual(s.appState.messageUsages, []);
    assert.equal(s.abortControllers.question, null);
    assert.equal(s.abortControllers.apiStream, null);
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
    const usage1: TokenUsage = {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 2,
      cacheWriteTokens: 1,
    };
    const usage2: TokenUsage = {
      inputTokens: 20,
      outputTokens: 8,
      cacheReadTokens: 4,
      cacheWriteTokens: 2,
    };

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
    newPricing["test-model"] = {
      inputPerToken: 999,
      outputPerToken: 0,
      cacheReadPerToken: 0,
      cacheWritePerToken: 0,
    };
    dispatch(actions.setPricingPerModel(newPricing));
    assert.deepEqual(getState().configState.pricingPerModel, newPricing);
  });

  it("set-disable-usage-message", () => {
    dispatch(actions.setDisableUsageMessage(true));
    assert.equal(getState().configState.disableUsageMessage, true);

    dispatch(actions.setDisableUsageMessage(false));
    assert.equal(getState().configState.disableUsageMessage, false);
  });

  it("set-diff-style", () => {
    dispatch(actions.setDiffStyle("lines"));
    assert.equal(getState().configState.diffStyle, "lines");

    dispatch(actions.setDiffStyle("unified"));
    assert.equal(getState().configState.diffStyle, "unified");
  });

  it("set-question-abort-controller", () => {
    const controller = new AbortController();
    dispatch(actions.setQuestionAbortController(controller));
    assert.equal(getState().abortControllers.question, controller);

    dispatch(actions.setQuestionAbortController(null));
    assert.equal(getState().abortControllers.question, null);
  });

  it("set-api-stream-abort-controller", () => {
    const controller = new AbortController();
    dispatch(actions.setApiStreamAbortController(controller));
    assert.equal(getState().abortControllers.apiStream, controller);

    dispatch(actions.setApiStreamAbortController(null));
    assert.equal(getState().abortControllers.apiStream, null);
  });

  it("set-editor-input-value", () => {
    dispatch(actions.setEditorInputValue("test content"));
    assert.equal(getState().appState.editorInputValue, "test content");

    dispatch(actions.setEditorInputValue(null));
    assert.equal(getState().appState.editorInputValue, null);
  });

  it("set-slash-commands", () => {
    dispatch(actions.setSlashCommands(["test", "deploy"]));
    assert.deepEqual(getState().appState.slashCommands, ["test", "deploy"]);

    dispatch(actions.setSlashCommands([]));
    assert.deepEqual(getState().appState.slashCommands, []);
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
    const usage: TokenUsage = {
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
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
    newPricing["test-model"] = {
      inputPerToken: 0,
      outputPerToken: 42,
      cacheReadPerToken: 0,
      cacheWritePerToken: 0,
    };
    dispatch(actions.setPricingPerModel(newPricing));
    assert.deepEqual(selectors.getPricingPerModel(), newPricing);
  });

  it("getDisableUsageMessage", () => {
    assert.equal(selectors.getDisableUsageMessage(), false);
    dispatch(actions.setDisableUsageMessage(true));
    assert.equal(selectors.getDisableUsageMessage(), true);
  });

  it("getDiffStyle", () => {
    assert.equal(selectors.getDiffStyle(), DEFAULT_CONFIG.diffStyle);
    dispatch(actions.setDiffStyle("lines"));
    assert.equal(selectors.getDiffStyle(), "lines");
  });

  it("getQuestionAbortController", () => {
    assert.equal(selectors.getQuestionAbortController(), null);
    dispatch(actions.setQuestionAbortController(new AbortController()));
    assert.ok(selectors.getQuestionAbortController() instanceof AbortController);
    dispatch(actions.setQuestionAbortController(null));
    assert.equal(selectors.getQuestionAbortController(), null);
  });

  it("getApiStreamAbortController", () => {
    assert.equal(selectors.getApiStreamAbortController(), null);
    dispatch(actions.setApiStreamAbortController(new AbortController()));
    assert.ok(selectors.getApiStreamAbortController() instanceof AbortController);
    dispatch(actions.setApiStreamAbortController(null));
    assert.equal(selectors.getApiStreamAbortController(), null);
  });

  it("getEditorInputValue", () => {
    assert.equal(selectors.getEditorInputValue(), null);
    dispatch(actions.setEditorInputValue("editor content"));
    assert.equal(selectors.getEditorInputValue(), "editor content");
    dispatch(actions.setEditorInputValue(null));
    assert.equal(selectors.getEditorInputValue(), null);
  });

  it("getSlashCommands", () => {
    assert.deepEqual(selectors.getSlashCommands(), []);
    dispatch(actions.setSlashCommands(["cmd1", "cmd2"]));
    assert.deepEqual(selectors.getSlashCommands(), ["cmd1", "cmd2"]);
  });
});
