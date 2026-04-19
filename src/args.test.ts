import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCliArgs, defaultCliArgs } from "./args.ts";
import type { ParseCliArgsDeps } from "./args.ts";

function makeDeps(argStrings: string[]): ParseCliArgsDeps {
  return {
    getArgv: () => ["node", "script.js", ...argStrings],
  };
}

describe("parseCliArgs", () => {
  it("returns default args when no arguments are provided", () => {
    const result = parseCliArgs(makeDeps([]));
    assert.deepEqual(result, defaultCliArgs);
  });

  it("sets debug to true when --debug argument is provided", () => {
    const result = parseCliArgs(makeDeps(["--debug"]));
    assert.equal(result.debug, true);
    assert.equal(result.resumeSessionId, null);
  });

  it("sets resumeSessionId when --resume=sessionId is provided", () => {
    const result = parseCliArgs(makeDeps(["--resume=abc123"]));
    assert.equal(result.debug, false);
    assert.equal(result.resumeSessionId, "abc123");
  });

  it("sets both debug and resume when both arguments are provided", () => {
    const result = parseCliArgs(makeDeps(["--debug", "--resume=abc123"]));
    assert.equal(result.debug, true);
    assert.equal(result.resumeSessionId, "abc123");
  });

  it("throws on unknown argument", () => {
    assert.throws(() => parseCliArgs(makeDeps(["--unknown"])), /Usage/);
  });

  it("throws on --resume argument without session id", () => {
    assert.throws(() => parseCliArgs(makeDeps(["--resume"])), /Usage/);
  });
});