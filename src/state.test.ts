import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert";
import { actions, getState } from "./state.ts";
import { defaultConfig } from "./config.ts";
import { makeFakeRl } from "./test-helpers.ts";

describe("state", () => {
  beforeEach(() => {
    actions.resetState();
  });

  it("resetState restores initial state after mutations", () => {
    actions.appendToMessageParams({ role: "user", content: "hi" }, 0);
    actions.setQuestionAbortController(new AbortController());
    actions.setApiStreamAbortController(new AbortController());
    const timeout = setTimeout(() => undefined, 1_000);
    actions.setLoadingStateTimeout(timeout);
    actions.setChatHistoryPath("/tmp/test.log");
    actions.setModelUsageForSession({ "gpt-4": [] });
    actions.resetState();
    clearTimeout(timeout);

    assert.deepStrictEqual(getState().app.messageParams, {
      tokens: 0,
      messages: [],
    });
    assert.deepStrictEqual(getState().app.modelUsageForLimitWindow, {});
    assert.deepStrictEqual(getState().app.modelUsageForSession, {});
    assert.equal(getState().abortControllers.question, null);
    assert.equal(getState().abortControllers.apiStream, null);
    assert.equal(getState().app.loadingStateTimeout, null);
    assert.equal(getState().app.loadingStateFrameIdx, 0);
    assert.equal(getState().app.apiStartTime, null);
    assert.equal(getState().app.apiEndTime, null);
    assert.equal(getState().app.sessionStartDate, 0);
    assert.equal(getState().app.chatHistoryPath, "");
  });

  it("initial state", () => {
    assert.deepStrictEqual(getState().app.messageParams, {
      tokens: 0,
      messages: [],
    });
    assert.deepStrictEqual(getState().app.modelUsageForLimitWindow, {});
    assert.deepStrictEqual(getState().app.modelUsageForSession, {});
    assert.equal(getState().abortControllers.question, null);
    assert.equal(getState().abortControllers.apiStream, null);
    assert.equal(getState().app.apiStartTime, null);
    assert.equal(getState().app.apiEndTime, null);
    assert.equal(getState().app.sessionStartDate, 0);
    assert.equal(getState().app.chatHistoryPath, "");
  });

  describe("append-to-message-params", () => {
    it("appends new message to the list", () => {
      assert.deepStrictEqual(getState().app.messageParams, {
        tokens: 0,
        messages: [],
      });
      actions.appendToMessageParams({ role: "user", content: "hi" }, 5);
      assert.equal(getState().app.messageParams.messages.length, 1);
      assert.deepStrictEqual(getState().app.messageParams, {
        tokens: 5,
        messages: [{ role: "user", content: "hi" }],
      });
    });

    it("appends multiple messages in order", () => {
      assert.deepStrictEqual(getState().app.messageParams, {
        tokens: 0,
        messages: [],
      });
      actions.appendToMessageParams({ role: "user", content: "hi" }, 2);
      actions.appendToMessageParams({ role: "assistant", content: "hello" }, 3);

      const params = getState().app.messageParams.messages;
      assert.equal(params.length, 2);
      assert.equal(params[0]!.role, "user");
      assert.equal(params[1]!.role, "assistant");
      assert.equal(getState().app.messageParams.tokens, 5);
    });
  });

  it("reset-message-params", () => {
    actions.appendToMessageParams({ role: "user", content: "hi" }, 7);
    assert.equal(getState().app.messageParams.tokens, 7);
    actions.resetMessageParams();
    assert.deepStrictEqual(getState().app.messageParams, {
      tokens: 0,
      messages: [],
    });
  });

  it("set-model", () => {
    assert.equal(getState().config.model, "");
    actions.setModel("claude-haiku-4-5");
    assert.equal(getState().config.model, "claude-haiku-4-5");
  });

  it("set-provider", () => {
    assert.equal(getState().config.provider, "openai-compatible");
    actions.setProvider("anthropic");
    assert.equal(getState().config.provider, "anthropic");
  });

  it("set-base-url", () => {
    assert.equal(getState().config.baseURL, undefined);
    actions.setBaseURL("https://api.example.com/v1");
    assert.equal(getState().config.baseURL, "https://api.example.com/v1");
  });

  it("set-pricing-per-model", () => {
    const newPricing = structuredClone(defaultConfig.pricingPerModel);
    newPricing["test-model"] = {
      inputPerMillion: 999,
      outputPerMillion: 0,
      cacheReadPerMillion: 0,
      cacheWritePerMillion: 0,
    };
    actions.setPricingPerModel(newPricing);
    assert.deepStrictEqual(getState().config.pricingPerModel, newPricing);
  });

  it("set-context-window-per-model", () => {
    assert.deepStrictEqual(getState().config.contextWindowPerModel, {});
    actions.setContextWindowPerModel({ "test-model": 200_000 });
    assert.deepStrictEqual(getState().config.contextWindowPerModel, {
      "test-model": 200_000,
    });
  });

  it("set-compact-trigger-ratio", () => {
    assert.strictEqual(getState().config.compactTriggerRatio, 0.7);
    actions.setCompactTriggerRatio(0.5);
    assert.strictEqual(getState().config.compactTriggerRatio, 0.5);
  });

  it("set-compact-target-ratio", () => {
    assert.strictEqual(getState().config.compactTargetRatio, 0.3);
    actions.setCompactTargetRatio(0.25);
    assert.strictEqual(getState().config.compactTargetRatio, 0.25);
  });

  it("set-keymap-edit-prompt", () => {
    assert.deepStrictEqual(
      getState().config.keymaps.edit,
      defaultConfig.keymaps.edit,
    );
    actions.setKeymapEditPrompt({
      name: "v",
      ctrl: false,
      meta: false,
      shift: false,
    });
    assert.deepStrictEqual(getState().config.keymaps.edit, {
      name: "v",
      ctrl: false,
      meta: false,
      shift: false,
    });
  });

  it("set-keymap-chat-history", () => {
    assert.deepStrictEqual(
      getState().config.keymaps.history,
      defaultConfig.keymaps.history,
    );
    actions.setKeymapChatHistory({
      name: "o",
      ctrl: false,
      meta: false,
      shift: false,
    });
    assert.deepStrictEqual(getState().config.keymaps.history, {
      name: "o",
      ctrl: false,
      meta: false,
      shift: false,
    });
  });

  it("set-keymap-clear", () => {
    assert.deepStrictEqual(
      getState().config.keymaps.clear,
      defaultConfig.keymaps.clear,
    );
    actions.setKeymapClear({
      name: "k",
      ctrl: false,
      meta: false,
      shift: false,
    });
    assert.deepStrictEqual(getState().config.keymaps.clear, {
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

  it("set-debug-log-path", () => {
    assert.equal(getState().app.debugLogPath, "");
    actions.setDebugLogPath("/fake-home/.config/agent-js/debug-test-uuid.log");
    assert.equal(
      getState().app.debugLogPath,
      "/fake-home/.config/agent-js/debug-test-uuid.log",
    );
  });

  it("set-prompt-history-path", () => {
    assert.equal(getState().app.chatHistoryPath, "");
    actions.setChatHistoryPath("/tmp/editor.log");
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
    assert.deepStrictEqual(getState().config.customSlashCommandDirs, []);
    actions.setCustomSlashCommandDirs(["/my-commands", "/more"]);
    assert.deepStrictEqual(getState().config.customSlashCommandDirs, [
      "/my-commands",
      "/more",
    ]);
  });

  it("set-custom-skill-dirs", () => {
    assert.deepStrictEqual(getState().config.customSkillDirs, []);
    actions.setCustomSkillDirs(["/my-skills", "/more"]);
    assert.deepStrictEqual(getState().config.customSkillDirs, [
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
    mock.method(performance, "now", () => 42_000);
    assert.equal(getState().app.apiStartTime, null);
    actions.setApiStartTime();
    assert.strictEqual(getState().app.apiStartTime, 42_000);
  });

  it("set-api-end-time", () => {
    mock.method(performance, "now", () => 99_000);
    assert.equal(getState().app.apiEndTime, null);
    actions.setApiEndTime();
    assert.strictEqual(getState().app.apiEndTime, 99_000);
  });

  it("set-session-start-date", () => {
    mock.method(Date, "now", () => 42_000);
    assert.equal(getState().app.sessionStartDate, 0);
    actions.setSessionStartDate();
    assert.strictEqual(getState().app.sessionStartDate, 42_000);
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

  it("set-loading-state-frame-duration", () => {
    assert.equal(getState().config.loadingStateFrameDuration, 80);
    actions.setLoadingStateFrameDuration(120);
    assert.strictEqual(getState().config.loadingStateFrameDuration, 120);
  });

  it("set-prompt-prefix", () => {
    assert.strictEqual(getState().config.promptPrefix, "> ");
    actions.setPromptPrefix("🤖 ");
    assert.strictEqual(getState().config.promptPrefix, "🤖 ");
  });

  it("set-usage-limit", () => {
    assert.strictEqual(getState().config.usageLimit, undefined);
    actions.setUsageLimit({ duration: "60m", dollarAmount: 5 });
    assert.deepStrictEqual(getState().config.usageLimit, {
      duration: "60m",
      dollarAmount: 5,
    });
    actions.setUsageLimit(undefined);
    assert.strictEqual(getState().config.usageLimit, undefined);
  });

  it("set-model-usage-for-limit-window", () => {
    assert.deepStrictEqual(getState().app.modelUsageForLimitWindow, {});

    actions.setModelUsageForLimitWindow({
      "gpt-4": [
        {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 2,
          cacheWriteTokens: 1,
          date: 1_000,
        },
      ],
    });

    assert.deepStrictEqual(getState().app.modelUsageForLimitWindow, {
      "gpt-4": [
        {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 2,
          cacheWriteTokens: 1,
          date: 1_000,
        },
      ],
    });
  });

  it("set-model-usage-for-session", () => {
    assert.deepStrictEqual(getState().app.modelUsageForSession, {});

    actions.setModelUsageForSession({
      "gpt-4": [
        {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 2,
          cacheWriteTokens: 1,
          date: 1_000,
        },
      ],
    });

    assert.deepStrictEqual(getState().app.modelUsageForSession, {
      "gpt-4": [
        {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 2,
          cacheWriteTokens: 1,
          date: 1_000,
        },
      ],
    });
  });

  it("append-to-model-usage-for-session", () => {
    actions.setModel("gpt-4");
    const first = {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 2,
      cacheWriteTokens: 1,
      date: 1_000,
    };
    actions.appendToModelUsageForSession(first);

    actions.setModel("claude");
    const second = {
      inputTokens: 3,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      date: 2_000,
    };
    actions.appendToModelUsageForSession(second);

    assert.deepStrictEqual(getState().app.modelUsageForSession, {
      "gpt-4": [first],
      claude: [second],
    });
  });

  it("reset-loading-state-frame-idx", () => {
    actions.incrementLoadingStateFrameIdx();
    actions.incrementLoadingStateFrameIdx();
    assert.strictEqual(getState().app.loadingStateFrameIdx, 2);
    actions.resetLoadingStateFrameIdx();
    assert.strictEqual(getState().app.loadingStateFrameIdx, 0);
  });

  it("set-loading-state-timeout", () => {
    assert.equal(getState().app.loadingStateTimeout, null);
    const timeout = setTimeout(() => undefined, 1_000);
    actions.setLoadingStateTimeout(timeout);
    assert.equal(getState().app.loadingStateTimeout, timeout);
    clearTimeout(timeout);
    actions.setLoadingStateTimeout(null);
    assert.equal(getState().app.loadingStateTimeout, null);
  });
});
