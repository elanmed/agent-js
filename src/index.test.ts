/* eslint-disable @typescript-eslint/no-floating-promises, @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-function */
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import {
  calculateSessionCost,
  main,
  type Client,
  type FinalMessage,
  type Rl,
  type TokenUsage,
} from "./index.ts";
import { resetState, selectors } from "./state.ts";

const noUsages: TokenUsage[] = [];

describe("calculateSessionCost", () => {
  it("unknown model returns 'Session cost: unknown'", () => {
    const result = calculateSessionCost("claude-3-5-haiku-20241022", noUsages);
    assert.equal(result, "Session cost: unknown");
  });

  it("known model with no usages returns $0.0000", () => {
    const result = calculateSessionCost("claude-haiku-4-5", noUsages);
    assert.equal(result, "Session cost: $0.0000");
  });

  it("calculates input and output token costs correctly", () => {
    // haiku: input=$1/M, output=$5/M
    // 1_000_000 input + 1_000_000 output = $1 + $5 = $6.0000
    const result = calculateSessionCost("claude-haiku-4-5", [
      { input_tokens: 1_000_000, output_tokens: 1_000_000 },
    ]);
    assert.equal(result, "Session cost: $6.0000");
  });

  it("calculates cache creation token cost", () => {
    // haiku: cacheWrite5m=$1.25/M
    // 1_000_000 cache_creation = $1.25
    const result = calculateSessionCost("claude-haiku-4-5", [
      {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 1_000_000,
      },
    ]);
    assert.equal(result, "Session cost: $1.2500");
  });

  it("calculates cache read token cost", () => {
    // haiku: cacheRead=$0.10/M
    // 1_000_000 cache_read = $0.10
    const result = calculateSessionCost("claude-haiku-4-5", [
      { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 },
    ]);
    assert.equal(result, "Session cost: $0.1000");
  });

  it("accumulates costs across multiple usages", () => {
    // haiku: input=$1/M, output=$5/M
    // usage1: 500_000 input + 200_000 output = $0.50 + $1.00 = $1.50
    // usage2: 500_000 input + 300_000 output = $0.50 + $1.50 = $2.00
    // total = $3.50
    const result = calculateSessionCost("claude-haiku-4-5", [
      { input_tokens: 500_000, output_tokens: 200_000 },
      { input_tokens: 500_000, output_tokens: 300_000 },
    ]);
    assert.equal(result, "Session cost: $3.5000");
  });
});

function makeAbortError(): Error {
  const err = new Error("aborted");
  err.name = "AbortError";
  return err;
}

type MockRl = Rl & { assertExhausted(): void };

function makeMockRl(...responses: (string | Error)[]): MockRl {
  let i = 0;
  return {
    on(_event: string, _handler: () => void) {},
    question(_prompt: string, _opts: { signal: AbortSignal }): Promise<string> {
      const resp = responses[i++];
      if (resp instanceof Error) {
        return Promise.reject(resp);
      }
      if (resp === undefined) {
        return Promise.reject(new Error("mock rl exhausted"));
      }
      return Promise.resolve(resp);
    },
    close() {},
    assertExhausted() {
      assert.equal(
        i,
        responses.length,
        `rl: expected ${String(responses.length)} responses consumed, got ${String(i)}`,
      );
    },
  };
}

function makeMockClient(...responses: (FinalMessage | Error)[]): Client {
  let i = 0;
  return {
    messages: {
      stream(_params) {
        const resp = responses[i++];
        const stream: ReturnType<Client["messages"]["stream"]> = {
          on(_event, _handler) {
            return stream;
          },
          finalMessage(): Promise<FinalMessage> {
            if (resp === undefined) {
              return Promise.reject(new Error("mock client exhausted"));
            }
            if (resp instanceof Error) {
              return Promise.reject(resp);
            }
            return Promise.resolve(resp);
          },
          abort() {},
        };
        return stream;
      },
    },
  };
}

describe("main", () => {
  beforeEach(() => {
    resetState();
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it("exits when SIGINT is followed by 'yes'", async () => {
    mock.method(console, "log", () => {});
    const rl = makeMockRl(makeAbortError(), "yes");
    await main(rl, makeMockClient());
    rl.assertExhausted();
  });

  it("exits when SIGINT is followed by 'y'", async () => {
    mock.method(console, "log", () => {});
    const rl = makeMockRl(makeAbortError(), "y");
    await main(rl, makeMockClient());
    rl.assertExhausted();
  });

  it("does not exit on non-yes answer, exits on subsequent SIGINT + yes", async () => {
    mock.method(console, "log", () => {});
    const rl = makeMockRl(makeAbortError(), "n", makeAbortError(), "yes");
    await main(rl, makeMockClient());
    rl.assertExhausted();
  });

  it("skips empty input and logs a message", async () => {
    const logMock = mock.method(console, "log", () => {});
    const rl = makeMockRl("", makeAbortError(), "yes");
    await main(rl, makeMockClient());
    rl.assertExhausted();
    assert.deepEqual(
      logMock.mock.calls.map((c): unknown => c.arguments[0]),
      ["Empty input, aborting"],
    );
  });

  it("sends message to API and records response in state", async () => {
    mock.method(console, "log", () => {});
    const message: FinalMessage = {
      role: "assistant",
      content: [],
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_creation: null,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        inference_geo: null,
        server_tool_use: null,
        service_tier: null,
      },
    };
    const rl = makeMockRl("hello", makeAbortError(), "yes");
    await main(rl, makeMockClient(message));
    rl.assertExhausted();
    assert.equal(selectors.getMessageParams().length, 2);
    assert.equal(selectors.getMessageUsages().length, 1);
  });

  it("pops user message when API stream is aborted", async () => {
    mock.method(console, "log", () => {});
    const rl = makeMockRl("hello", makeAbortError(), "yes");
    await main(rl, makeMockClient(new Anthropic.APIUserAbortError()));
    rl.assertExhausted();
    assert.deepEqual(selectors.getMessageParams(), []);
  });
});
