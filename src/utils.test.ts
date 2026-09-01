import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert";
import childProcess from "node:child_process";

import {
  isAbortError,
  tryCatch,
  tryCatchAsync,
  normalizeLine,
  getMessageFromError,
  getTempFileName,
  openWithPager,
  createQueue,
  createLockUtils,
  truncate,
  listChatHistoryFiles,
} from "./utils.ts";
import {
  testFs,
  testProcessEnv,
  mockSetTimeout,
  setupTestContext,
  mockPagerSpawn,
  mockBatAvailable,
  batPagerCmd,
} from "./test-helpers.ts";
import { fsDeps, processDeps } from "./deps.ts";

describe("utils", () => {
  beforeEach(() => {
    setupTestContext();
  });

  describe("getMessageFromError", () => {
    it("returns the message from an Error instance", () => {
      assert.equal(
        getMessageFromError(new Error("test message")),
        "test message",
      );
    });

    it("returns JSON string for non-Error values", () => {
      assert.equal(getMessageFromError("string error"), '"string error"');
      assert.equal(getMessageFromError(42), "42");
      assert.equal(getMessageFromError(null), "null");
    });

    it("returns a string for values JSON.stringify cannot serialize", () => {
      assert.equal(getMessageFromError(undefined), "undefined");
      assert.equal(getMessageFromError(Symbol("test")), "Symbol(test)");
    });
  });

  describe("isAbortError", () => {
    it("returns true for an Error with name === 'AbortError'", () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      assert.equal(isAbortError(err), true);
    });

    it("returns false for a plain Error", () => {
      assert.equal(isAbortError(new Error("plain")), false);
    });

    it("returns false for null", () => {
      assert.equal(isAbortError(null), false);
    });

    it("returns false for a string", () => {
      assert.equal(isAbortError("AbortError"), false);
    });
  });

  describe("tryCatch", () => {
    it("returns {ok: true, value} when the callback succeeds", () => {
      const result = tryCatch(() => 42);
      assert.deepStrictEqual(result, { ok: true, value: 42 });
    });

    it("returns {ok: false, error} when the callback throws", () => {
      const err = new Error("boom");
      const result = tryCatch(() => {
        throw err;
      });
      assert.deepStrictEqual(result, { ok: false, error: err });
    });
  });

  describe("tryCatchAsync", () => {
    it("returns {ok: true, value} for a resolved promise", async () => {
      const result = await tryCatchAsync(Promise.resolve(42));
      assert.deepStrictEqual(result, { ok: true, value: 42 });
    });

    it("returns {ok: false, error} for a rejected promise", async () => {
      const err = new Error("boom");
      const result = await tryCatchAsync(Promise.reject(err));
      assert.deepStrictEqual(result, { ok: false, error: err });
    });
  });

  describe("normalizeLine", () => {
    it("trims whitespace and appends newline", () => {
      assert.equal(normalizeLine("  hello  "), "hello\n");
    });

    it("trims leading whitespace", () => {
      assert.equal(normalizeLine("\t\tcontent"), "content\n");
    });

    it("trims trailing whitespace", () => {
      assert.equal(normalizeLine("content\n\n"), "content\n");
    });

    it("handles empty string", () => {
      assert.equal(normalizeLine(""), "\n");
    });

    it("handles already normalized string", () => {
      assert.equal(normalizeLine("already\n"), "already\n");
    });
  });

  describe("truncate", () => {
    const COLUMNS = 100;
    const MAX_LEN = 0.9 * COLUMNS;

    beforeEach(() => {
      mock.method(processDeps.stdout, "getColumns", () => COLUMNS);
    });

    it("returns empty string unchanged", () => {
      assert.equal(truncate(""), "");
    });

    it("returns strings within the max length unchanged", () => {
      assert.equal(truncate("a".repeat(MAX_LEN)), "a".repeat(MAX_LEN));
    });

    it("truncates longer strings to the max length with an ellipsis", () => {
      assert.equal(
        truncate("a".repeat(MAX_LEN + 10)),
        `${"a".repeat(MAX_LEN)}…`,
      );
    });

    it("returns the first line with an ellipsis for multiline input", () => {
      assert.equal(truncate("short\nsecond line"), "short…");
    });

    it("truncates a long first line to the max length with an ellipsis", () => {
      assert.equal(
        truncate(`${"a".repeat(MAX_LEN + 10)}\nrest`),
        `${"a".repeat(MAX_LEN)}…`,
      );
    });

    it("falls back to 80 columns when stdout columns are undefined", () => {
      mock.method(processDeps.stdout, "getColumns", () => undefined);
      assert.equal(truncate("a".repeat(100)), `${"a".repeat(72)}…`);
    });
  });

  describe("getTempFileName", () => {
    it("returns temp file path without initial content", () => {
      const result = getTempFileName();
      assert.equal(result, "/tmp/lasso-test-uuid.txt");
    });

    it("copies initial content when initialContentPath is provided", () => {
      testFs._files.set("/source/file.txt", "initial content");
      const result = getTempFileName({
        initialContentPath: "/source/file.txt",
      });
      assert.equal(result, "/tmp/lasso-test-uuid.txt");
      assert.equal(
        testFs._files.get("/tmp/lasso-test-uuid.txt"),
        "initial content",
      );
    });

    it("skips writing when read fails", () => {
      const result = getTempFileName({
        initialContentPath: "/missing/file.txt",
      });
      assert.equal(result, "/tmp/lasso-test-uuid.txt");
      assert.equal(testFs._files.has("/tmp/lasso-test-uuid.txt"), false);
    });

    it("skips writing when write fails", () => {
      testFs._files.set("/source.txt", "content");
      mock.method(fsDeps, "writeFileSync", () => {
        throw new Error("EIO");
      });
      const result = getTempFileName({
        initialContentPath: "/source.txt",
      });
      assert.equal(result, "/tmp/lasso-test-uuid.txt");
    });

    it("writes initialContentStr into the temp file", () => {
      const result = getTempFileName({
        initialContentStr: "string content",
      });
      assert.equal(result, "/tmp/lasso-test-uuid.txt");
      assert.equal(
        testFs._files.get("/tmp/lasso-test-uuid.txt"),
        "string content",
      );
    });

    it("throws when both initialContentPath and initialContentStr are provided", () => {
      assert.throws(
        () =>
          getTempFileName({
            initialContentPath: "/source/file.txt",
            initialContentStr: "string content",
          }),
        /falsy value/,
      );
    });
  });
  describe("openWithPager", () => {
    let spawned: string[];

    beforeEach(() => {
      spawned = mockPagerSpawn().spawned;
      mockBatAvailable(true);
    });

    it("uses pagerEnvKey env var with __FILE__ replacement", async () => {
      testProcessEnv._set("LASSO_PAGER_HISTORY", "nano __FILE__");
      await openWithPager({
        pagerEnvKey: "LASSO_PAGER_HISTORY",
        contentType: "markdown",
      });
      assert.strictEqual(spawned[0], "nano /tmp/lasso-test-uuid.txt");
    });

    it("falls back to LASSO_PAGER env var", async () => {
      testProcessEnv._set("LASSO_PAGER", "bat __FILE__");
      await openWithPager({
        pagerEnvKey: "LASSO_PAGER_HISTORY",
        contentType: "markdown",
      });
      assert.strictEqual(spawned[0], "bat /tmp/lasso-test-uuid.txt");
    });

    it("falls back to PAGER env var with quoted temp file", async () => {
      testProcessEnv._set("PAGER", "more");
      await openWithPager({
        pagerEnvKey: "LASSO_PAGER_HISTORY",
        contentType: "markdown",
      });
      assert.strictEqual(spawned[0], `more "/tmp/lasso-test-uuid.txt"`);
    });

    it("falls back to bat", async () => {
      await openWithPager({
        pagerEnvKey: "LASSO_PAGER_HISTORY",
        contentType: "markdown",
      });
      assert.strictEqual(spawned[0], batPagerCmd("/tmp/lasso-test-uuid.txt"));
    });

    it("uses base bat flags without markdown flags for diff contentType", async () => {
      await openWithPager({
        pagerEnvKey: "LASSO_PAGER_HISTORY",
        contentType: "diff",
      });
      assert.strictEqual(
        spawned[0],
        batPagerCmd("/tmp/lasso-test-uuid.txt", "diff"),
      );
    });

    it("copies initial content into the temp file", async () => {
      testFs._files.set("/source/file.txt", "initial content");
      await openWithPager({
        pagerEnvKey: "LASSO_PAGER_HISTORY",
        initialContentPath: "/source/file.txt",
        contentType: "markdown",
      });
      assert.strictEqual(
        testFs._files.get("/tmp/lasso-test-uuid.txt"),
        "initial content",
      );
    });

    it("spawns pager with shell and inherit stdio", async () => {
      let spawnArgs: unknown[] = [];
      mock.method(childProcess, "spawnSync", (...args: unknown[]) => {
        spawnArgs = args;
      });
      await openWithPager({
        pagerEnvKey: "LASSO_PAGER_HISTORY",
        contentType: "markdown",
      });
      assert.deepStrictEqual(spawnArgs, [
        batPagerCmd("/tmp/lasso-test-uuid.txt"),
        { shell: true, stdio: "inherit" },
      ]);
    });

    it("writes initialContentStr into the temp file", async () => {
      await openWithPager({
        pagerEnvKey: "LASSO_PAGER_HISTORY",
        initialContentStr: "string content",
        contentType: "markdown",
      });
      assert.strictEqual(
        testFs._files.get("/tmp/lasso-test-uuid.txt"),
        "string content",
      );
    });

    it("throws when both initialContentPath and initialContentStr are provided", async () => {
      await assert.rejects(
        openWithPager({
          pagerEnvKey: "LASSO_PAGER_HISTORY",
          initialContentPath: "/source/file.txt",
          initialContentStr: "string content",
          contentType: "markdown",
        }),
        /falsy value/,
      );
    });

    it("falls back to less when bat is unavailable", async () => {
      mockBatAvailable(false);
      await openWithPager({
        pagerEnvKey: "LASSO_PAGER_HISTORY",
        contentType: "markdown",
      });
      assert.strictEqual(spawned[0], `less "/tmp/lasso-test-uuid.txt"`);
    });
  });

  describe("createQueue", () => {
    it("runs enqueued tasks in order", async () => {
      const queue = createQueue();
      const results: number[] = [];

      queue.enqueue(() => {
        results.push(1);
        return Promise.resolve();
      });
      queue.enqueue(() => {
        results.push(2);
        return Promise.resolve();
      });
      queue.enqueue(() => {
        results.push(3);
        return Promise.resolve();
      });

      await queue.flush();

      assert.deepStrictEqual(results, [1, 2, 3]);
    });

    it("resolves flush immediately when queue is empty", async () => {
      const queue = createQueue();
      await queue.flush();
    });

    it("continues queue after a rejected task", async () => {
      const queue = createQueue();
      const results: number[] = [];

      queue.enqueue(() => {
        results.push(1);
        return Promise.resolve();
      });
      queue.enqueue(() => Promise.reject(new Error("boom")));
      queue.enqueue(() => {
        results.push(3);
        return Promise.resolve();
      });

      await queue.flush();

      assert.deepStrictEqual(results, [1, 3]);
    });

    it("flush waits for all queued tasks to complete", async () => {
      const queue = createQueue();
      let done = false;

      queue.enqueue(() => {
        return new Promise<void>((r) => {
          setTimeout(() => {
            done = true;
            r();
          }, 10);
        });
      });

      await queue.flush();

      assert.strictEqual(done, true);
    });
  });

  describe("listChatHistoryFiles", () => {
    it("returns an empty array when the directory does not exist", () => {
      assert.deepStrictEqual(listChatHistoryFiles(), []);
    });

    it("returns an empty array when the directory has no files", () => {
      testFs._dirs.add("/fake-home/.config/lasso/history");
      assert.deepStrictEqual(listChatHistoryFiles(), []);
    });

    it("returns valid chat history files with absolute path and timestamp", () => {
      testFs._dirs.add("/fake-home/.config/lasso/history");
      testFs._files.set(
        "/fake-home/.config/lasso/history/chat-history-1234567890000.txt",
        "",
      );
      testFs._files.set(
        "/fake-home/.config/lasso/history/chat-history-999990000000.txt",
        "",
      );

      assert.deepStrictEqual(listChatHistoryFiles(), [
        {
          absolutePath:
            "/fake-home/.config/lasso/history/chat-history-1234567890000.txt",
          timestampMs: 1234567890000,
        },
        {
          absolutePath:
            "/fake-home/.config/lasso/history/chat-history-999990000000.txt",
          timestampMs: 999990000000,
        },
      ]);
    });

    it("skips directory entries", () => {
      testFs._dirs.add("/fake-home/.config/lasso/history");
      testFs._dirs.add(
        "/fake-home/.config/lasso/history/chat-history-1234567890000.txt",
      );
      assert.deepStrictEqual(listChatHistoryFiles(), []);
    });

    it("skips files that do not match chat-history-<timestamp>", () => {
      testFs._dirs.add("/fake-home/.config/lasso/history");
      testFs._files.set("/fake-home/.config/lasso/history/random-file.txt", "");
      testFs._files.set(
        "/fake-home/.config/lasso/history/chat-history-uuid-123.txt",
        "",
      );
      testFs._files.set(
        "/fake-home/.config/lasso/history/chat-history-notanumber.txt",
        "",
      );
      assert.deepStrictEqual(listChatHistoryFiles(), []);
    });

    it("skips files with non-txt extension", () => {
      testFs._dirs.add("/fake-home/.config/lasso/history");
      testFs._files.set(
        "/fake-home/.config/lasso/history/chat-history-123.log",
        "",
      );
      assert.deepStrictEqual(listChatHistoryFiles(), []);
    });

    describe("createLockUtils", () => {
      beforeEach(() => {
        mock.method(
          fsDeps,
          "writeFileSync",
          (path: string, content: string, options?: { flag?: string }) => {
            if (options?.flag === "wx" && testFs._files.has(path)) {
              const err = new Error(`EEXIST: ${path}`) as NodeJS.ErrnoException;
              err.code = "EEXIST";
              throw err;
            }
            testFs.writeFileSync(path, content);
          },
        );
      });

      it("creates the lock file with the current pid", async () => {
        const lockUtils = createLockUtils("/lock");
        assert.equal(await lockUtils.createLock(), true);
        assert.equal(testFs._files.get("/lock"), String(process.pid));
      });

      it("returns false and keeps the file when held by a live process", async () => {
        testFs._files.set("/lock", "42");
        mock.method(processDeps, "kill", () => undefined);
        const timerCallbacks = mockSetTimeout();

        const lockUtils = createLockUtils("/lock");
        const promise = lockUtils.createLock();
        while (timerCallbacks.length > 0) {
          timerCallbacks.shift()!();
          await Promise.resolve();
        }

        assert.equal(await promise, false);
        assert.equal(testFs._files.get("/lock"), "42");
        mock.restoreAll();
      });

      it("acquires after the holder releases within the retry window", async () => {
        testFs._files.set("/lock", "42");
        mock.method(processDeps, "kill", () => undefined);
        const timerCallbacks = mockSetTimeout();

        const lockUtils = createLockUtils("/lock");
        const promise = lockUtils.createLock();
        assert.equal(timerCallbacks.length, 1);

        testFs._files.delete("/lock");
        timerCallbacks.shift()!();

        assert.equal(await promise, true);
        assert.equal(testFs._files.get("/lock"), String(process.pid));
        mock.restoreAll();
      });

      it("steals the lock from a dead process (ESRCH)", async () => {
        testFs._files.set("/lock", "42");
        mock.method(processDeps, "kill", () => {
          const err = new Error("No such process") as NodeJS.ErrnoException;
          err.code = "ESRCH";
          throw err;
        });

        const lockUtils = createLockUtils("/lock");
        assert.equal(await lockUtils.createLock(), true);
        assert.equal(testFs._files.get("/lock"), String(process.pid));
        mock.restoreAll();
      });

      it("returns false when the holder is alive but not ours (EPERM)", async () => {
        testFs._files.set("/lock", "42");
        mock.method(processDeps, "kill", () => {
          const err = new Error(
            "Operation not permitted",
          ) as NodeJS.ErrnoException;
          err.code = "EPERM";
          throw err;
        });
        const timerCallbacks = mockSetTimeout();

        const lockUtils = createLockUtils("/lock");
        const promise = lockUtils.createLock();
        while (timerCallbacks.length > 0) {
          timerCallbacks.shift()!();
          await Promise.resolve();
        }

        assert.equal(await promise, false);
        assert.equal(testFs._files.get("/lock"), "42");
        mock.restoreAll();
      });

      it("steals the lock when the file content is not a pid", async () => {
        testFs._files.set("/lock", "not-a-pid");

        const lockUtils = createLockUtils("/lock");
        assert.equal(await lockUtils.createLock(), true);
        assert.equal(testFs._files.get("/lock"), String(process.pid));
      });

      it("steals the lock when the lock file cannot be read", async () => {
        testFs._files.set("/lock", "42");
        mock.method(fsDeps, "readFileSync", () => {
          const err = new Error("I/O error") as NodeJS.ErrnoException;
          err.code = "EIO";
          throw err;
        });

        const lockUtils = createLockUtils("/lock");
        assert.equal(await lockUtils.createLock(), true);
        assert.equal(testFs._files.get("/lock"), String(process.pid));
      });

      it("deletes the lock file", () => {
        testFs._files.set("/lock", String(process.pid));
        const lockUtils = createLockUtils("/lock");
        lockUtils.deleteLock();
        assert.equal(testFs._files.has("/lock"), false);
      });

      it("tolerates deleting a missing lock file", () => {
        const lockUtils = createLockUtils("/lock");
        assert.doesNotThrow(() => lockUtils.deleteLock());
      });
    });
  });
});
