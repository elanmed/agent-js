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
import type { Dirent } from "node:fs";

describe("log", () => {
  beforeEach(() => {
    dispatch(actions.resetState());
  });

  describe("debugLog", () => {
    function makeDeps(
      overrides: Partial<DebugLogDeps> = {},
    ): DebugLogDeps & { files: Map<string, string>; dirs: Set<string> } {
      const files = new Map<string, string>();
      const dirs = new Set<string>();
      return {
        files,
        dirs,
        existsSync: (path: string) => files.has(path) || dirs.has(path),
        mkdirSync: (path: string) => dirs.add(path),
        appendFileSync: (path: string, content: string) => {
          const existing = files.get(path) ?? "";
          files.set(path, existing + "---LOG_ENTRY---" + content);
        },
        writeFileSync: (path: string, content: string) =>
          files.set(path, content),
        readFileSync: (path: string) => files.get(path) ?? "",
        getDebugLogPath: () => "/test/debug.log",
        ...overrides,
      };
    }

    it("does nothing when debugLog is disabled", () => {
      dispatch(actions.setDebugLog(false));
      const deps = makeDeps();
      debugLog("test message", deps);
      assert.equal(deps.existsSync("/test/debug.log"), false);
    });

    it("creates directory when log file does not exist", () => {
      dispatch(actions.setDebugLog(true));
      const deps = makeDeps();
      const mkdirCalls: string[] = [];
      const originalMkdirSync = deps.mkdirSync;
      deps.mkdirSync = (path: string) => {
        mkdirCalls.push(path);
        originalMkdirSync(path);
      };

      debugLog("test message", deps);
      assert.deepStrictEqual(mkdirCalls, ["/test"]);
    });

    it("appends content to log file with timestamp", () => {
      dispatch(actions.setDebugLog(true));
      const deps = makeDeps();
      const appendCalls: { path: string; content: string }[] = [];
      const originalAppend = deps.appendFileSync;
      deps.appendFileSync = (path: string, content: string) => {
        appendCalls.push({ path, content });
        originalAppend(path, content);
      };

      debugLog("test message", deps);

      assert.equal(appendCalls.length, 1);
      const firstCall = appendCalls[0]!;
      assert.equal(firstCall.path, "/test/debug.log");
      assert.ok(firstCall.content.includes("test message"));
      assert.ok(/\d{4}-\d{2}-\d{2}T/.exec(firstCall.content));
    });

    it("appends multiple messages", () => {
      dispatch(actions.setDebugLog(true));
      const deps = makeDeps();
      const appendCalls: { path: string; content: string }[] = [];
      const originalAppend = deps.appendFileSync;
      deps.appendFileSync = (path: string, content: string) => {
        appendCalls.push({ path, content });
        originalAppend(path, content);
      };

      debugLog("message 1", deps);
      debugLog("message 2", deps);

      assert.equal(appendCalls.length, 2);
      assert.ok(appendCalls[0]!.content.includes("message 1"));
      assert.ok(appendCalls[1]!.content.includes("message 2"));
    });
  });

  describe("editorLog", () => {
    function makeDeps(
      overrides: Partial<EditorLogDeps> = {},
    ): EditorLogDeps & { files: Map<string, string>; dirs: Set<string> } {
      const files = new Map<string, string>();
      const dirs = new Set<string>();
      return {
        files,
        dirs,
        existsSync: (path: string) => files.has(path) || dirs.has(path),
        mkdirSync: (path: string) => dirs.add(path),
        appendFileSync: (path: string, content: string) => {
          const existing = files.get(path) ?? "";
          files.set(path, existing + "---LOG_ENTRY---" + content);
        },
        normalizeLine: (content: string) => content.trim().concat("\n"),
        getEditorLogPath: () => "/test/editor.log",
        getEditorLog: () => true,
        ...overrides,
      };
    }

    it("does nothing when editorLog is disabled", () => {
      const deps = makeDeps({ getEditorLog: () => false });
      editorLog("test message", deps);
      assert.equal(deps.existsSync("/test/editor.log"), false);
    });

    it("creates directory when log file does not exist", () => {
      const deps = makeDeps();
      const mkdirCalls: string[] = [];
      const originalMkdirSync = deps.mkdirSync;
      deps.mkdirSync = (path: string) => {
        mkdirCalls.push(path);
        originalMkdirSync(path);
      };

      editorLog("test message", deps);
      assert.deepStrictEqual(mkdirCalls, ["/test"]);
    });

    it("appends content with timestamp and separator", () => {
      const deps = makeDeps();
      const appendCalls: { path: string; content: string }[] = [];
      const originalAppend = deps.appendFileSync;
      deps.appendFileSync = (path: string, content: string) => {
        appendCalls.push({ path, content });
        originalAppend(path, content);
      };

      editorLog("test content", deps);

      assert.equal(appendCalls.length, 1);
      const firstCall = appendCalls[0]!;
      assert.equal(firstCall.path, "/test/editor.log");
      const content = firstCall.content;
      assert.ok(content.includes("test content"));
      assert.ok(content.includes("-".repeat(25)));
      assert.ok(/\d{4}-\d{2}-\d{2}T/.exec(content));
    });

    it("appends multiple messages with separators", () => {
      const deps = makeDeps();
      const appendCalls: { path: string; content: string }[] = [];
      const originalAppend = deps.appendFileSync;
      deps.appendFileSync = (path: string, content: string) => {
        appendCalls.push({ path, content });
        originalAppend(path, content);
      };

      editorLog("content 1", deps);
      editorLog("content 2", deps);

      assert.equal(appendCalls.length, 2);
      assert.ok(appendCalls[0]!.content.includes("content 1"));
      assert.ok(appendCalls[1]!.content.includes("content 2"));
    });
  });

  describe("resetDebugLog", () => {
    function makeDeps(
      overrides: Partial<ResetDebugLogDeps> = {},
    ): ResetDebugLogDeps & { files: Map<string, string>; dirs: Set<string> } {
      const files = new Map<string, string>();
      const dirs = new Set<string>();
      return {
        files,
        dirs,
        existsSync: (path: string) => files.has(path) || dirs.has(path),
        writeFileSync: (path: string, content: string) =>
          files.set(path, content),
        getDebugLogPath: () => "/test/debug.log",
        ...overrides,
      };
    }

    it("does nothing when log file does not exist", () => {
      const deps = makeDeps();
      const writeCalls: { path: string; content: string }[] = [];
      const originalWrite = deps.writeFileSync;
      deps.writeFileSync = (path: string, content: string) => {
        writeCalls.push({ path, content });
        originalWrite(path, content);
      };

      resetDebugLog(deps);
      assert.equal(writeCalls.length, 0);
    });

    it("clears the log file when it exists", () => {
      const deps = makeDeps();
      deps.dirs.add("/test");
      deps.files.set("/test/debug.log", "existing content");

      resetDebugLog(deps);

      assert.equal(deps.existsSync("/test/debug.log"), true);
      assert.equal(deps.files.get("/test/debug.log"), "");
    });
  });

  describe("initEditorLog", () => {
    function makeDeps(
      overrides: Partial<InitEditorLogDeps> = {},
    ): InitEditorLogDeps & { files: Map<string, string>; dirs: Set<string> } {
      const files = new Map<string, string>();
      const dirs = new Set<string>();
      return {
        files,
        dirs,
        existsSync: (path: string) => files.has(path) || dirs.has(path),
        mkdirSync: (path: string) => dirs.add(path),
        randomUUID: () => "test-uuid",
        now: () => 1234567890000,
        ...overrides,
      };
    }

    it("creates directory and sets path when directory does not exist", () => {
      dispatch(actions.setEditorLog(true));
      const deps = makeDeps();
      initEditorLog(deps);

      assert.equal(deps.existsSync(EDITOR_LOGS_PATH), true);
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
        existsSync: () => false,
        mkdirSync: () => {
          throw new Error("Permission denied");
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
    function makeDeps(
      overrides: Partial<DeleteExpiredEditorLogsDeps> = {},
    ): DeleteExpiredEditorLogsDeps {
      return {
        existsSync: () => true,
        readdirSync: () => [],
        unlinkSync: () => undefined,
        now: () => 1000000000000,
        getEditorLogsPath: () => "/test/editor-logs",
        ...overrides,
      };
    }

    function makeDirent(
      name: string,
      parentPath: string,
      isFile = true,
    ): Dirent {
      return {
        name,
        parentPath,
        isFile: () => isFile,
      } as Dirent;
    }

    it("returns early when directory does not exist", () => {
      const readdirCalls: string[] = [];
      const deps = makeDeps({
        existsSync: () => false,
        readdirSync: (path: string) => {
          readdirCalls.push(path);
          return [];
        },
      });
      deleteExpiredEditorLogs(deps);
      assert.equal(readdirCalls.length, 0);
    });

    it("deletes expired files older than 24 hours", () => {
      const deleted: string[] = [];
      const deps = makeDeps({
        readdirSync: () => [
          makeDirent("editor-uuid-999900000000.log", "/test/editor-logs"),
        ],
        unlinkSync: (path: string) => deleted.push(path),
      });
      deleteExpiredEditorLogs(deps);

      assert.equal(deleted.length, 1);
      assert.equal(
        deleted[0],
        "/test/editor-logs/editor-uuid-999900000000.log",
      );
    });

    it("keeps files newer than 24 hours", () => {
      const deleted: string[] = [];
      const deps = makeDeps({
        readdirSync: () => [
          makeDirent("editor-uuid-999990000000.log", "/test/editor-logs"),
        ],
        unlinkSync: (path: string) => deleted.push(path),
      });
      deleteExpiredEditorLogs(deps);

      assert.equal(deleted.length, 0);
    });

    it("skips files without correct format", () => {
      const deleted: string[] = [];
      const deps = makeDeps({
        readdirSync: () => [
          makeDirent("random-file.log", "/test/editor-logs"),
          makeDirent("other-uuid-123-notimestamp.log", "/test/editor-logs"),
          makeDirent("editor-uuid-999990000001.log", "/test/editor-logs"),
        ],
        unlinkSync: (path: string) => deleted.push(path),
      });
      deleteExpiredEditorLogs(deps);

      assert.equal(deleted.length, 0);
    });

    it("skips non-editor files with 3 parts", () => {
      const deleted: string[] = [];
      const deps = makeDeps({
        readdirSync: () => [
          makeDirent("other-uuid-999997600000.log", "/test/editor-logs"),
        ],
        unlinkSync: (path: string) => deleted.push(path),
      });
      deleteExpiredEditorLogs(deps);

      assert.equal(deleted.length, 0);
    });

    it("handles recursive directories", () => {
      const deleted: string[] = [];
      const deps = makeDeps({
        readdirSync: () => [
          makeDirent(
            "editor-uuid-999900000000.log",
            "/test/editor-logs/subdir",
          ),
        ],
        unlinkSync: (path: string) => deleted.push(path),
      });
      deleteExpiredEditorLogs(deps);

      assert.equal(deleted.length, 1);
      assert.equal(
        deleted[0],
        "/test/editor-logs/subdir/editor-uuid-999900000000.log",
      );
    });
  });
});
