import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MISSING, type TokenUsage } from "./utils.ts";
import { dispatch, actions, selectors } from "./state.ts";
import { DEFAULT_CONFIG } from "./config.ts";

beforeEach(() => {
  dispatch(actions.resetState());
});

describe("state", () => {
  it("resetState restores initial state after mutations", () => {
    dispatch(actions.setRunning(false));
    dispatch(actions.setInterrupted(true));
    dispatch(actions.appendToMessageParams({ role: "user", content: "hi" }));
    dispatch(actions.setQuestionAbortController(new AbortController()));
    dispatch(actions.setApiStreamAbortController(new AbortController()));
    dispatch(actions.resetState());

    assert.equal(selectors.getRunning(), true);
    assert.equal(selectors.getInterrupted(), false);
    assert.deepEqual(selectors.getMessageParams(), []);
    assert.deepEqual(selectors.getMessageUsages(), []);
    assert.equal(selectors.getQuestionAbortController(), null);
    assert.equal(selectors.getApiStreamAbortController(), null);
  });

  it("initial state", () => {
    assert.equal(selectors.getRunning(), true);
    assert.equal(selectors.getInterrupted(), false);
    assert.deepEqual(selectors.getMessageParams(), []);
    assert.deepEqual(selectors.getMessageUsages(), []);
    assert.equal(selectors.getQuestionAbortController(), null);
    assert.equal(selectors.getApiStreamAbortController(), null);
  });

  it("set-interrupted", () => {
    assert.equal(selectors.getInterrupted(), false);
    dispatch(actions.setInterrupted(true));
    assert.equal(selectors.getInterrupted(), true);
  });

  it("set-running", () => {
    assert.equal(selectors.getRunning(), true);
    dispatch(actions.setRunning(false));
    assert.equal(selectors.getRunning(), false);
  });

  describe("append-to-message-params", () => {
    it("appends new message to the list", () => {
      assert.deepEqual(selectors.getMessageParams(), []);
      dispatch(actions.appendToMessageParams({ role: "user", content: "hi" }));
      assert.equal(selectors.getMessageParams().length, 1);
      assert.deepEqual(selectors.getMessageParams()[0], {
        role: "user",
        content: "hi",
      });
    });

    it("appends multiple messages in order", () => {
      assert.deepEqual(selectors.getMessageParams(), []);
      dispatch(actions.appendToMessageParams({ role: "user", content: "hi" }));
      dispatch(
        actions.appendToMessageParams({ role: "assistant", content: "hello" }),
      );

      const params = selectors.getMessageParams();
      assert.equal(params.length, 2);
      assert.equal(params[0]!.role, "user");
      assert.equal(params[1]!.role, "assistant");
    });
  });

  it("append-to-message-usages", () => {
    assert.deepEqual(selectors.getMessageUsages(), []);
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

    assert.deepEqual(selectors.getMessageUsages(), [usage1, usage2]);
  });

  it("set-model", () => {
    assert.equal(selectors.getModel(), MISSING);
    dispatch(actions.setModel("claude-haiku-4-5"));
    assert.equal(selectors.getModel(), "claude-haiku-4-5");
  });

  it("set-provider", () => {
    assert.equal(selectors.getProvider(), "openai-compatible");
    dispatch(actions.setProvider("anthropic"));
    assert.equal(selectors.getProvider(), "anthropic");
  });

  it("set-base-url", () => {
    assert.equal(selectors.getBaseURL(), null);
    dispatch(actions.setBaseURL("https://api.example.com/v1"));
    assert.equal(selectors.getBaseURL(), "https://api.example.com/v1");
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
    assert.deepEqual(selectors.getPricingPerModel(), newPricing);
  });

  it("set-disable-usage-message", () => {
    assert.equal(selectors.getDisableUsageMessage(), false);
    dispatch(actions.setDisableUsageMessage(true));
    assert.equal(selectors.getDisableUsageMessage(), true);
  });

  it("set-diff-style", () => {
    assert.equal(selectors.getDiffStyle(), "lines");
    dispatch(actions.setDiffStyle("unified"));
    assert.equal(selectors.getDiffStyle(), "unified");
  });

  it("set-keymaps", () => {
    assert.deepEqual(selectors.getKeymaps(), DEFAULT_CONFIG.keymaps);
    dispatch(actions.setKeymaps({ editor: { name: "e", ctrl: true, meta: false, shift: false } }));
    assert.deepEqual(selectors.getKeymaps(), { editor: { name: "e", ctrl: true, meta: false, shift: false } });
  });

  it("set-question-abort-controller", () => {
    assert.equal(selectors.getQuestionAbortController(), null);
    const controller = new AbortController();
    dispatch(actions.setQuestionAbortController(controller));
    assert.equal(selectors.getQuestionAbortController(), controller);
  });

  it("set-api-stream-abort-controller", () => {
    assert.equal(selectors.getApiStreamAbortController(), null);
    const controller = new AbortController();
    dispatch(actions.setApiStreamAbortController(controller));
    assert.equal(selectors.getApiStreamAbortController(), controller);
  });

  it("set-editor-input-value", () => {
    assert.equal(selectors.getEditorInputValue(), null);
    dispatch(actions.setEditorInputValue("test content"));
    assert.equal(selectors.getEditorInputValue(), "test content");
  });

  it("set-debug", () => {
    assert.equal(selectors.getDebug(), false);
    dispatch(actions.setDebug(true));
    assert.equal(selectors.getDebug(), true);
  });

  it("set-agents-md-files-str", () => {
    assert.equal(selectors.getAgentsMdFilesStr(), "");
    dispatch(actions.setAgentsMdFilesStr("FILEPATH: AGENTS.md\nhello"));
    assert.equal(selectors.getAgentsMdFilesStr(), "FILEPATH: AGENTS.md\nhello");
  });

  it("set-slash-commands", () => {
    assert.deepEqual(selectors.getSlashCommands(), []);
    dispatch(actions.setSlashCommands(["test", "deploy"]));
    assert.deepEqual(selectors.getSlashCommands(), ["test", "deploy"]);
  });

  it("reset-stdout", () => {
    dispatch(actions.appendToStdout("line1\n"));
    dispatch(actions.appendToStdout("line2\n"));
    assert.equal(selectors.getStdout(), "line1\nline2\n");
    dispatch(actions.resetStdout());
    assert.equal(selectors.getStdout(), "");
  });

  describe("append-to-stdout", () => {
    it("appends single line", () => {
      assert.equal(selectors.getStdout(), "");
      dispatch(actions.appendToStdout("line1\n"));
      assert.equal(selectors.getStdout(), "line1\n");
    });

    it("appends multiple lines in order", () => {
      assert.equal(selectors.getStdout(), "");
      dispatch(actions.appendToStdout("line1\n"));
      dispatch(actions.appendToStdout("line2\n"));
      dispatch(actions.appendToStdout("line3\n"));
      assert.equal(selectors.getStdout(), "line1\nline2\nline3\n");
    });
  });
});
