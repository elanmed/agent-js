import type { ModelMessage } from "ai";
import { generateText, isLoopFinished } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { actions, dispatch, selectors } from "./state.ts";
import {
  isAbortError,
  tryCatchAsync,
  getMessageFromError,
  createTempFile,
} from "./utils.ts";
import { print, startSpinner, stopSpinner } from "./print.ts";
import { BASE_SYSTEM_PROMPT } from "./context.ts";
import { debugLog } from "./log.ts";
import {
  objectWithPathSchema,
  printGitDiff,
  TOOLS,
  type ToolName,
} from "./tools.ts";
import assert from "node:assert";
import { fsDeps, processDeps } from "./deps.ts";

function getLanguageModel() {
  const apiKey = processDeps.env.get("AGENT_JS_API_KEY");

  if (selectors.getProvider() === "anthropic") {
    return createAnthropic({ ...(apiKey && { apiKey }) })(selectors.getModel());
  }

  const baseURL = selectors.getBaseURL();
  assert(baseURL !== null);

  return createOpenAICompatible({
    name: "openai-compatible",
    baseURL: baseURL,
    ...(apiKey && { apiKey }),
  })(selectors.getModel());
}

export async function resolveApiCall(userInput: string) {
  const inputMessageParam: ModelMessage = {
    role: "user",
    content: userInput,
  };

  const newMessageCount = 1;
  const messageCount = selectors.getMessageParams().length + newMessageCount;
  debugLog(
    `resolveApiCall: model=${selectors.getModel()}, messageCount=${String(messageCount)}`,
  );

  startSpinner();

  const systemContent = [
    BASE_SYSTEM_PROMPT,
    selectors.getContextStr(),
    selectors.getSkillsStr(),
  ].join("\n");

  dispatch(actions.setApiStreamAbortController(new AbortController()));
  const abortController = selectors.getApiStreamAbortController();
  assert(abortController !== null);

  let tempFileBefore: string | null = null;
  const generateTextResult = await tryCatchAsync(
    generateText({
      model: getLanguageModel(),
      system: systemContent,
      messages: [...selectors.getMessageParams(), inputMessageParam],
      tools: TOOLS,
      stopWhen: isLoopFinished(),
      abortSignal: abortController.signal,
      experimental_onToolCallStart: ({ toolCall }) => {
        switch (toolCall.toolName as ToolName) {
          case "insert_lines":
          case "str_replace": {
            const { path } = objectWithPathSchema.parse(toolCall.input);
            tempFileBefore = createTempFile({ initialContentPath: path });
            break;
          }
        }
      },
      experimental_onToolCallFinish: async ({ toolCall, success }) => {
        switch (toolCall.toolName as ToolName) {
          case "insert_lines":
          case "str_replace": {
            assert(tempFileBefore !== null);
            if (!success) {
              fsDeps.unlinkSync(tempFileBefore);
              tempFileBefore = null;
              return;
            }

            const { path } = objectWithPathSchema.parse(toolCall.input);
            const tempFileAfter = createTempFile({
              initialContentPath: path,
            });
            await printGitDiff({
              tempFileBeforePath: tempFileBefore,
              tempFileAfterPath: tempFileAfter,
              path,
            });
            fsDeps.unlinkSync(tempFileBefore);
            fsDeps.unlinkSync(tempFileAfter);
            tempFileBefore = null;
            break;
          }
        }
      },
    }),
  );

  stopSpinner();
  dispatch(actions.setApiStreamAbortController(null));

  if (!generateTextResult.ok) {
    if (isAbortError(generateTextResult.error)) {
      print.error("Aborted");
      return null;
    }

    print.error(getMessageFromError(generateTextResult.error));
    return null;
  }

  const { usage, text, response } = generateTextResult.value;

  dispatch(
    actions.appendToMessageUsages({
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cacheReadTokens: usage.inputTokenDetails.cacheReadTokens ?? 0,
      cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens ?? 0,
    }),
  );

  dispatch(actions.appendToMessageParams(inputMessageParam));
  for (const msg of response.messages) {
    dispatch(actions.appendToMessageParams(msg));
  }

  return text;
}
