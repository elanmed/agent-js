import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  debugLog,
  editorLog,
  resetDebugLog,
  initEditorLog,
  deleteExpiredEditorLogs,
  type DebugLogDeps,
  type EditorLogDeps,
  type InitEditorLogDeps,
  type DeleteExpiredEditorLogsDeps,
  type ResetDebugLogDeps,
  EDITOR_LOGS_PATH,
} from "./log.ts";
import { dispatch, actions, selectors } from "./state.ts";
import { makeFsDeps } from "./fs-deps.ts";

describe("log", () => {
  beforeEach(() => {
    dispatch(actions.resetState());
  });

  describe("debugLog", () => {
    let fs: ReturnType<typeof makeFsDeps>;

    beforeEach(() => {
      fs = makeFsDeps();
    });

    function makeDeps(overrides: Partial<DebugLogDeps> = {}): DebugLogDeps {
      return {
        fs,
        getDebugLogPath: () => "/test/debug.log",
        now: () => 1700000000000,
        ...overrides,
      };
    }

    it("does nothing when debugLog is disabled", () => {
      dispatch(actions.setDebugLog(false));
      const deps = makeDeps();
      debugLog("test message", deps);
      assert.equal(fs._files.has("/test/debug.log"), false);
    });

    it("creates directory when log file does not exist", () => {
      dispatch(actions.setDebugLog(true));
      const deps = makeDeps();
      debugLog("test message", deps);
      assert.equal(fs._dirs.has("/test"), true);
    });

    it("appends content to log file with timestamp", () => {
      dispatch(actions.setDebugLog(true));
      const deps = makeDeps();
      debugLog("test message", deps);
      assert.equal(
        fs._files.get("/test/debug.log"),
        "2023-11-14T22:13:20.000Z :: test message\n",
      );
    });

    it("appends multiple messages", () => {
      dispatch(actions.setDebugLog(true));
      const deps = makeDeps();
      debugLog("message 1", deps);
      debugLog("message 2", deps);
      assert.equal(
        fs._files.get("/test/debug.log"),
        "2023-11-14T22:13:20.000Z :: message 1\n2023-11-14T22:13:20.000Z :: message 2\n",
      );
    });
  });

  describe("editorLog", () => {
    let fs: ReturnType<typeof makeFsDeps>;

    beforeEach(() => {
      fs = makeFsDeps();
    });

    function makeDeps(overrides: Partial<EditorLogDeps> = {}): EditorLogDeps {
      return {
        fs,
        getEditorLogPath: () => "/test/editor.log",
        getEditorLog: () => true,
        now: () => 1700000000000,
        ...overrides,
      };
    }

    it("does nothing when editorLog is disabled", () => {
      const deps = makeDeps({ getEditorLog: () => false });
      editorLog("test message", deps);
      assert.equal(fs._files.has("/test/editor.log"), false);
    });

    it("creates directory when log file does not exist", () => {
      const deps = makeDeps();
      editorLog("test message", deps);
      assert.equal(fs._dirs.has("/test"), true);
    });

    it("appends content with timestamp and separator", () => {
      const deps = makeDeps();
      editorLog("test content", deps);
      assert.equal(
        fs._files.get("/test/editor.log"),
        `2023-11-14T22:13:20.000Z
      -------------------------
      test content

      `,
      );
    });

    it("appends multiple messages with separators", () => {
      const deps = makeDeps();
      editorLog("content 1", deps);
      editorLog("content 2", deps);
      assert.equal(
        fs._files.get("/test/editor.log"),
        `2023-11-14T22:13:20.000Z
      -------------------------
      content 1

      2023-11-14T22:13:20.000Z
      -------------------------
      content 2

      `,
      );
    });
  });

  describe("resetDebugLog", () => {
    let fs: ReturnType<typeof makeFsDeps>;

    beforeEach(() => {
      fs = makeFsDeps();
    });

    function makeDeps(
      overrides: Partial<ResetDebugLogDeps> = {},
    ): ResetDebugLogDeps {
      return {
        fs,
        getDebugLogPath: () => "/test/debug.log",
        ...overrides,
      };
    }

    it("does nothing when log file does not exist", () => {
      const deps = makeDeps();
      resetDebugLog(deps);
      assert.equal(fs._files.has("/test/debug.log"), false);
    });

    it("clears the log file when it exists", () => {
      const deps = makeDeps();
      fs._dirs.add("/test");
      fs._files.set("/test/debug.log", "existing content");
      resetDebugLog(deps);
      assert.equal(fs._files.get("/test/debug.log"), "");
    });
  });

  describe("initEditorLog", () => {
    let fs: ReturnType<typeof makeFsDeps>;

    beforeEach(() => {
      fs = makeFsDeps();
    });

    function makeDeps(
      overrides: Partial<InitEditorLogDeps> = {},
    ): InitEditorLogDeps {
      return {
        fs,
        randomUUID: () => "test-uuid",
        now: () => 1234567890000,
        ...overrides,
      };
    }

    it("creates directory and sets path when directory does not exist", () => {
      dispatch(actions.setEditorLog(true));
      const deps = makeDeps();
      initEditorLog(deps);
      assert.equal(fs._dirs.has(EDITOR_LOGS_PATH), true);
      assert.equal(selectors.getEditorLog(), true);
      assert.ok(
        selectors
          .getEditorLogPath()
          .endsWith("editor-test-uuid-1234567890000.log"),
      );
    });

    it("disables editor log when mkdir fails", () => {
      dispatch(actions.setEditorLog(true));
      const deps = makeDeps({
        fs: {
          ...fs,
          existsSync: () => false,
          mkdirSync: () => {
            throw new Error("Permission denied");
          },
        },
      });
      initEditorLog(deps);
      assert.equal(selectors.getEditorLog(), false);
    });

    it("generates correct log path with uuid and timestamp", () => {
      dispatch(actions.setEditorLog(true));
      const deps = makeDeps();
      initEditorLog(deps);
      const path = selectors.getEditorLogPath();
      assert.ok(path.endsWith("editor-test-uuid-1234567890000.log"));
    });
  });

  describe("deleteExpiredEditorLogs", () => {
    let fs: ReturnType<typeof makeFsDeps>;

    beforeEach(() => {
      fs = makeFsDeps();
    });

    function makeDeps(
      overrides: Partial<DeleteExpiredEditorLogsDeps> = {},
    ): DeleteExpiredEditorLogsDeps {
      return {
        fs,
        now: () => 1000000000000,
        getEditorLogsPath: () => "/test/editor-logs",
        ...overrides,
      };
    }

    it("returns early when directory does not exist", () => {
      const deps = makeDeps();
      deleteExpiredEditorLogs(deps);
      assert.equal(fs._dirs.has("/test/editor-logs"), false);
    });

    it("deletes expired files older than 24 hours", () => {
      const deps = makeDeps();
      fs._dirs.add("/test/editor-logs");
      fs._listings.set("/test/editor-logs", ["editor-uuid-999900000000.log"]);
      fs._files.set("/test/editor-logs/editor-uuid-999900000000.log", "old");
      deleteExpiredEditorLogs(deps);
      assert.equal(
        fs._files.has("/test/editor-logs/editor-uuid-999900000000.log"),
        false,
      );
    });

    it("keeps files newer than 24 hours", () => {
      const deps = makeDeps();
      fs._dirs.add("/test/editor-logs");
      fs._listings.set("/test/editor-logs", ["editor-uuid-999990000000.log"]);
      fs._files.set("/test/editor-logs/editor-uuid-999990000000.log", "new");
      deleteExpiredEditorLogs(deps);
      assert.equal(
        fs._files.has("/test/editor-logs/editor-uuid-999990000000.log"),
        true,
      );
    });

    it("skips files without correct format", () => {
      const deps = makeDeps();
      fs._dirs.add("/test/editor-logs");
      fs._listings.set("/test/editor-logs", [
        "random-file.log",
        "other-uuid-123-notimestamp.log",
        "editor-uuid-999990000001.log",
      ]);
      fs._files.set("/test/editor-logs/random-file.log", "");
      fs._files.set("/test/editor-logs/other-uuid-123-notimestamp.log", "");
      fs._files.set("/test/editor-logs/editor-uuid-999990000001.log", "");
      deleteExpiredEditorLogs(deps);
      assert.equal(fs._files.has("/test/editor-logs/random-file.log"), true);
      assert.equal(
        fs._files.has("/test/editor-logs/other-uuid-123-notimestamp.log"),
        true,
      );
      assert.equal(
        fs._files.has("/test/editor-logs/editor-uuid-999990000001.log"),
        true,
      );
    });

    it("skips non-editor files with 3 parts", () => {
      const deps = makeDeps();
      fs._dirs.add("/test/editor-logs");
      fs._listings.set("/test/editor-logs", ["other-uuid-999997600000.log"]);
      fs._files.set("/test/editor-logs/other-uuid-999997600000.log", "");
      deleteExpiredEditorLogs(deps);
      assert.equal(
        fs._files.has("/test/editor-logs/other-uuid-999997600000.log"),
        true,
      );
    });

  });
});
