import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  debugLog,
  editorLog,
  resetDebugLog,
  initEditorLog,
  deleteExpiredEditorLogs,
} from "./log.ts";
import { dispatch, actions, selectors } from "./state.ts";
import { testFs, setupFakeDeps } from "./test-helpers.ts";
import { fsDeps } from "./deps.ts";

describe("log", () => {
  beforeEach(() => {
    dispatch(actions.resetState());
  });

  describe("debugLog", () => {
    beforeEach(() => {
      setupFakeDeps();
      mock.method(Date, "now", () => 1700000000000);
    });

    it("does nothing when debugLog is disabled", () => {
      dispatch(actions.setDebugLog(false));
      debugLog("test message");
      assert.equal(
        testFs._files.has("/test-cwd/.agent-js/debug.log"),
        false,
      );
    });

    it("creates directory when log file does not exist", () => {
      dispatch(actions.setDebugLog(true));
      debugLog("test message");
      assert.equal(
        testFs._dirs.has("/test-cwd/.agent-js"),
        true,
      );
    });

    it("appends content to log file with timestamp", () => {
      dispatch(actions.setDebugLog(true));
      debugLog("test message");
      assert.equal(
        testFs._files.get("/test-cwd/.agent-js/debug.log"),
        "2023-11-14T22:13:20.000Z :: test message\n",
      );
    });

    it("appends multiple messages", () => {
      dispatch(actions.setDebugLog(true));
      debugLog("message 1");
      debugLog("message 2");
      assert.equal(
        testFs._files.get("/test-cwd/.agent-js/debug.log"),
        `2023-11-14T22:13:20.000Z :: message 1
2023-11-14T22:13:20.000Z :: message 2
`,
      );
    });
  });

  describe("editorLog", () => {
    beforeEach(() => {
      setupFakeDeps();
      mock.method(Date, "now", () => 1700000000000);
    });

    it("does nothing when editorLog is disabled", () => {
      dispatch(actions.setEditorLog(false));
      dispatch(actions.setEditorLogPath("/test/editor.log"));
      editorLog("test message");
      assert.equal(testFs._files.has("/test/editor.log"), false);
    });

    it("creates directory when log file does not exist", () => {
      dispatch(actions.setEditorLog(true));
      dispatch(actions.setEditorLogPath("/test/editor.log"));
      editorLog("test message");
      assert.equal(testFs._dirs.has("/test"), true);
    });

    it("appends content with timestamp and separator", () => {
      dispatch(actions.setEditorLog(true));
      dispatch(actions.setEditorLogPath("/test/editor.log"));
      editorLog("test content");
      assert.equal(
        testFs._files.get("/test/editor.log"),
        `2023-11-14T22:13:20.000Z
-------------------------
test content

`,
      );
    });

    it("appends multiple messages with separators", () => {
      dispatch(actions.setEditorLog(true));
      dispatch(actions.setEditorLogPath("/test/editor.log"));
      editorLog("content 1");
      editorLog("content 2");
      assert.equal(
        testFs._files.get("/test/editor.log"),
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
    beforeEach(() => {
      setupFakeDeps();
    });

    it("does nothing when log file does not exist", () => {
      resetDebugLog();
      assert.equal(
        testFs._files.has("/test-cwd/.agent-js/debug.log"),
        false,
      );
    });

    it("clears the log file when it exists", () => {
      testFs._dirs.add("/test-cwd/.agent-js");
      testFs._files.set("/test-cwd/.agent-js/debug.log", "existing content");
      resetDebugLog();
      assert.equal(
        testFs._files.get("/test-cwd/.agent-js/debug.log"),
        "",
      );
    });
  });

  describe("initEditorLog", () => {
    beforeEach(() => {
      setupFakeDeps();
      mock.method(Date, "now", () => 1234567890000);
    });

    it("creates directory and sets path when directory does not exist", () => {
      dispatch(actions.setEditorLog(true));
      initEditorLog();
      assert.equal(
        testFs._dirs.has("/fake-home/.config/.agent-js/editor"),
        true,
      );
      assert.equal(selectors.getEditorLog(), true);
      assert.match(
        selectors.getEditorLogPath(),
        /editor-[a-f0-9-]+-1234567890000\.log$/,
      );
    });

    it("disables editor log when mkdir fails", () => {
      dispatch(actions.setEditorLog(true));
      mock.method(fsDeps, "existsSync", () => false);
      mock.method(fsDeps, "mkdirSync", () => {
        throw new Error("Permission denied");
      });
      initEditorLog();
      assert.equal(selectors.getEditorLog(), false);
    });

    it("generates correct log path with uuid and timestamp", () => {
      dispatch(actions.setEditorLog(true));
      initEditorLog();
      assert.match(
        selectors.getEditorLogPath(),
        /editor-[a-f0-9-]+-1234567890000\.log$/,
      );
    });
  });

  describe("deleteExpiredEditorLogs", () => {
    beforeEach(() => {
      setupFakeDeps();
      mock.method(Date, "now", () => 1000000000000);
    });

    it("returns early when directory does not exist", () => {
      deleteExpiredEditorLogs();
      assert.equal(
        testFs._dirs.has("/fake-home/.config/.agent-js/editor"),
        false,
      );
    });

    it("deletes expired files older than 24 hours", () => {
      testFs._dirs.add("/fake-home/.config/.agent-js/editor");
      testFs._files.set(
        "/fake-home/.config/.agent-js/editor/editor-uuid-999900000000.log",
        "old",
      );
      deleteExpiredEditorLogs();
      assert.equal(
        testFs._files.has(
          "/fake-home/.config/.agent-js/editor/editor-uuid-999900000000.log",
        ),
        false,
      );
    });

    it("keeps files newer than 24 hours", () => {
      testFs._dirs.add("/fake-home/.config/.agent-js/editor");
      testFs._files.set(
        "/fake-home/.config/.agent-js/editor/editor-uuid-999990000000.log",
        "new",
      );
      deleteExpiredEditorLogs();
      assert.equal(
        testFs._files.has(
          "/fake-home/.config/.agent-js/editor/editor-uuid-999990000000.log",
        ),
        true,
      );
    });

    it("skips files without correct format", () => {
      testFs._dirs.add("/fake-home/.config/.agent-js/editor");
      testFs._files.set(
        "/fake-home/.config/.agent-js/editor/random-file.log",
        "",
      );
      testFs._files.set(
        "/fake-home/.config/.agent-js/editor/other-uuid-123-notimestamp.log",
        "",
      );
      testFs._files.set(
        "/fake-home/.config/.agent-js/editor/editor-uuid-999990000001.log",
        "",
      );
      deleteExpiredEditorLogs();
      assert.equal(
        testFs._files.has("/fake-home/.config/.agent-js/editor/random-file.log"),
        true,
      );
      assert.equal(
        testFs._files.has(
          "/fake-home/.config/.agent-js/editor/other-uuid-123-notimestamp.log",
        ),
        true,
      );
      assert.equal(
        testFs._files.has(
          "/fake-home/.config/.agent-js/editor/editor-uuid-999990000001.log",
        ),
        true,
      );
    });

    it("skips non-editor files with 3 parts", () => {
      testFs._dirs.add("/fake-home/.config/.agent-js/editor");
      testFs._files.set(
        "/fake-home/.config/.agent-js/editor/other-uuid-999997600000.log",
        "",
      );
      deleteExpiredEditorLogs();
      assert.equal(
        testFs._files.has(
          "/fake-home/.config/.agent-js/editor/other-uuid-999997600000.log",
        ),
        true,
      );
    });
  });
});
