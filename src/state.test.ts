import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { MISSING } from "./utils.ts";
import type { TokenUsage } from "./print.ts";
import { dispatch, actions, selectors } from "./state.ts";
import { DEFAULT_CONFIG } from "./config.ts";

describe("state", () => {
  beforeEach(() => {
    dispatch(actions.resetState());
  });

  it("resetState restores initial state after mutations", () => {
    dispatch(actions.setRunning(false));
    dispatch(actions.setInterrupted(true));
    dispatch(actions.appendToMessageParams({ role: "user", content: "hi" }));
    dispatch(actions.setQuestionAbortController(new AbortController()));
    dispatch(actions.setApiStreamAbortController(new AbortController()));
    dispatch(actions.setToolCallAbortController(new AbortController()));
    const timeout = setTimeout(() => undefined, 1000);
    dispatch(actions.setSpinnerTimeout(timeout));
    dispatch(actions.setEditorLogPath("/tmp/test.log"));
    dispatch(actions.resetState());
    clearTimeout(timeout);

    assert.equal(selectors.getRunning(), true);
    assert.equal(selectors.getInterrupted(), false);
    assert.deepStrictEqual(selectors.getMessageParams(), []);
    assert.deepStrictEqual(selectors.getMessageUsages(), []);
    assert.equal(selectors.getQuestionAbortController(), null);
    assert.equal(selectors.getApiStreamAbortController(), null);
    assert.equal(selectors.getToolCallAbortController(), null);
    assert.equal(selectors.getSpinnerTimeout(), null);
    assert.equal(selectors.getEditorLogPath(), "");
  });

  it("initial state", () => {
    assert.equal(selectors.getRunning(), true);
    assert.equal(selectors.getInterrupted(), false);
    assert.deepStrictEqual(selectors.getMessageParams(), []);
    assert.deepStrictEqual(selectors.getMessageUsages(), []);
    assert.equal(selectors.getQuestionAbortController(), null);
    assert.equal(selectors.getApiStreamAbortController(), null);
    assert.equal(selectors.getToolCallAbortController(), null);
    assert.equal(selectors.getEditorLogPath(), "");
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
      assert.deepStrictEqual(selectors.getMessageParams(), []);
      dispatch(actions.appendToMessageParams({ role: "user", content: "hi" }));
      assert.equal(selectors.getMessageParams().length, 1);
      assert.deepStrictEqual(selectors.getMessageParams()[0], {
        role: "user",
        content: "hi",
      });
    });

    it("appends multiple messages in order", () => {
      assert.deepStrictEqual(selectors.getMessageParams(), []);
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
    assert.deepStrictEqual(selectors.getMessageUsages(), []);
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

    assert.deepStrictEqual(selectors.getMessageUsages(), [usage1, usage2]);
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
    assert.deepStrictEqual(selectors.getPricingPerModel(), newPricing);
  });

  it("set-diff-style", () => {
    assert.equal(selectors.getDiffStyle(), "lines");
    dispatch(actions.setDiffStyle("unified"));
    assert.equal(selectors.getDiffStyle(), "unified");
  });

  it("set-keymap-edit", () => {
    assert.deepStrictEqual(
      selectors.getKeymapEdit(),
      DEFAULT_CONFIG.keymaps.edit,
    );
    dispatch(
      actions.setKeymapEdit({
        name: "v",
        ctrl: false,
        meta: false,
        shift: false,
      }),
    );
    assert.deepStrictEqual(selectors.getKeymapEdit(), {
      name: "v",
      ctrl: false,
      meta: false,
      shift: false,
    });
  });

  it("set-keymap-edit-log", () => {
    assert.deepStrictEqual(
      selectors.getKeymapEditLog(),
      DEFAULT_CONFIG.keymaps.editLog,
    );
    dispatch(
      actions.setKeymapEditLog({
        name: "o",
        ctrl: false,
        meta: false,
        shift: false,
      }),
    );
    assert.deepStrictEqual(selectors.getKeymapEditLog(), {
      name: "o",
      ctrl: false,
      meta: false,
      shift: false,
    });
  });

  it("set-keymap-clear", () => {
    assert.deepStrictEqual(
      selectors.getKeymapClear(),
      DEFAULT_CONFIG.keymaps.clear,
    );
    dispatch(
      actions.setKeymapClear({
        name: "k",
        ctrl: false,
        meta: false,
        shift: false,
      }),
    );
    assert.deepStrictEqual(selectors.getKeymapClear(), {
      name: "k",
      ctrl: false,
      meta: false,
      shift: false,
    });
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

  it("set-tool-call-abort-controller", () => {
    assert.equal(selectors.getToolCallAbortController(), null);
    const controller = new AbortController();
    dispatch(actions.setToolCallAbortController(controller));
    assert.equal(selectors.getToolCallAbortController(), controller);
  });

  it("set-editor-input-value", () => {
    assert.equal(selectors.getEditorInputValue(), null);
    dispatch(actions.setEditorInputValue("test content"));
    assert.equal(selectors.getEditorInputValue(), "test content");
  });

  it("set-debug-log", () => {
    assert.equal(selectors.getDebugLog(), false);
    dispatch(actions.setDebugLog(true));
    assert.equal(selectors.getDebugLog(), true);
  });

  it("set-editor-log", () => {
    assert.equal(selectors.getEditorLog(), false);
    dispatch(actions.setEditorLog(true));
    assert.equal(selectors.getEditorLog(), true);
  });

  it("set-editor-log-path", () => {
    assert.equal(selectors.getEditorLogPath(), "");
    dispatch(actions.setEditorLogPath("/tmp/editor.log"));
    assert.equal(selectors.getEditorLogPath(), "/tmp/editor.log");
  });

  it("set-context-str", () => {
    assert.equal(selectors.getContextStr(), "");
    dispatch(actions.setContextStr("FILEPATH: context\nhello"));
    assert.equal(
      selectors.getContextStr(),
      `FILEPATH: context
hello`,
    );
  });

  it("set-skills-str", () => {
    assert.equal(selectors.getSkillsStr(), "");
    dispatch(actions.setSkillsStr("- skill: desc"));
    assert.equal(selectors.getSkillsStr(), "- skill: desc");
  });

  describe("set-context-entries", () => {
    it("sets the context entries array", () => {
      assert.deepStrictEqual(selectors.getContextEntries(), []);
      dispatch(
        actions.setContextEntries([
          { filePath: "/test/AGENTS.md", content: "# Instructions" },
        ]),
      );
      assert.deepStrictEqual(selectors.getContextEntries(), [
        { filePath: "/test/AGENTS.md", content: "# Instructions" },
      ]);
    });

    it("replaces existing context entries", () => {
      dispatch(
        actions.setContextEntries([{ filePath: "/a/AGENTS.md", content: "A" }]),
      );
      dispatch(
        actions.setContextEntries([{ filePath: "/b/AGENTS.md", content: "B" }]),
      );
      assert.equal(selectors.getContextEntries().length, 1);
      assert.equal(selectors.getContextEntries()[0]!.filePath, "/b/AGENTS.md");
    });
  });

  describe("set-skills", () => {
    it("sets the skills array", () => {
      assert.deepStrictEqual(selectors.getSkills(), []);
      dispatch(
        actions.setSkills([
          {
            name: "deploy",
            description: "Deploy skill",
            dir: "/skills/deploy",
            content: "# Deploy instructions",
          },
        ]),
      );
      assert.deepStrictEqual(selectors.getSkills(), [
        {
          name: "deploy",
          description: "Deploy skill",
          dir: "/skills/deploy",
          content: "# Deploy instructions",
        },
      ]);
    });

    it("replaces existing skills", () => {
      dispatch(
        actions.setSkills([
          {
            name: "a",
            description: "Skill A",
            dir: "/a",
            content: "content a",
          },
        ]),
      );
      dispatch(
        actions.setSkills([
          {
            name: "b",
            description: "Skill B",
            dir: "/b",
            content: "content b",
          },
        ]),
      );
      assert.equal(selectors.getSkills().length, 1);
      assert.equal(selectors.getSkills()[0]!.name, "b");
    });
  });

  it("set-slash-commands", () => {
    assert.deepStrictEqual(selectors.getSlashCommands(), []);
    dispatch(
      actions.setSlashCommands([
        { name: "test", filePath: "/test.md", content: "test content" },
        { name: "deploy", filePath: "/deploy.md", content: "deploy content" },
      ]),
    );
    assert.deepStrictEqual(selectors.getSlashCommands(), [
      { name: "test", filePath: "/test.md", content: "test content" },
      { name: "deploy", filePath: "/deploy.md", content: "deploy content" },
    ]);
  });

  it("set-custom-slash-command-dirs", () => {
    assert.deepStrictEqual(selectors.getCustomSlashCommandDirs(), []);
    dispatch(actions.setCustomSlashCommandDirs(["/my-commands", "/more"]));
    assert.deepStrictEqual(selectors.getCustomSlashCommandDirs(), [
      "/my-commands",
      "/more",
    ]);
  });

  it("set-custom-skill-dirs", () => {
    assert.deepStrictEqual(selectors.getCustomSkillDirs(), []);
    dispatch(actions.setCustomSkillDirs(["/my-skills", "/more"]));
    assert.deepStrictEqual(selectors.getCustomSkillDirs(), [
      "/my-skills",
      "/more",
    ]);
  });

  it("reset-stdout", () => {
    dispatch(actions.appendToStdout("line1\n"));
    dispatch(actions.appendToStdout("line2\n"));
    assert.equal(
      selectors.getStdout(),
      `line1
line2
`,
    );
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
      assert.equal(
        selectors.getStdout(),
        `line1
line2
line3
`,
      );
    });
  });

  it("set-rl", () => {
    assert.equal(selectors.getRl(), null);
    const fakeRl = {
      close: () => undefined,
      question: () => Promise.resolve(""),
    } as unknown as NonNullable<ReturnType<typeof selectors.getRl>>;
    dispatch(actions.setRl(fakeRl));
    assert.equal(selectors.getRl(), fakeRl);
  });

  it("set-spinner-timeout", () => {
    assert.equal(selectors.getSpinnerTimeout(), null);
    const timeout = setTimeout(() => undefined, 1000);
    dispatch(actions.setSpinnerTimeout(timeout));
    assert.equal(selectors.getSpinnerTimeout(), timeout);
    clearTimeout(timeout);
    dispatch(actions.setSpinnerTimeout(null));
    assert.equal(selectors.getSpinnerTimeout(), null);
  });
});
