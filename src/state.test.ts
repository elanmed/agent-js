import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert";
import { MISSING } from "./utils.ts";
import type { TokenUsage } from "./print.ts";
import { actions, getState } from "./state.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import { makeFakeRl } from "./test-helpers.ts";

describe("state", () => {
  beforeEach(() => {
    actions.resetState();
  });

  it("resetState restores initial state after mutations", () => {
    actions.appendToMessageParams({ role: "user", content: "hi" });
    actions.setQuestionAbortController(new AbortController());
    actions.setApiStreamAbortController(new AbortController());
    const timeout = setTimeout(() => undefined, 1000);
    actions.setLoadingStateTimeout(timeout);
    actions.setPromptHistoryPath("/tmp/test.log");
    actions.resetState();
    clearTimeout(timeout);

    assert.deepStrictEqual(getState().app.messageParams, []);
    assert.deepStrictEqual(getState().app.messageUsages, []);
    assert.equal(getState().abortControllers.question, null);
    assert.equal(getState().abortControllers.apiStream, null);
    assert.equal(getState().app.loadingStateTimeout, null);
    assert.equal(getState().app.loadingStateFrameIdx, 0);
    assert.equal(getState().app.apiStartTime, null);
    assert.equal(getState().app.apiEndTime, null);
    assert.equal(getState().app.chatHistoryPath, "");
  });

  it("initial state", () => {
    assert.deepStrictEqual(getState().app.messageParams, []);
    assert.deepStrictEqual(getState().app.messageUsages, []);
    assert.equal(getState().abortControllers.question, null);
    assert.equal(getState().abortControllers.apiStream, null);
    assert.equal(getState().app.apiStartTime, null);
    assert.equal(getState().app.apiEndTime, null);
    assert.equal(getState().app.chatHistoryPath, "");
  });

  describe("append-to-message-params", () => {
    it("appends new message to the list", () => {
      assert.deepStrictEqual(getState().app.messageParams, []);
      actions.appendToMessageParams({ role: "user", content: "hi" });
      assert.equal(getState().app.messageParams.length, 1);
      assert.deepStrictEqual(getState().app.messageParams[0], {
        role: "user",
        content: "hi",
      });
    });

    it("appends multiple messages in order", () => {
      assert.deepStrictEqual(getState().app.messageParams, []);
      actions.appendToMessageParams({ role: "user", content: "hi" });
      actions.appendToMessageParams({ role: "assistant", content: "hello" });

      const params = getState().app.messageParams;
      assert.equal(params.length, 2);
      assert.equal(params[0]!.role, "user");
      assert.equal(params[1]!.role, "assistant");
    });
  });

  it("append-to-message-usages", () => {
    assert.deepStrictEqual(getState().app.messageUsages, []);
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

    actions.appendToMessageUsages(usage1);
    actions.appendToMessageUsages(usage2);

    assert.deepStrictEqual(getState().app.messageUsages, [usage1, usage2]);
  });

  it("set-model", () => {
    assert.equal(getState().config.model, MISSING);
    actions.setModel("claude-haiku-4-5");
    assert.equal(getState().config.model, "claude-haiku-4-5");
  });

  it("set-provider", () => {
    assert.equal(getState().config.provider, "openai-compatible");
    actions.setProvider("anthropic");
    assert.equal(getState().config.provider, "anthropic");
  });

  it("set-base-url", () => {
    assert.equal(getState().config.baseURL, null);
    actions.setBaseURL("https://api.example.com/v1");
    assert.equal(getState().config.baseURL, "https://api.example.com/v1");
  });

  it("set-pricing-per-model", () => {
    const newPricing = structuredClone(DEFAULT_CONFIG.pricingPerModel);
    newPricing["test-model"] = {
      inputPerToken: 999,
      outputPerToken: 0,
      cacheReadPerToken: 0,
      cacheWritePerToken: 0,
    };
    actions.setPricingPerModel(newPricing);
    assert.deepStrictEqual(getState().config.pricingPerModel, newPricing);
  });

  it("set-keymap-edit-prompt", () => {
    assert.deepStrictEqual(
      getState().config.keymapEditPrompt,
      DEFAULT_CONFIG.keymaps.edit,
    );
    actions.setKeymapEditPrompt({
      name: "v",
      ctrl: false,
      meta: false,
      shift: false,
    });
    assert.deepStrictEqual(getState().config.keymapEditPrompt, {
      name: "v",
      ctrl: false,
      meta: false,
      shift: false,
    });
  });

  it("set-keymap-prompt-history", () => {
    assert.deepStrictEqual(
      getState().config.keymapChatHistory,
      DEFAULT_CONFIG.keymaps.history,
    );
    actions.setKeymapPromptHistory({
      name: "o",
      ctrl: false,
      meta: false,
      shift: false,
    });
    assert.deepStrictEqual(getState().config.keymapChatHistory, {
      name: "o",
      ctrl: false,
      meta: false,
      shift: false,
    });
  });

  it("set-keymap-clear", () => {
    assert.deepStrictEqual(
      getState().config.keymapClear,
      DEFAULT_CONFIG.keymaps.clear,
    );
    actions.setKeymapClear({
      name: "k",
      ctrl: false,
      meta: false,
      shift: false,
    });
    assert.deepStrictEqual(getState().config.keymapClear, {
      name: "k",
      ctrl: false,
      meta: false,
      shift: false,
    });
  });

  it("set-question-abort-controller", () => {
    assert.equal(getState().abortControllers.question, null);
    const controller = new AbortController();
    actions.setQuestionAbortController(controller);
    assert.equal(getState().abortControllers.question, controller);
  });

  it("set-api-stream-abort-controller", () => {
    assert.equal(getState().abortControllers.apiStream, null);
    const controller = new AbortController();
    actions.setApiStreamAbortController(controller);
    assert.equal(getState().abortControllers.apiStream, controller);
  });

  it("set-editor-input-value", () => {
    assert.equal(getState().app.editorInputValue, null);
    actions.setEditorInputValue("test content");
    assert.equal(getState().app.editorInputValue, "test content");
  });

  it("set-debug-log", () => {
    assert.equal(getState().app.debugLog, false);
    actions.setDebugLog(true);
    assert.equal(getState().app.debugLog, true);
  });

  it("set-prompt-history-path", () => {
    assert.equal(getState().app.chatHistoryPath, "");
    actions.setPromptHistoryPath("/tmp/editor.log");
    assert.equal(getState().app.chatHistoryPath, "/tmp/editor.log");
  });

  it("set-context-str", () => {
    assert.equal(getState().app.contextStr, "");
    actions.setContextStr("FILEPATH: context\nhello");
    assert.equal(
      getState().app.contextStr,
      `FILEPATH: context
hello`,
    );
  });

  it("set-skills-str", () => {
    assert.equal(getState().app.skillsStr, "");
    actions.setSkillsStr("- skill: desc");
    assert.equal(getState().app.skillsStr, "- skill: desc");
  });

  describe("set-context-entries", () => {
    it("sets the context entries array", () => {
      assert.deepStrictEqual(getState().app.contextEntries, []);
      actions.setContextEntries([
        { filePath: "/test/AGENTS.md", content: "# Instructions" },
      ]);
      assert.deepStrictEqual(getState().app.contextEntries, [
        { filePath: "/test/AGENTS.md", content: "# Instructions" },
      ]);
    });

    it("replaces existing context entries", () => {
      actions.setContextEntries([{ filePath: "/a/AGENTS.md", content: "A" }]);
      actions.setContextEntries([{ filePath: "/b/AGENTS.md", content: "B" }]);
      assert.equal(getState().app.contextEntries.length, 1);
      assert.equal(getState().app.contextEntries[0]!.filePath, "/b/AGENTS.md");
    });
  });

  describe("set-skills", () => {
    it("sets the skills array", () => {
      assert.deepStrictEqual(getState().app.skills, []);
      actions.setSkills([
        {
          name: "deploy",
          description: "Deploy skill",
          dir: "/skills/deploy",
          content: "# Deploy instructions",
        },
      ]);
      assert.deepStrictEqual(getState().app.skills, [
        {
          name: "deploy",
          description: "Deploy skill",
          dir: "/skills/deploy",
          content: "# Deploy instructions",
        },
      ]);
    });

    it("replaces existing skills", () => {
      actions.setSkills([
        {
          name: "a",
          description: "Skill A",
          dir: "/a",
          content: "content a",
        },
      ]);
      actions.setSkills([
        {
          name: "b",
          description: "Skill B",
          dir: "/b",
          content: "content b",
        },
      ]);
      assert.equal(getState().app.skills.length, 1);
      assert.equal(getState().app.skills[0]!.name, "b");
    });
  });

  it("set-slash-commands", () => {
    assert.deepStrictEqual(getState().app.slashCommands, []);
    actions.setSlashCommands([
      { name: "test", filePath: "/test.md", content: "test content" },
      { name: "deploy", filePath: "/deploy.md", content: "deploy content" },
    ]);
    assert.deepStrictEqual(getState().app.slashCommands, [
      { name: "test", filePath: "/test.md", content: "test content" },
      { name: "deploy", filePath: "/deploy.md", content: "deploy content" },
    ]);
  });

  it("set-custom-slash-command-dirs", () => {
    assert.deepStrictEqual(getState().app.customSlashCommandDirs, []);
    actions.setCustomSlashCommandDirs(["/my-commands", "/more"]);
    assert.deepStrictEqual(getState().app.customSlashCommandDirs, [
      "/my-commands",
      "/more",
    ]);
  });

  it("set-custom-skill-dirs", () => {
    assert.deepStrictEqual(getState().app.customSkillDirs, []);
    actions.setCustomSkillDirs(["/my-skills", "/more"]);
    assert.deepStrictEqual(getState().app.customSkillDirs, [
      "/my-skills",
      "/more",
    ]);
  });

  it("reset-stdout", () => {
    actions.appendToStdout("line1\n");
    actions.appendToStdout("line2\n");
    assert.equal(
      getState().app.stdout,
      `line1
line2
`,
    );
    actions.resetStdout();
    assert.equal(getState().app.stdout, "");
  });

  describe("append-to-stdout", () => {
    it("appends single line", () => {
      assert.equal(getState().app.stdout, "");
      actions.appendToStdout("line1\n");
      assert.equal(getState().app.stdout, "line1\n");
    });

    it("appends multiple lines in order", () => {
      assert.equal(getState().app.stdout, "");
      actions.appendToStdout("line1\n");
      actions.appendToStdout("line2\n");
      actions.appendToStdout("line3\n");
      assert.equal(
        getState().app.stdout,
        `line1
line2
line3
`,
      );
    });
  });

  it("set-rl", () => {
    assert.equal(getState().app.rl, null);
    const fakeRl = makeFakeRl();
    actions.setRl(fakeRl);
    assert.equal(getState().app.rl, fakeRl);
  });

  it("set-api-start-time", () => {
    mock.method(Date, "now", () => 42_000);
    assert.equal(getState().app.apiStartTime, null);
    actions.setApiStartTime();
    assert.strictEqual(getState().app.apiStartTime, 42_000);
  });

  it("set-api-end-time", () => {
    mock.method(Date, "now", () => 99_000);
    assert.equal(getState().app.apiEndTime, null);
    actions.setApiEndTime();
    assert.strictEqual(getState().app.apiEndTime, 99_000);
  });

  it("set-loading-state-frames", () => {
    assert.deepStrictEqual(getState().config.loadingStateFrames, [
      "|",
      "/",
      "-",
      "\\",
    ]);
    actions.setLoadingStateFrames(["⠋", "⠙", "⠹", "⠸"]);
    assert.deepStrictEqual(getState().config.loadingStateFrames, [
      "⠋",
      "⠙",
      "⠹",
      "⠸",
    ]);
  });

  it("set-loading-state-timeout", () => {
    assert.equal(getState().app.loadingStateTimeout, null);
    const timeout = setTimeout(() => undefined, 1000);
    actions.setLoadingStateTimeout(timeout);
    assert.equal(getState().app.loadingStateTimeout, timeout);
    clearTimeout(timeout);
    actions.setLoadingStateTimeout(null);
    assert.equal(getState().app.loadingStateTimeout, null);
  });
});
