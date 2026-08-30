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
  flushAndStopLoadingState,
  printSessionStartDate,
} from "./print.ts";
import { actions, getState } from "./state.ts";
import { processDeps } from "./deps.ts";
import childProcess from "node:child_process";
import {
  stripAnsi,
  mockExec,
  mockSetInterval,
  mockClearInterval,
  setupFakeDeps,
} from "./test-helpers.ts";

describe("print", () => {
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

    it("returns original content when formatting fails", async () => {
      const invalid = null as unknown as string;
      const result = await formatMarkdown(invalid);
      assert.equal(result, invalid);
    });
  });

  describe("startLoadingState", () => {
    it("writes loadingStateFrames cyclically", async () => {
      actions.resetState();
      const callbacks = mockSetInterval();
      mockClearInterval(callbacks);
      actions.setLoadingStateFrames(["a", "b", "c"]);
      let captured = "";
      mock.method(processDeps.stdout, "write", (out: string) => {
        captured += out;
      });

      startLoadingState();
      callbacks.forEach((cb) => cb());
      callbacks.forEach((cb) => cb());
      callbacks.forEach((cb) => cb());
      callbacks.forEach((cb) => cb());
      const stopPromise = stopLoadingState();
      callbacks.forEach((cb) => cb());
      callbacks.forEach((cb) => cb());
      await stopPromise;

      assert.strictEqual(captured, "\ra\rb\rc\ra\rb\rc\ra\r \r");
    });

    it("uses default loadingStateFrames when none set", async () => {
      actions.resetState();
      const callbacks = mockSetInterval();
      mockClearInterval(callbacks);
      let captured = "";
      mock.method(processDeps.stdout, "write", (out: string) => {
        captured += out;
      });

      startLoadingState();
      callbacks.forEach((cb) => cb());
      callbacks.forEach((cb) => cb());
      const stopPromise = stopLoadingState();
      callbacks.forEach((cb) => cb());
      callbacks.forEach((cb) => cb());
      await stopPromise;

      assert.strictEqual(captured, "\r|\r/\r-\r\\\r|\r \r");
    });

    it("stopLoadingState gracefully handles multiple calls", async () => {
      actions.resetState();
      const callbacks = mockSetInterval();
      mockClearInterval(callbacks);
      mock.method(processDeps.stdout, "write", () => undefined);
      actions.setLoadingStateFrames(["a", "b", "c"]);

      startLoadingState();
      callbacks.forEach((cb) => cb());

      const stop1 = stopLoadingState();
      const stop2 = stopLoadingState();
      assert.strictEqual(stop1, stop2);

      callbacks.forEach((cb) => cb());
      callbacks.forEach((cb) => cb());
      await stop1;
      await stop2;
    });

    it("serializes concurrent colorPrint calls", async () => {
      actions.resetState();
      const callbacks = mockSetInterval();
      mockClearInterval(callbacks);
      mock.method(processDeps.stdout, "write", () => undefined);
      actions.setLoadingStateFrames(["a", "b", "c"]);

      startLoadingState();
      callbacks.forEach((cb) => cb());

      const p1 = colorPrint("X");
      const p2 = colorPrint("Y");
      const p3 = colorPrint("Z");

      await new Promise((r) => setTimeout(r, 0));

      callbacks.forEach((cb) => cb());
      callbacks.forEach((cb) => cb());

      await Promise.all([p1, p2, p3]);

      assert.strictEqual(getState().app.stdout, "X\nY\nZ\n");
    });

    it("flushAndStopLoadingState drains queue then stops spinner", async () => {
      actions.resetState();
      const callbacks = mockSetInterval();
      mockClearInterval(callbacks);
      mock.method(processDeps.stdout, "write", () => undefined);
      actions.setLoadingStateFrames(["a", "b", "c"]);

      startLoadingState();
      callbacks.forEach((cb) => cb());

      const printPromise = colorPrint("X");
      const flushPromise = flushAndStopLoadingState();

      await new Promise((r) => setTimeout(r, 0));

      callbacks.forEach((cb) => cb());
      callbacks.forEach((cb) => cb());

      await Promise.all([printPromise, flushPromise]);

      assert.strictEqual(getState().app.loadingStateTimeout, null);
      assert.strictEqual(getState().app.loadingStateFrameIdx, 0);
      assert.strictEqual(getState().app.stdout, "X\n");
    });
  });

  describe("fencePrint", () => {
    beforeEach(() => {
      setupFakeDeps();
      actions.resetState();
      actions.resetStdout();
    });

    it("prints the text in a fence without session info", async () => {
      await fencePrint("Output");
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        "\u2501\u2501 Output \u2501\u2501\n",
      );
    });

    it("prints duration and token usage when showSessionInfo is set", async () => {
      mock.method(performance, "now", () => 1_000);
      actions.setApiStartTime();
      mock.method(performance, "now", () => 1_500);
      actions.setApiEndTime();

      await fencePrint("Output", { showSessionInfo: true });

      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        "\u2501\u2501 Output (500ms) (0 tokens in session) \u2501\u2501\n",
      );
    });

    it("includes context window usage when configured", async () => {
      mock.method(performance, "now", () => 1_000);
      actions.setApiStartTime();
      mock.method(performance, "now", () => 1_500);
      actions.setApiEndTime();
      actions.setModel("test-model");
      actions.setContextWindowPerModel({ "test-model": 10_000 });
      actions.appendToMessageParams({ role: "user", content: "hi" }, 5_000);

      await fencePrint("Output", { showSessionInfo: true });

      assert.strictEqual(
        stripAnsi(getState().app.stdout),
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
      let captured = "";
      mock.method(processDeps.stdout, "write", (out: string) => {
        captured += out;
      });

      await executeBat("# Hello\n");

      assert.strictEqual(stripAnsi(captured), "# Hello\n\n");
    });

    it("falls back to plain text when bat is not available", async () => {
      mockExec({ stdout: "", error: new Error("not found") });

      let captured = "";
      mock.method(processDeps.stdout, "write", (out: string) => {
        captured += out;
      });

      await executeBat("test content\n");

      assert.strictEqual(
        stripAnsi(captured),
        `\`bat\` is not available, falling back to plain text rendering\ntest content\n\n`,
      );
    });

    it("falls back to plain text when bat spawn fails", async () => {
      mock.method(childProcess, "spawnSync", () => {
        throw new Error("spawn failed");
      });

      let captured = "";
      mock.method(processDeps.stdout, "write", (out: string) => {
        captured += out;
      });

      await executeBat("test content\n");

      assert.strictEqual(stripAnsi(captured), "test content\n\n");
    });

    it("falls back to plain text when bat exits with non-zero status", async () => {
      mockExec({ stdout: "bat 0.25.0" });
      mock.method(childProcess, "spawnSync", () => {
        return {
          status: 1,
          stdout: "bat-rendered\n",
          stderr: "bat error",
        } as unknown as ReturnType<typeof childProcess.spawnSync>;
      });

      let captured = "";
      mock.method(processDeps.stdout, "write", (out: string) => {
        captured += out;
      });

      await executeBat("test content\n");

      assert.strictEqual(stripAnsi(captured), "test content\n\n");
    });

    it("prints bat stdout when stderr is empty", async () => {
      mockExec({ stdout: "bat 0.25.0" });
      mock.method(childProcess, "spawnSync", () => {
        return {
          status: 0,
          stdout: "bat-rendered\n",
          stderr: "",
        } as unknown as ReturnType<typeof childProcess.spawnSync>;
      });

      let captured = "";
      mock.method(processDeps.stdout, "write", (out: string) => {
        captured += out;
      });

      await executeBat("test content\n");

      assert.strictEqual(stripAnsi(captured), "bat-rendered\n\n");
    });

    it("falls back to plain text when bat writes stderr", async () => {
      mockExec({ stdout: "bat 0.25.0" });
      mock.method(childProcess, "spawnSync", () => {
        return {
          status: 0,
          stdout: "bat-rendered\n",
          stderr: "bat warning",
        } as unknown as ReturnType<typeof childProcess.spawnSync>;
      });

      let captured = "";
      mock.method(processDeps.stdout, "write", (out: string) => {
        captured += out;
      });

      await executeBat("test content\n");

      assert.strictEqual(stripAnsi(captured), "test content\n\n");
    });
  });

  describe("printSessionStartDate", () => {
    beforeEach(() => {
      setupFakeDeps();
      actions.resetState();
      actions.resetStdout();
    });

    it("prints the session start date", async () => {
      mock.method(Date, "now", () => 42_000);
      actions.setSessionStartDate();
      await printSessionStartDate();
      assert.strictEqual(
        stripAnsi(getState().app.stdout),
        "Session start date: 42000\n",
      );
    });
  });
});
