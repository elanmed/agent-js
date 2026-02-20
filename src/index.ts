import * as readline from "node:readline/promises";
import { exec } from "node:child_process";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { MessageStream } from "@anthropic-ai/sdk/lib/MessageStream";
import { actions, dispatch, selectors } from "./state.ts";
import { isAbortError, tryCatch, colorLog, logNewline } from "./utils.ts";

// TODO: support config file
const MODEL: Anthropic.Messages.Model = "claude-haiku-4-5";

const BASH_TOOL_SCHEMA: Anthropic.Messages.Tool = {
  name: "bash",
  description: "Execute a bash command and return its output.",
  input_schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The bash command to execute.",
      },
    },
    required: ["command"],
  },
};

async function main() {
  const client = new Anthropic();
  const rl = readline.createInterface({ input, output });

  let currQuestionAbortController: AbortController | null = null;
  let currApiStream: MessageStream | null = null;

  async function callApi(messageParam: Anthropic.Messages.MessageParam) {
    dispatch(actions.appendToMessageParams(messageParam));

    currApiStream = client.messages
      .stream({
        max_tokens: 1024,
        model: MODEL,
        messages: selectors.getMessageParams(),
        tools: [BASH_TOOL_SCHEMA],
        system:
          "You are an AI agent being called from a minimal terminal cli. All your responses will be output directly to the terminal without any alteration. Keep your responses brief as to not pollute the terminal.",
      })
      .on("text", (text) => {
        process.stdout.write(text);
      });
    const streamResult = await currApiStream.finalMessage();
    currApiStream = null;

    dispatch(actions.appendToMessageUsages(streamResult.usage));
    dispatch(
      actions.appendToMessageParams({
        content: streamResult.content,
        role: streamResult.role,
      }),
    );
    return streamResult;
  }

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
        rl.question("y(es) or <C-c> to exit: ", {
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
    logNewline();

    if (inputResult.value === "") {
      colorLog("Empty input, aborting", "red");
      continue;
    }

    const streamResult = await tryCatch(
      callApi({
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

    if (!streamResult.ok) {
      if (streamResult.error instanceof Anthropic.APIUserAbortError) {
        dispatch(actions.popLastMessageParam());
        logNewline();
        colorLog("Aborted", "red");
        logNewline();
        continue;
      }
      throw streamResult.error;
    }

    let stopReason = streamResult.value.stop_reason;
    while (stopReason === "tool_use") {
      const toolUseBlock = streamResult.value.content.find(
        (contentBlock) => contentBlock.type === "tool_use",
      );
      if (!toolUseBlock) {
        throw new Error(
          "`stop_reason` was `tool_use` but could not find a content block with a type of `tool_use`",
        );
      }

      let messageParam: Anthropic.Messages.MessageParam | null = null;

      switch (toolUseBlock.name) {
        case "bash": {
          const toolResult = await tryCatch(executeBashTool(toolUseBlock));
          if (toolResult.ok) {
            messageParam = {
              content: [
                {
                  type: "tool_result",
                  tool_use_id: toolUseBlock.id,
                  cache_control: { type: "ephemeral" },
                  content: JSON.stringify(toolResult.value),
                },
              ],
              role: "user",
            };
          } else {
            messageParam = {
              content: [
                {
                  type: "tool_result",
                  tool_use_id: toolUseBlock.id,
                  cache_control: { type: "ephemeral" },
                  content: JSON.stringify(toolResult.error),
                  is_error: true,
                },
              ],
              role: "user",
            };
          }
        }
      }

      if (!messageParam) {
        throw new Error(
          "Failed to create a `messageParam` when processing the tool call",
        );
      }

      const toolStreamResult = await tryCatch(callApi(messageParam));

      if (!toolStreamResult.ok) {
        if (toolStreamResult.error instanceof Anthropic.APIUserAbortError) {
          dispatch(actions.popLastMessageParam());
          logNewline();
          colorLog("Aborted", "red");
          logNewline();
          break;
        }
        throw toolStreamResult.error;
      }
      stopReason = toolStreamResult.value.stop_reason;
    }

    logNewline();
    colorLog(
      calculateSessionCost(MODEL, selectors.getMessageUsages()),
      "green",
    );
  }
}

interface ModelPricing {
  inputPerToken: number;
  outputPerToken: number;
  cacheWrite5mPerToken: number;
  cacheWrite1hPerToken: number;
  cacheReadPerToken: number;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export function calculateSessionCost(
  model: string,
  usages: TokenUsage[],
): string {
  const DOLLARS_PER_MILLION = 1_000_000;

  const pricingPerModel: Partial<Record<string, ModelPricing>> = {
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

  const pricing = pricingPerModel[model];
  if (pricing === undefined) {
    return "Session cost: unknown";
  }

  const {
    cacheReadPerToken,
    cacheWrite5mPerToken,
    inputPerToken,
    outputPerToken,
  } = pricing;

  const totalUsage = usages.reduce<{
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    input_tokens: number;
    output_tokens: number;
  }>(
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
  return `Session cost: $${cost.toFixed(4)}`;
}

async function executeBashTool(toolUseBlock: Anthropic.Messages.ToolUseBlock) {
  if (typeof toolUseBlock.input !== "object") {
    throw new Error("Expected `toolUseBlock.input` to be an object");
  }
  if (toolUseBlock.input === null) {
    throw new Error("Expected `toolUseBlock.input` to be an object");
  }
  if (!("command" in toolUseBlock.input)) {
    throw new Error("Expected `toolUseBlock.input.command` to be a valid key");
  }
  if (typeof toolUseBlock.input.command !== "string") {
    throw new Error("Expected `toolUseBlock.input.command` to be a string");
  }

  const bashCommand = toolUseBlock.input.command;
  colorLog(`Executing bash tool: ${bashCommand}`, "grey");
  logNewline();

  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    exec(bashCommand, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(error.message));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(0);
  });
}
