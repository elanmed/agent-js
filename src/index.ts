import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import Anthropic from "@anthropic-ai/sdk";
import { actions, dispatch, selectors } from "./state.ts";

// TODO: support config file
const MODEL: Anthropic.Messages.Model = "claude-haiku-4-5";

async function main() {
  const client = new Anthropic();

  const rl = readline.createInterface({ input, output });

  let currentAbortController: AbortController | null = null;

  rl.on("SIGINT", () => {
    if (currentAbortController) {
      currentAbortController.abort();
    }

    // second <C-c> during exit confirmation
    if (selectors.getInterrupted()) {
      rl.close();
      printSessionCost();
      process.exit(0);
    }
  });

  while (selectors.getRunning()) {
    currentAbortController = new AbortController();
    try {
      const answer = await rl.question("> ", {
        signal: currentAbortController.signal,
      });
      dispatch(actions.appendToMessages({ content: answer, role: "user" }));

      const message = await client.messages.create({
        max_tokens: 1024,
        messages: selectors.getMessages(),
        model: MODEL,
      });

      dispatch(actions.setResponse(message));
      dispatch(
        actions.appendToMessages({
          content: message.content,
          role: message.role,
        }),
      );

      printFromMessageResponse(message);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        dispatch(actions.setInterrupted(true));
        currentAbortController = new AbortController();

        try {
          const exitAnswer = await rl.question(
            "Are you sure you want to exit? ",
            {
              signal: currentAbortController.signal,
            },
          );
          if (/^y(es)?$/i.exec(exitAnswer)) {
            dispatch(actions.setRunning(false));
            rl.close();
            printSessionCost();
          }
        } catch {
          // second <C-c> during confirmation is already handled by SIGINT
        }
        dispatch(actions.setInterrupted(false));
      } else {
        throw err;
      }
    } finally {
      currentAbortController = null;
    }
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
  const response = selectors.getResponse();
  if (response === undefined) {
    console.log("Session cost: $0.00");
    return;
  }

  const {
    cacheReadPerToken,
    cacheWrite5mPerToken,
    inputPerToken,
    outputPerToken,
  } = pricing;
  const { usage } = response;

  const inputCost = usage.input_tokens * inputPerToken;
  const outputCost = usage.output_tokens * outputPerToken;
  const cacheCreationCost =
    (usage.cache_creation_input_tokens ?? 0) * cacheWrite5mPerToken;
  const cacheReadCost =
    (usage.cache_read_input_tokens ?? 0) * cacheReadPerToken;

  const cost = inputCost + outputCost + cacheCreationCost + cacheReadCost;
  console.log(`Session cost: $${(cost * 100).toFixed(2)}`);
  return;
}

function printFromMessageResponse(message: Anthropic.Messages.Message) {
  message.content.forEach((message) => {
    switch (message.type) {
      case "text": {
        const prettyMessage = `Text response: ${message.text}`;
        console.log(prettyMessage);
        break;
      }
      default: {
        console.log(JSON.stringify(message, null, 2));
      }
    }
  });
}

main().catch(() => process.exit(0));
