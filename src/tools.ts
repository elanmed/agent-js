import type Anthropic from "@anthropic-ai/sdk";
import { colorLog, logNewline, tryCatch } from "./utils";
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

export async function getBashToolMessageParam(
  toolUseBlock: Anthropic.Messages.ToolUseBlock,
) {
  const toolResult = await tryCatch(executeBashTool(toolUseBlock));
  if (toolResult.ok) {
    const messageParam: Anthropic.Messages.MessageParam = {
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
    return messageParam;
  }

  const messageParam: Anthropic.Messages.MessageParam = {
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
  return messageParam;
}
