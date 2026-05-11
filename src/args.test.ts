import { describe, it, mock } from "node:test";
import assert from "node:assert";
import { parseCliArgs, parseCliArgsDeps } from "./args.ts";

describe("args", () => {
  it("returns default args when no arguments are provided", () => {
    mock.method(parseCliArgsDeps, "getArgv", () => ["node", "script.js"]);
    const result = parseCliArgs();
    assert.deepStrictEqual(result, { debug: false, resumeSessionId: null });
  });

  it("sets debug to true when --debug argument is provided", () => {
    mock.method(parseCliArgsDeps, "getArgv", () => [
      "node",
      "script.js",
      "--debug",
    ]);
    const result = parseCliArgs();
    assert.deepStrictEqual(result, { debug: true, resumeSessionId: null });
  });

  it("sets resumeSessionId when --resume=sessionId is provided", () => {
    mock.method(parseCliArgsDeps, "getArgv", () => [
      "node",
      "script.js",
      "--resume=abc123",
    ]);
    const result = parseCliArgs();
    assert.deepStrictEqual(result, { debug: false, resumeSessionId: "abc123" });
  });

  it("sets both debug and resume when both arguments are provided", () => {
    mock.method(parseCliArgsDeps, "getArgv", () => [
      "node",
      "script.js",
      "--debug",
      "--resume=abc123",
    ]);
    const result = parseCliArgs();
    assert.deepStrictEqual(result, { debug: true, resumeSessionId: "abc123" });
  });

  it("throws on unknown argument", () => {
    mock.method(parseCliArgsDeps, "getArgv", () => [
      "node",
      "script.js",
      "--unknown",
    ]);
    assert.throws(() => parseCliArgs(), /Usage/);
  });

  it("throws on --resume argument without session id", () => {
    mock.method(parseCliArgsDeps, "getArgv", () => [
      "node",
      "script.js",
      "--resume",
    ]);
    assert.throws(() => parseCliArgs(), /Usage/);
  });
});
