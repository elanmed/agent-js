import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import {
  isAbortError,
  tryCatch,
  tryCatchAsync,
  normalizeLine,
  getMessageFromError,
  createTempFile,
  type CreateTempFileDeps,
} from "./utils.ts";
import { dispatch, actions } from "./state.ts";
import { makeFsDeps } from "./fs-deps.ts";

describe("utils", () => {
  beforeEach(() => {
    dispatch(actions.resetState());
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
      assert.deepEqual(result, { ok: true, value: 42 });
    });

    it("returns {ok: false, error} when the callback throws", () => {
      const err = new Error("boom");
      const result = tryCatch(() => {
        throw err;
      });
      assert.deepEqual(result, { ok: false, error: err });
    });
  });

  describe("tryCatchAsync", () => {
    it("returns {ok: true, value} for a resolved promise", async () => {
      const result = await tryCatchAsync(Promise.resolve(42));
      assert.deepEqual(result, { ok: true, value: 42 });
    });

    it("returns {ok: false, error} for a rejected promise", async () => {
      const err = new Error("boom");
      const result = await tryCatchAsync(Promise.reject(err));
      assert.deepEqual(result, { ok: false, error: err });
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

  describe("createTempFile", () => {
    let fs: ReturnType<typeof makeFsDeps>;
    beforeEach(() => {
      fs = makeFsDeps();
    });

    function makeDeps(overrides: Partial<CreateTempFileDeps> = {}) {
      return {
        tmpdir: () => "/tmp",
        randomUUID: () => "test-uuid",
        fs,
        ...overrides,
      };
    }

    it("returns temp file path without initial content", () => {
      const deps = makeDeps();
      const result = createTempFile(undefined, deps);
      assert.equal(result, "/tmp/agent-js-test-uuid.txt");
    });

    it("copies initial content when initialContentPath is provided", () => {
      fs._files.set("/source/file.txt", "initial content");
      const deps = makeDeps();
      const result = createTempFile(
        { initialContentPath: "/source/file.txt" },
        deps,
      );
      assert.equal(result, "/tmp/agent-js-test-uuid.txt");
      assert.equal(
        fs._files.get("/tmp/agent-js-test-uuid.txt"),
        "initial content",
      );
    });

    it("skips writing when read fails", () => {
      const deps = makeDeps();
      const result = createTempFile(
        { initialContentPath: "/missing/file.txt" },
        deps,
      );
      assert.equal(result, "/tmp/agent-js-test-uuid.txt");
      assert.equal(fs._files.has("/tmp/agent-js-test-uuid.txt"), false);
    });

    it("skips writing when write fails", () => {
      fs._files.set("/source.txt", "content");
      fs.writeFileSync = () => {
        throw new Error("EIO");
      };
      const deps = makeDeps();
      const result = createTempFile(
        { initialContentPath: "/source.txt" },
        deps,
      );
      assert.equal(result, "/tmp/agent-js-test-uuid.txt");
    });
  });
});
