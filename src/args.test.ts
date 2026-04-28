import { describe, it } from "node:test";
import assert from "node:assert";
import { parseCliArgs } from "./args.ts";
import type { ParseCliArgsDeps } from "./args.ts";

function makeDeps(argStrings: string[]): ParseCliArgsDeps {
  return {
    getArgv: () => ["node", "script.js", ...argStrings],
  };
}

describe("parseCliArgs", () => {
  it("returns default args when no arguments are provided", () => {
    const result = parseCliArgs(makeDeps([]));
    assert.deepStrictEqual(result, { debug: false, resumeSessionId: null });
  });

  it("sets debug to true when --debug argument is provided", () => {
    const result = parseCliArgs(makeDeps(["--debug"]));
    assert.deepStrictEqual(result, { debug: true, resumeSessionId: null });
  });

  it("sets resumeSessionId when --resume=sessionId is provided", () => {
    const result = parseCliArgs(makeDeps(["--resume=abc123"]));
    assert.deepStrictEqual(result, { debug: false, resumeSessionId: "abc123" });
  });

  it("sets both debug and resume when both arguments are provided", () => {
    const result = parseCliArgs(makeDeps(["--debug", "--resume=abc123"]));
    assert.deepStrictEqual(result, { debug: true, resumeSessionId: "abc123" });
  });

  it("throws on unknown argument", () => {
    assert.throws(() => parseCliArgs(makeDeps(["--unknown"])), /Usage/);
  });

  it("throws on --resume argument without session id", () => {
    assert.throws(() => parseCliArgs(makeDeps(["--resume"])), /Usage/);
  });
});
