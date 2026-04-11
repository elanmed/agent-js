import { tool } from "ai";
import fs from "node:fs";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import {
  colorLog,
  createTempFile,
  debugLog,
  execGitDiff,
  getMessageFromError,
  logNewline,
  normalizeLine,
  tryCatch,
  tryCatchAsync,
} from "./utils.ts";
import { selectors } from "./state.ts";

const execPromise = promisify(exec);

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResult {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

const BashToolInputSchema = z.object({ command: z.string() });

export async function executeBashTool(toolCall: ToolCall): Promise<ToolResult> {
  const { command: bashCommand } = BashToolInputSchema.parse(toolCall.input);
  colorLog(`bash: ${bashCommand}`, "grey");
  debugLog(`executeBashTool: command=${bashCommand}`);

  const bashResult = await tryCatchAsync(execPromise(bashCommand));

  if (bashResult.ok) {
    debugLog(
      `executeBashTool: stdout=${bashResult.value.stdout}, stderr=${bashResult.value.stderr}`,
    );
    return {
      type: "tool_result",
      tool_use_id: toolCall.id,
      content: JSON.stringify({
        stdout: bashResult.value.stdout,
        stderr: bashResult.value.stderr,
      }),
    };
  }

  const error = getMessageFromError(bashResult.error);
  debugLog(`executeBashTool: error=${error}`);
  return {
    type: "tool_result",
    tool_use_id: toolCall.id,
    content: error,
    is_error: true,
  };
}

const CreateFileToolSchema = z.object({
  path: z.string(),
  content: z.string(),
});

export function executeCreateFileTool(toolCall: ToolCall): ToolResult {
  const { content, path } = CreateFileToolSchema.parse(toolCall.input);
  if (fs.existsSync(path)) {
    debugLog(`executeCreatefileTool: ${path} already exists`);
    return {
      type: "tool_result",
      tool_use_id: toolCall.id,
      content: `${path} already exists`,
      is_error: true,
    };
  }

  const createFileResult = tryCatch(() => {
    fs.writeFileSync(path, content);
  });

  if (!createFileResult.ok) {
    const error = getMessageFromError(createFileResult.error);
    debugLog(`executeCreateFileTool: error=${error}`);
    return {
      type: "tool_result",
      tool_use_id: toolCall.id,
      content: error,
      is_error: true,
    };
  }

  debugLog(`executeCreateFileTool: ${path} created successfully `);
  return {
    type: "tool_result",
    tool_use_id: toolCall.id,
    content: `${path} created successfully`,
  };
}

const ViewFileToolInputSchema = z.object({
  path: z.string(),
  start_line: z.number().int().optional(),
  end_line: z.number().int().optional(),
});

export function executeViewFileTool(toolCall: ToolCall): ToolResult {
  const { path, start_line, end_line } = ViewFileToolInputSchema.parse(
    toolCall.input,
  );
  colorLog(`view_file: ${path}`, "grey");
  debugLog(`executeViewFileTool: path=${path}`);

  const statResult = tryCatch(() => fs.statSync(path));
  if (!statResult.ok) {
    const error = getMessageFromError(statResult.error);
    debugLog(`executeViewFileTool: error=${error}`);
    return {
      type: "tool_result",
      tool_use_id: toolCall.id,
      content: error,
      is_error: true,
    };
  }

  if (statResult.value.isDirectory()) {
    const readdirResult = tryCatch(() => fs.readdirSync(path));
    if (!readdirResult.ok) {
      const error = getMessageFromError(readdirResult.error);
      debugLog(`executeViewFileTool: error=${error}`);
      return {
        type: "tool_result",
        tool_use_id: toolCall.id,
        content: error,
        is_error: true,
      };
    }
    const listing = readdirResult.value.join("\n");
    debugLog(`executeViewFileTool: directory listing for ${path}`);
    return {
      type: "tool_result",
      tool_use_id: toolCall.id,
      content: listing,
    };
  }

  const readResult = tryCatch(() => fs.readFileSync(path));
  if (!readResult.ok) {
    const error = getMessageFromError(readResult.error);
    debugLog(`executeViewFileTool: error=${error}`);
    return {
      type: "tool_result",
      tool_use_id: toolCall.id,
      content: error,
      is_error: true,
    };
  }

  const lines = readResult.value.toString().split("\n");
  const start = (start_line ?? 1) - 1;
  const end =
    end_line === undefined || end_line === -1 ? lines.length : end_line;
  const slice = lines.slice(start, end);
  const numbered = slice
    .map((line, i) => `${String(start + i + 1)}\t${line}`)
    .join("\n");

  debugLog(
    `executeViewFileTool: ${path} lines ${String(start + 1)}-${String(end)}`,
  );
  return {
    type: "tool_result",
    tool_use_id: toolCall.id,
    content: numbered,
  };
}

const StrReplaceToolInputSchema = z.object({
  path: z.string(),
  old_str: z.string(),
  new_str: z.string(),
});

export function executeStrReplaceTool(toolCall: ToolCall): ToolResult {
  const { path, old_str, new_str } = StrReplaceToolInputSchema.parse(
    toolCall.input,
  );
  colorLog(`str_replace: ${path}`, "grey");
  debugLog(`executeStrReplaceTool: path=${path}`);

  const readResult = tryCatch(() => fs.readFileSync(path));
  if (!readResult.ok) {
    const error = getMessageFromError(readResult.error);
    debugLog(`executeStrReplaceTool: error=${error}`);
    return {
      type: "tool_result",
      tool_use_id: toolCall.id,
      content: error,
      is_error: true,
    };
  }

  const content = readResult.value.toString();
  const occurrences = content.split(old_str).length - 1;

  if (occurrences === 0) {
    debugLog(`executeStrReplaceTool: old_str not found in ${path}`);
    return {
      type: "tool_result",
      tool_use_id: toolCall.id,
      content: "old_str not found in file",
      is_error: true,
    };
  }

  if (occurrences > 1) {
    debugLog(
      `executeStrReplaceTool: old_str matched ${String(occurrences)} times in ${path}`,
    );
    return {
      type: "tool_result",
      tool_use_id: toolCall.id,
      content: `old_str matched ${String(occurrences)} times — must match exactly once`,
      is_error: true,
    };
  }

  const writeResult = tryCatch(() => {
    fs.writeFileSync(path, content.replace(old_str, new_str));
  });
  if (!writeResult.ok) {
    const error = getMessageFromError(writeResult.error);
    debugLog(`executeStrReplaceTool: error=${error}`);
    return {
      type: "tool_result",
      tool_use_id: toolCall.id,
      content: error,
      is_error: true,
    };
  }

  debugLog(`executeStrReplaceTool: ${path} updated successfully`);
  return {
    type: "tool_result",
    tool_use_id: toolCall.id,
    content: `${path} updated successfully`,
  };
}

const InsertLinesToolInputSchema = z.object({
  path: z.string(),
  after_line: z.number().int(),
  content: z.string(),
});

export const TOOLS = {
  bash: tool({
    description: "Execute a bash command and return its output.",
    inputSchema: BashToolInputSchema,
  }),
  create_file: tool({
    description:
      "Create a new file with the given content. Fails if the file already exists.",
    inputSchema: CreateFileToolSchema,
  }),
  view_file: tool({
    description:
      "View the contents of a file or list a directory. File contents are returned with line numbers.",
    inputSchema: ViewFileToolInputSchema,
  }),
  str_replace: tool({
    description:
      "Replace an exact string in a file. The old_str must match exactly once. Include enough surrounding lines to make the match unique.",
    inputSchema: StrReplaceToolInputSchema,
  }),
  insert_lines: tool({
    description:
      "Insert text after a specific line number in a file. Use line 0 to insert at the beginning of the file.",
    inputSchema: InsertLinesToolInputSchema,
  }),
};

export function executeInsertLinesTool(toolCall: ToolCall): ToolResult {
  const { path, after_line, content } = InsertLinesToolInputSchema.parse(
    toolCall.input,
  );
  colorLog(`insert_lines: ${path}`, "grey");
  debugLog(
    `executeInsertLinesTool: path=${path}, after_line=${String(after_line)}`,
  );

  const readResult = tryCatch(() => fs.readFileSync(path));
  if (!readResult.ok) {
    const error = getMessageFromError(readResult.error);
    debugLog(`executeInsertLinesTool: error=${error}`);
    return {
      type: "tool_result",
      tool_use_id: toolCall.id,
      content: error,
      is_error: true,
    };
  }

  const lines = readResult.value.toString().split("\n");

  if (after_line < 0 || after_line > lines.length) {
    debugLog(
      `executeInsertLinesTool: after_line ${String(after_line)} out of range`,
    );
    return {
      type: "tool_result",
      tool_use_id: toolCall.id,
      content: `after_line ${String(after_line)} is out of range (file has ${String(lines.length)} lines)`,
      is_error: true,
    };
  }

  lines.splice(after_line, 0, content);

  const writeResult = tryCatch(() => {
    fs.writeFileSync(path, lines.join("\n"));
  });
  if (!writeResult.ok) {
    const error = getMessageFromError(writeResult.error);
    debugLog(`executeInsertLinesTool: error=${error}`);
    return {
      type: "tool_result",
      tool_use_id: toolCall.id,
      content: error,
      is_error: true,
    };
  }

  debugLog(`executeInsertLinesTool: ${path} updated successfully`);
  return {
    type: "tool_result",
    tool_use_id: toolCall.id,
    content: `${path} updated successfully`,
  };
}

async function printGitDiff(pathBefore: string, pathAfter: string) {
  const diffArgs =
    selectors.getDiffStyle() === "lines"
      ? `--no-index --color=always ${pathBefore} ${pathAfter}`
      : `--no-index --color=always --stat ${pathBefore} ${pathAfter}`;

  const diffResult = await tryCatchAsync(execGitDiff(diffArgs));
  if (diffResult.ok && diffResult.value.stdout) {
    logNewline();
    colorLog("diff start", "grey");
    process.stdout.write(normalizeLine(diffResult.value.stdout));
    colorLog("diff end", "grey");
    logNewline();
  }
}

export async function getToolResultBlock(toolCall: ToolCall) {
  let toolResult: ToolResult | null = null;

  switch (toolCall.name) {
    case "bash": {
      toolResult = await executeBashTool(toolCall);
      break;
    }
    case "create_file": {
      toolResult = executeCreateFileTool(toolCall);
      break;
    }
    case "view_file": {
      toolResult = executeViewFileTool(toolCall);
      break;
    }
    case "str_replace": {
      const { path } = StrReplaceToolInputSchema.parse(toolCall.input);
      const tempFileBefore = createTempFile(path);
      toolResult = executeStrReplaceTool(toolCall);
      if (!toolResult.is_error) {
        const tempFileAfter = createTempFile(path);
        await printGitDiff(tempFileBefore, tempFileAfter);
        fs.unlinkSync(tempFileBefore);
        fs.unlinkSync(tempFileAfter);
      }
      break;
    }
    case "insert_lines": {
      const { path } = InsertLinesToolInputSchema.parse(toolCall.input);
      const tempFileBefore = createTempFile(path);
      toolResult = executeInsertLinesTool(toolCall);
      if (!toolResult.is_error) {
        const tempFileAfter = createTempFile(path);
        await printGitDiff(tempFileBefore, tempFileAfter);
        fs.unlinkSync(tempFileBefore);
        fs.unlinkSync(tempFileAfter);
      }
      break;
    }
  }

  if (!toolResult) {
    throw new Error(
      "Failed to create a tool result when processing the tool call",
    );
  }

  return toolResult;
}

