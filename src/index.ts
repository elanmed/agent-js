import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import Anthropic from "@anthropic-ai/sdk";
import { MessageStream } from "@anthropic-ai/sdk/lib/MessageStream";
import { actions, dispatch, selectors } from "./state.ts";

type Result<T> = { ok: true; value: T } | { ok: false; error: unknown };

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function tryCatch<T>(promise: Promise<T>): Promise<Result<T>> {
  try {
    const result = await promise;
    return { ok: true, value: result };
  } catch (err) {
    return { ok: false, error: err };
  }
}

// TODO: support config file
const MODEL: Anthropic.Messages.Model = "claude-haiku-4-5";

async function main() {
  const client = new Anthropic();

  const rl = readline.createInterface({ input, output });

  let currQuestionAbortController: AbortController | null = null;
  let currApiStream: MessageStream | null;

  rl.on("SIGINT", () => {
    if (currApiStream) {
      currApiStream.abort();
    }

    if (currQuestionAbortController) {
      currQuestionAbortController.abort();
    }

    // second <C-c> during exit confirmation
    if (selectors.getInterrupted()) {
      rl.close();
      process.exit(0);
    }
  });

  while (selectors.getRunning()) {
    currQuestionAbortController = new AbortController();
    const inputResult = await tryCatch(
      rl.question("> ", { signal: currQuestionAbortController.signal }),
    );
    currQuestionAbortController = null;

    if (!inputResult.ok) {
      if (!isAbortError(inputResult.error)) throw inputResult.error;

      dispatch(actions.setInterrupted(true));
      currQuestionAbortController = new AbortController();
      const exitResult = await tryCatch(
        rl.question("y(es) or <C-c> to exit ", {
          signal: currQuestionAbortController.signal,
        }),
      );
      currQuestionAbortController = null;

      if (exitResult.ok) {
        if (/^y(es)?$/i.exec(exitResult.value)) {
          dispatch(actions.setRunning(false));
          rl.close();
        }
      } else {
        // second <C-c> during confirmation is already handled by SIGINT
      }

      dispatch(actions.setInterrupted(false));
      continue;
    }

    if (inputResult.value === "") {
      console.log("Empty input, aborting");
      continue;
    }

    dispatch(
      actions.appendToMessageParams({
        content: [
          {
            text: inputResult.value,
            type: "text",
            cache_control: { type: "ephemeral" },
          },
        ],
        role: "user",
      }),
    );

    currApiStream = client.messages
      .stream({
        max_tokens: 1024,
        model: MODEL,
        messages: selectors.getMessageParams(),
      })
      .on("text", (text) => {
        process.stdout.write(text);
      });
    const streamResult = await tryCatch(currApiStream.finalMessage());
    currApiStream = null;

    if (!streamResult.ok) {
      if (streamResult.error instanceof Anthropic.APIUserAbortError) {
        console.log("\nAborted\n");
        continue;
      }
      throw streamResult.error;
    }

    process.stdout.write("\n\n");

    dispatch(actions.appendToMessageUsages(streamResult.value.usage));
    dispatch(
      actions.appendToMessageParams({
        content: streamResult.value.content,
        role: streamResult.value.role,
      }),
    );
    printSessionCost();
  }
}

interface ModelPricing {
  inputPerToken: number;
  outputPerToken: number;
  cacheWrite5mPerToken: number;
  cacheWrite1hPerToken: number;
  cacheReadPerToken: number;
}

function printSessionCost() {
  const DOLLARS_PER_MILLION = 1_000_000;

  const pricingPerModel: Partial<
    Record<Anthropic.Messages.Model, ModelPricing>
  > = {
    "claude-opus-4-6": {
      inputPerToken: 5 / DOLLARS_PER_MILLION,
      cacheWrite5mPerToken: 6.25 / DOLLARS_PER_MILLION,
      cacheWrite1hPerToken: 10 / DOLLARS_PER_MILLION,
      cacheReadPerToken: 0.5 / DOLLARS_PER_MILLION,
      outputPerToken: 25 / DOLLARS_PER_MILLION,
    },
    "claude-sonnet-4-6": {
      inputPerToken: 3 / DOLLARS_PER_MILLION,
      cacheWrite5mPerToken: 3.75 / DOLLARS_PER_MILLION,
      cacheWrite1hPerToken: 6 / DOLLARS_PER_MILLION,
      cacheReadPerToken: 0.3 / DOLLARS_PER_MILLION,
      outputPerToken: 15 / DOLLARS_PER_MILLION,
    },
    "claude-haiku-4-5": {
      inputPerToken: 1 / DOLLARS_PER_MILLION,
      cacheWrite5mPerToken: 1.25 / DOLLARS_PER_MILLION,
      cacheWrite1hPerToken: 2 / DOLLARS_PER_MILLION,
      cacheReadPerToken: 0.1 / DOLLARS_PER_MILLION,
      outputPerToken: 5 / DOLLARS_PER_MILLION,
    },
  };

  const pricing = pricingPerModel[MODEL];
  if (pricing === undefined) {
    console.log("Session cost: unknown");
    return;
  }
  const usages = selectors.getMessageUsages();

  const {
    cacheReadPerToken,
    cacheWrite5mPerToken,
    inputPerToken,
    outputPerToken,
  } = pricing;

  const totalUsage = usages.reduce(
    (accum, curr) => {
      return {
        cache_creation_input_tokens:
          accum.cache_creation_input_tokens +
          (curr.cache_creation_input_tokens ?? 0),
        cache_read_input_tokens:
          accum.cache_read_input_tokens + (curr.cache_read_input_tokens ?? 0),
        input_tokens: accum.input_tokens + curr.input_tokens,
        output_tokens: accum.output_tokens + curr.output_tokens,
      };
    },
    {
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      input_tokens: 0,
      output_tokens: 0,
    },
  );

  const inputCost = totalUsage.input_tokens * inputPerToken;
  const outputCost = totalUsage.output_tokens * outputPerToken;
  const cacheCreationCost =
    totalUsage.cache_creation_input_tokens * cacheWrite5mPerToken;
  const cacheReadCost = totalUsage.cache_read_input_tokens * cacheReadPerToken;

  const cost = inputCost + outputCost + cacheCreationCost + cacheReadCost;
  console.log(`Session cost: $${cost.toFixed(4)}`);
  return;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(0);
});
