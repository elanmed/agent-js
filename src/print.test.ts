import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert";
import {
  formatMarkdown,
  getPrettyApiDuration,
  executeBat,
  startLoadingState,
  stopLoadingState,
  colorPrint,
  fencePrint,
  printSessionStartDate,
  warnOnMissingBat,
} from "./print.ts";
import { actions } from "./state.ts";
import {
  stripAnsi,
  getCapturedAppStdout,
  mockExec,
  mockSpawnSync,
  mockStdout,
  mockSetInterval,
  mockClearInterval,
  setupFakeDeps,
} from "./test-helpers.ts";

describe("print", () => {
  beforeEach(() => {
    setupFakeDeps();
  });

  describe("formatMarkdown", () => {
    it("formats markdown tables with aligned columns", async () => {
      const unaligned = `|a|b|
|-|-|
|x|y|`;
      const result = await formatMarkdown(unaligned);
      assert.strictEqual(
        result,
        `| a   | b   |
| --- | --- |
| x   | y   |
`,
      );
    });

    it("returns original content and warns when formatting fails", async () => {
      actions.resetStdout();
      const invalid = null as unknown as string;
      const result = await formatMarkdown(invalid);
      assert.equal(result, invalid);
      assert.strictEqual(
        stripAnsi(getCapturedAppStdout()),
        "Outputting raw content, markdown formatting failed: Cannot read properties of null (reading 'length')\n",
      );
    });
  });

  describe("startLoadingState", () => {
    it("writes loadingStateFrames cyclically", () => {
      actions.resetState();
      const callbacks = mockSetInterval();
      mockClearInterval(callbacks);
      actions.setLoadingStateFrames(["a", "b", "c"]);

      const getCaptured = mockStdout();

      startLoadingState();
      callbacks.forEach((cb) => cb());
      callbacks.forEach((cb) => cb());
      callbacks.forEach((cb) => cb());
      callbacks.forEach((cb) => cb());
      stopLoadingState();

      assert.strictEqual(getCaptured(), "\ra\rb\rc\ra\rb\r \r");
    });

    it("uses default loadingStateFrames when none set", () => {
      actions.resetState();
      const callbacks = mockSetInterval();
      mockClearInterval(callbacks);

      const getCaptured = mockStdout();

      startLoadingState();
      callbacks.forEach((cb) => cb());
      callbacks.forEach((cb) => cb());
      stopLoadingState();

      assert.strictEqual(getCaptured(), "\r|\r/\r-\r \r");
    });

    it("stopLoadingState gracefully handles multiple calls", () => {
      actions.resetState();
      const callbacks = mockSetInterval();
      mockClearInterval(callbacks);
      mockStdout();
      actions.setLoadingStateFrames(["a", "b", "c"]);

      startLoadingState();
      callbacks.forEach((cb) => cb());

      const stop1 = stopLoadingState();
      const stop2 = stopLoadingState();
      assert.strictEqual(stop1, stop2);
    });

    it("serializes concurrent colorPrint calls", async () => {
      actions.resetState();
      const callbacks = mockSetInterval();
      mockClearInterval(callbacks);
      mockStdout();
      actions.setLoadingStateFrames(["a", "b", "c"]);

      startLoadingState();
      callbacks.forEach((cb) => cb());

      colorPrint("X");
      colorPrint("Y");
      colorPrint("Z");

      await Promise.resolve();

      assert.strictEqual(getCapturedAppStdout(), "X\nY\nZ\n");
    });
  });

  describe("fencePrint", () => {
    beforeEach(() => {
      setupFakeDeps();
      actions.resetState();
      actions.resetStdout();
    });

    it("prints the text in a fence without session info", () => {
      fencePrint("Output");
      assert.strictEqual(
        stripAnsi(getCapturedAppStdout()),
        "\u2501\u2501 Output \u2501\u2501\n",
      );
    });

    it("prints duration and token usage when showSessionInfo is set", () => {
      mock.method(performance, "now", () => 1_000);
      actions.setApiStartTime();
      mock.method(performance, "now", () => 1_500);
      actions.setApiEndTime();

      fencePrint("Output", { showSessionInfo: true });

      assert.strictEqual(
        stripAnsi(getCapturedAppStdout()),
        "\u2501\u2501 Output (500ms) (0 tokens in session) \u2501\u2501\n",
      );
    });

    it("includes context window usage when configured", () => {
      mock.method(performance, "now", () => 1_000);
      actions.setApiStartTime();
      mock.method(performance, "now", () => 1_500);
      actions.setApiEndTime();
      actions.setModel("test-model");
      actions.setContextWindowPerModel({ "test-model": 10_000 });
      actions.appendToMessageParams({ role: "user", content: "hi" });
      actions.setMessageParamTokens(5_000);

      fencePrint("Output", { showSessionInfo: true });

      assert.strictEqual(
        stripAnsi(getCapturedAppStdout()),
        "\u2501\u2501 Output (500ms) (0 tokens in session, 50% of context window) \u2501\u2501\n",
      );
    });
  });

  describe("getPrettyApiDuration", () => {
    beforeEach(() => {
      actions.resetState();
    });

    it("formats sub-second duration as milliseconds", () => {
      mock.method(performance, "now", () => 1_000);
      actions.setApiStartTime();
      mock.method(performance, "now", () => 1_500);
      actions.setApiEndTime();
      const result = getPrettyApiDuration();
      assert.strictEqual(result, "500ms");
    });

    it("formats seconds and milliseconds", () => {
      mock.method(performance, "now", () => 1_000);
      actions.setApiStartTime();
      mock.method(performance, "now", () => 6_500);
      actions.setApiEndTime();
      const result = getPrettyApiDuration();
      assert.strictEqual(result, "5s 500ms");
    });

    it("formats minutes, zero seconds, and milliseconds", () => {
      mock.method(performance, "now", () => 1_000);
      actions.setApiStartTime();
      mock.method(performance, "now", () => 121_500);
      actions.setApiEndTime();
      const result = getPrettyApiDuration();
      assert.strictEqual(result, "2m 0s 500ms");
    });

    it("formats minutes, seconds, and milliseconds", () => {
      mock.method(performance, "now", () => 1_000);
      actions.setApiStartTime();
      mock.method(performance, "now", () => 126_500);
      actions.setApiEndTime();
      const result = getPrettyApiDuration();
      assert.strictEqual(result, "2m 5s 500ms");
    });

    it("clamps negative durations from clock skew to zero", () => {
      mock.method(performance, "now", () => 1_000);
      actions.setApiStartTime();
      mock.method(performance, "now", () => 500);
      actions.setApiEndTime();
      const result = getPrettyApiDuration();
      assert.strictEqual(result, "0ms");
    });
  });

  describe("executeBat", () => {
    beforeEach(() => {
      mock.restoreAll();
      actions.resetState();
      actions.setModel("test-model");
    });

    it("formats markdown and outputs the content through bat when available", async () => {
      mockExec({ stdout: "bat 0.26.1\n" });
      mockSpawnSync({ echoInput: true });

      const getCaptured = mockStdout();

      await executeBat("# Hello\n");

      assert.strictEqual(stripAnsi(getCaptured()), "# Hello\n\n");
    });

    it("falls back to plain text when bat is not available", async () => {
      mockExec({ stdout: "", error: new Error("not found") });

      const getCaptured = mockStdout();

      await executeBat("test content\n");

      assert.strictEqual(stripAnsi(getCaptured()), "test content\n\n");
    });

    it("falls back to plain text when bat spawn fails", async () => {
      mockSpawnSync({ error: new Error("spawn failed") });

      const getCaptured = mockStdout();

      await executeBat("test content\n");

      assert.strictEqual(
        stripAnsi(getCaptured()),
        `Falling back to plain text rendering, an error occurred when spawning \`bat\`: spawn failed
test content

`,
      );
    });

    it("falls back to plain text when bat exits with non-zero status", async () => {
      mockExec({ stdout: "bat 0.25.0" });
      mockSpawnSync({
        result: { status: 1, stdout: "bat-rendered\n", stderr: "bat error" },
      });

      const getCaptured = mockStdout();

      await executeBat("test content\n");

      assert.strictEqual(
        stripAnsi(getCaptured()),
        `Falling back to plain text rendering, an error occurred when spawning \`bat\`: \`bat\` returned code 1
test content

`,
      );
    });

    it("prints bat stdout when status is null", async () => {
      mockExec({ stdout: "bat 0.25.0" });
      mockSpawnSync({
        result: { status: null, stdout: "bat-rendered\n", stderr: "" },
      });

      const getCaptured = mockStdout();

      await executeBat("test content\n");

      assert.strictEqual(stripAnsi(getCaptured()), "bat-rendered\n\n");
    });

    it("prints bat stdout when stderr is empty", async () => {
      mockExec({ stdout: "bat 0.25.0" });
      mockSpawnSync({
        result: { status: 0, stdout: "bat-rendered\n", stderr: "" },
      });

      const getCaptured = mockStdout();

      await executeBat("test content\n");

      assert.strictEqual(stripAnsi(getCaptured()), "bat-rendered\n\n");
    });

    it("falls back to plain text when bat writes stderr", async () => {
      mockExec({ stdout: "bat 0.25.0" });
      mockSpawnSync({
        result: { status: 0, stdout: "bat-rendered\n", stderr: "bat warning" },
      });

      const getCaptured = mockStdout();

      await executeBat("test content\n");

      assert.strictEqual(
        stripAnsi(getCaptured()),
        `Falling back to plain text rendering, an error occurred when spawning \`bat\`: bat warning
test content

`,
      );
    });
  });

  describe("warnOnMissingBat", () => {
    beforeEach(() => {
      mock.restoreAll();
      actions.resetState();
    });

    it("warns when bat is not available", async () => {
      mockExec({ stdout: "", error: new Error("not found") });

      const getCaptured = mockStdout();

      await warnOnMissingBat();

      assert.match(
        stripAnsi(getCaptured()),
        /`bat` is not available, consider installing it to properly render markdown responses in the terminal\. Suppress this warning with `suppressBatUnavailableWarning: true` in /,
      );
    });

    it("does not warn when bat is available", async () => {
      mockExec({ stdout: "bat 0.25.0" });

      const getCaptured = mockStdout();

      await warnOnMissingBat();

      assert.strictEqual(getCaptured(), "");
    });

    it("does not warn when suppressBatUnavailableWarning is set", async () => {
      mockExec({ stdout: "", error: new Error("not found") });
      actions.setSuppressBatUnavailableWarning(true);

      const getCaptured = mockStdout();

      await warnOnMissingBat();

      assert.strictEqual(getCaptured(), "");
    });
  });

  describe("printSessionStartDate", () => {
    beforeEach(() => {
      setupFakeDeps();
      actions.resetState();
      actions.resetStdout();
    });

    it("prints the session start date", () => {
      mock.method(Date, "now", () => 42_000);
      actions.setSessionStartDate();
      printSessionStartDate();
      assert.strictEqual(
        stripAnsi(getCapturedAppStdout()),
        "Resume this session with /resume 42000\n",
      );
    });
  });
});
