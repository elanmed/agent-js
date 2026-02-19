/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isAbortError, tryCatch } from "./utils.ts";

describe("utils", () => {
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
    it("returns {ok: true, value} for a resolved promise", async () => {
      const result = await tryCatch(Promise.resolve(42));
      assert.deepEqual(result, { ok: true, value: 42 });
    });

    it("returns {ok: false, error} for a rejected promise", async () => {
      const err = new Error("boom");
      const result = await tryCatch(Promise.reject(err));
      assert.deepEqual(result, { ok: false, error: err });
    });
  });
});
