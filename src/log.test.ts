import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

import {
  debugLog,
  appendToPromptHistory,
  resetDebugLog,
  initPromptHistory,
  deleteExpiredPromptHistory,
} from "./log.ts";
import { actions, getState } from "./state.ts";
import { testFs, setupTestContext } from "./test-helpers.ts";
import { fsDeps } from "./deps.ts";

describe("log", () => {
  beforeEach(() => {
    setupTestContext();
  });

  describe("debugLog", () => {
    beforeEach(() => {
      mock.method(Date, "now", () => 1700000000000);
    });

    it("does nothing when debugLog is disabled", () => {
      actions.setDebugLog(false);
      debugLog("test message");
      assert.equal(testFs._files.has("/test-cwd/.agent-js/debug.log"), false);
    });

    it("creates directory when log file does not exist", () => {
      actions.setDebugLog(true);
      debugLog("test message");
      assert.equal(testFs._dirs.has("/test-cwd/.agent-js"), true);
    });

    it("appends content to log file with timestamp", () => {
      actions.setDebugLog(true);
      debugLog("test message");
      assert.equal(
        testFs._files.get("/test-cwd/.agent-js/debug.log"),
        "2023-11-14T22:13:20.000Z :: test message\n",
      );
    });

    it("appends multiple messages", () => {
      actions.setDebugLog(true);
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

  describe("appendToPromptHistory", () => {
    beforeEach(() => {
      mock.method(Date, "now", () => 1700000000000);
    });

    it("creates directory when log file does not exist", () => {
      actions.setPromptHistoryPath("/test/editor.log");
      appendToPromptHistory("test message");
      assert.equal(testFs._dirs.has("/test"), true);
    });

    it("appends content with timestamp and separator", () => {
      actions.setPromptHistoryPath("/test/editor.log");
      appendToPromptHistory("test content");
      assert.equal(
        testFs._files.get("/test/editor.log"),
        `2023-11-14T22:13:20.000Z
-------------------------
test content

`,
      );
    });

    it("appends multiple messages with separators", () => {
      actions.setPromptHistoryPath("/test/editor.log");
      appendToPromptHistory("content 1");
      appendToPromptHistory("content 2");
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
    it("does nothing when log file does not exist", () => {
      resetDebugLog();
      assert.equal(testFs._files.has("/test-cwd/.agent-js/debug.log"), false);
    });

    it("clears the log file when it exists", () => {
      testFs._dirs.add("/test-cwd/.agent-js");
      testFs._files.set("/test-cwd/.agent-js/debug.log", "existing content");
      resetDebugLog();
      assert.equal(testFs._files.get("/test-cwd/.agent-js/debug.log"), "");
    });
  });

  describe("initPromptHistory", () => {
    beforeEach(() => {
      mock.method(Date, "now", () => 1234567890000);
    });

    it("creates directory and sets path when directory does not exist", () => {
      initPromptHistory();
      assert.equal(
        testFs._dirs.has("/fake-home/.config/.agent-js/history"),
        true,
      );
      assert.equal(
        getState().app.promptHistoryPath,
        "/fake-home/.config/.agent-js/history/prompt-history-testuuid-1234567890000.log",
      );
      assert.equal(
        testFs._files.get(
          "/fake-home/.config/.agent-js/history/prompt-history-testuuid-1234567890000.log",
        ),
        "",
      );
    });

    it("disables history when mkdir fails", () => {
      mock.method(fsDeps, "existsSync", () => false);
      mock.method(fsDeps, "mkdirSync", () => {
        throw new Error("Permission denied");
      });
      initPromptHistory();
      assert.equal(getState().app.promptHistoryPath, "");
    });

    it("generates correct log path with uuid and timestamp, stripping dashes", () => {
      initPromptHistory();
      assert.equal(
        getState().app.promptHistoryPath,
        "/fake-home/.config/.agent-js/history/prompt-history-testuuid-1234567890000.log",
      );
      assert.equal(
        testFs._files.get(
          "/fake-home/.config/.agent-js/history/prompt-history-testuuid-1234567890000.log",
        ),
        "",
      );
    });
  });

  describe("deleteExpiredPromptHistory", () => {
    beforeEach(() => {
      mock.method(Date, "now", () => 1000000000000);
    });

    it("returns early when directory does not exist", () => {
      deleteExpiredPromptHistory();
      assert.equal(
        testFs._dirs.has("/fake-home/.config/.agent-js/history"),
        false,
      );
    });

    it("deletes expired files older than 24 hours", () => {
      testFs._dirs.add("/fake-home/.config/.agent-js/history");
      testFs._files.set(
        "/fake-home/.config/.agent-js/history/prompt-history-uuid-999900000000.log",
        "old",
      );
      deleteExpiredPromptHistory();
      assert.equal(
        testFs._files.has(
          "/fake-home/.config/.agent-js/history/prompt-history-uuid-999900000000.log",
        ),
        false,
      );
    });

    it("keeps files newer than 24 hours", () => {
      testFs._dirs.add("/fake-home/.config/.agent-js/history");
      testFs._files.set(
        "/fake-home/.config/.agent-js/history/prompt-history-uuid-999990000000.log",
        "new",
      );
      deleteExpiredPromptHistory();
      assert.equal(
        testFs._files.has(
          "/fake-home/.config/.agent-js/history/prompt-history-uuid-999990000000.log",
        ),
        true,
      );
    });

    it("skips files without correct format", () => {
      testFs._dirs.add("/fake-home/.config/.agent-js/history");
      testFs._files.set(
        "/fake-home/.config/.agent-js/history/random-file.log",
        "",
      );
      testFs._files.set(
        "/fake-home/.config/.agent-js/history/other-uuid-123-notimestamp.log",
        "",
      );
      testFs._files.set(
        "/fake-home/.config/.agent-js/history/prompt-history-uuid-999990000001.log",
        "",
      );
      deleteExpiredPromptHistory();
      assert.equal(
        testFs._files.has(
          "/fake-home/.config/.agent-js/history/random-file.log",
        ),
        true,
      );
      assert.equal(
        testFs._files.has(
          "/fake-home/.config/.agent-js/history/other-uuid-123-notimestamp.log",
        ),
        true,
      );
      assert.equal(
        testFs._files.has(
          "/fake-home/.config/.agent-js/history/prompt-history-uuid-999990000001.log",
        ),
        true,
      );
    });

    it("skips non-prompt-history files with 4 parts", () => {
      testFs._dirs.add("/fake-home/.config/.agent-js/history");
      testFs._files.set(
        "/fake-home/.config/.agent-js/history/other-uuid-999997600000.log",
        "",
      );
      deleteExpiredPromptHistory();
      assert.equal(
        testFs._files.has(
          "/fake-home/.config/.agent-js/history/other-uuid-999997600000.log",
        ),
        true,
      );
    });
  });
});
