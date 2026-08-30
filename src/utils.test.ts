import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert";

import {
  isAbortError,
  tryCatch,
  tryCatchAsync,
  normalizeLine,
  getMessageFromError,
  getTempFileName,
  createQueue,
  truncate,
  listChatHistoryFiles,
} from "./utils.ts";
import { testFs, setupTestContext } from "./test-helpers.ts";
import { processDeps } from "./deps.ts";

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
      assert.equal(result, "/tmp/agent-js-test-uuid.txt");
    });

    it("copies initial content when initialContentPath is provided", () => {
      testFs._files.set("/source/file.txt", "initial content");
      const result = getTempFileName({
        initialContentPath: "/source/file.txt",
      });
      assert.equal(result, "/tmp/agent-js-test-uuid.txt");
      assert.equal(
        testFs._files.get("/tmp/agent-js-test-uuid.txt"),
        "initial content",
      );
    });

    it("skips writing when read fails", () => {
      const result = getTempFileName({
        initialContentPath: "/missing/file.txt",
      });
      assert.equal(result, "/tmp/agent-js-test-uuid.txt");
      assert.equal(testFs._files.has("/tmp/agent-js-test-uuid.txt"), false);
    });

    it("skips writing when write fails", () => {
      testFs._files.set("/source.txt", "content");
      testFs.writeFileSync = () => {
        throw new Error("EIO");
      };
      const result = getTempFileName({
        initialContentPath: "/source.txt",
      });
      assert.equal(result, "/tmp/agent-js-test-uuid.txt");
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
      testFs._dirs.add("/fake-home/.config/agent-js/history");
      assert.deepStrictEqual(listChatHistoryFiles(), []);
    });

    it("returns valid chat history files with absolute path and timestamp", () => {
      testFs._dirs.add("/fake-home/.config/agent-js/history");
      testFs._files.set(
        "/fake-home/.config/agent-js/history/chat-history-1234567890000.txt",
        "",
      );
      testFs._files.set(
        "/fake-home/.config/agent-js/history/chat-history-999990000000.txt",
        "",
      );

      assert.deepStrictEqual(listChatHistoryFiles(), [
        {
          absolutePath:
            "/fake-home/.config/agent-js/history/chat-history-1234567890000.txt",
          timestampMs: 1234567890000,
        },
        {
          absolutePath:
            "/fake-home/.config/agent-js/history/chat-history-999990000000.txt",
          timestampMs: 999990000000,
        },
      ]);
    });

    it("skips directory entries", () => {
      testFs._dirs.add("/fake-home/.config/agent-js/history");
      testFs._dirs.add(
        "/fake-home/.config/agent-js/history/chat-history-1234567890000.txt",
      );
      assert.deepStrictEqual(listChatHistoryFiles(), []);
    });

    it("skips files that do not match chat-history-<timestamp>", () => {
      testFs._dirs.add("/fake-home/.config/agent-js/history");
      testFs._files.set(
        "/fake-home/.config/agent-js/history/random-file.txt",
        "",
      );
      testFs._files.set(
        "/fake-home/.config/agent-js/history/chat-history-uuid-123.txt",
        "",
      );
      testFs._files.set(
        "/fake-home/.config/agent-js/history/chat-history-notanumber.txt",
        "",
      );
      assert.deepStrictEqual(listChatHistoryFiles(), []);
    });

    it("skips files with non-txt extension", () => {
      testFs._dirs.add("/fake-home/.config/agent-js/history");
      testFs._files.set(
        "/fake-home/.config/agent-js/history/chat-history-123.log",
        "",
      );
      assert.deepStrictEqual(listChatHistoryFiles(), []);
    });
  });
});
