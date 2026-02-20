import type Anthropic from "@anthropic-ai/sdk";
import { colorLog, tryCatch } from "./utils.ts";
import { exec } from "node:child_process";

export const BASH_TOOL_SCHEMA: Anthropic.Messages.Tool = {
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

export async function executeBashTool(
  toolUseBlock: Anthropic.Messages.ToolUseBlock,
) {
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

export async function getBashToolResultBlockParam(
  toolUseBlock: Anthropic.Messages.ToolUseBlock,
) {
  const bashResult = await tryCatch(executeBashTool(toolUseBlock));
  if (bashResult.ok) {
    const toolResultBlock: Anthropic.Messages.ToolResultBlockParam = {
      type: "tool_result",
      tool_use_id: toolUseBlock.id,
      content: JSON.stringify(bashResult.value),
    };
    return toolResultBlock;
  }

  const toolResultBlock: Anthropic.Messages.ToolResultBlockParam = {
    type: "tool_result",
    tool_use_id: toolUseBlock.id,
    content: JSON.stringify(bashResult.error),
    is_error: true,
  };
  return toolResultBlock;
}
