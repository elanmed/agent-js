import { tool } from "ai";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import {
  colorPrint,
  createTempFile,
  execGitDiff,
  fencePrint,
  getMessageFromError,
  printNewline,
  normalizeLine,
  stringify,
  tryCatch,
  tryCatchAsync,
} from "./utils.ts";
import type { ColorPrint } from "./utils.ts";
import { debugLog } from "./log.ts";
import { selectors } from "./state.ts";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { fsDeps } from "./fs-deps.ts";

const execPromise = promisify(exec);
const userAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface ToolLogDeps {
  colorPrint: ColorPrint;
}

const toolLogDeps: ToolLogDeps = {
  colorPrint,
};

function toolLog(
  label: string,
  detail: string,
  deps: ToolLogDeps = toolLogDeps,
) {
  deps.colorPrint(`${label}: ${detail}`, "blue");
}

export type ToolLog = typeof toolLog;

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

const executeBashToolDeps = {
  exec: (cmd: string) => execPromise(cmd),
  debugLog,
  toolLog,
};

type ExecuteBashToolDeps = typeof executeBashToolDeps;

const BashToolInputSchema = z.object({ command: z.string() });

export async function executeBashTool(
  toolCall: ToolCall,
  deps: ExecuteBashToolDeps = executeBashToolDeps,
): Promise<ToolResult> {
  const { command: bashCommand } = BashToolInputSchema.parse(toolCall.input);
  deps.toolLog("bash", bashCommand);
  deps.debugLog(`executeBashTool: command=${bashCommand}`);

  const bashResult = await tryCatchAsync(deps.exec(bashCommand));

  if (bashResult.ok) {
    deps.debugLog(
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
  deps.debugLog(`executeBashTool: error=${error}`);
  return {
    type: "tool_result",
    tool_use_id: toolCall.id,
    content: error,
    is_error: true,
  };
}

const executeCreateFileToolDeps = {
  fs: fsDeps,
  debugLog,
  toolLog,
};

type ExecuteCreateFileToolDeps = typeof executeCreateFileToolDeps;

const CreateFileToolSchema = z.object({
  path: z.string(),
  content: z.string(),
});

export function executeCreateFileTool(
  toolCall: ToolCall,
  deps: ExecuteCreateFileToolDeps = executeCreateFileToolDeps,
): ToolResult {
  const { content, path } = CreateFileToolSchema.parse(toolCall.input);
  if (deps.fs.existsSync(path)) {
    deps.debugLog(`executeCreatefileTool: ${path} already exists`);
    return {
      type: "tool_result",
      tool_use_id: toolCall.id,
      content: `${path} already exists`,
      is_error: true,
    };
  }

  const createFileResult = tryCatch(() => deps.fs.writeFileSync(path, content));

  if (!createFileResult.ok) {
    const error = getMessageFromError(createFileResult.error);
    deps.debugLog(`executeCreateFileTool: error=${error}`);
    return {
      type: "tool_result",
      tool_use_id: toolCall.id,
      content: error,
      is_error: true,
    };
  }

  deps.debugLog(`executeCreateFileTool: ${path} created successfully `);
  return {
    type: "tool_result",
    tool_use_id: toolCall.id,
    content: `${path} created successfully`,
  };
}

const executeViewFileToolDeps = {
  fs: fsDeps,
  debugLog,
  toolLog,
};

type ExecuteViewFileToolDeps = typeof executeViewFileToolDeps;

const ViewFileToolInputSchema = z.object({
  path: z.string(),
  start_line: z.number().int().optional(),
  end_line: z.number().int().optional(),
});

export function executeViewFileTool(
  toolCall: ToolCall,
  deps: ExecuteViewFileToolDeps = executeViewFileToolDeps,
): ToolResult {
  const { path, start_line, end_line } = ViewFileToolInputSchema.parse(
    toolCall.input,
  );
  deps.toolLog("view_file", path);
  deps.debugLog(`executeViewFileTool: path=${path}`);

  const statResult = tryCatch(() => deps.fs.statSync(path));
  if (!statResult.ok) {
    const error = getMessageFromError(statResult.error);
    deps.debugLog(`executeViewFileTool: error=${error}`);
    return {
      type: "tool_result",
      tool_use_id: toolCall.id,
      content: error,
      is_error: true,
    };
  }

  if (statResult.value.isDirectory()) {
    const readdirResult = tryCatch(() => deps.fs.readdirSync(path, {}));
    if (!readdirResult.ok) {
      const error = getMessageFromError(readdirResult.error);
      deps.debugLog(`executeViewFileTool: error=${error}`);
      return {
        type: "tool_result",
        tool_use_id: toolCall.id,
        content: error,
        is_error: true,
      };
    }
    const listing = readdirResult.value.join("\n");
    deps.debugLog(`executeViewFileTool: directory listing for ${path}`);
    return {
      type: "tool_result",
      tool_use_id: toolCall.id,
      content: listing,
    };
  }

  const readResult = tryCatch(() => deps.fs.readFileSync(path));
  if (!readResult.ok) {
    const error = getMessageFromError(readResult.error);
    deps.debugLog(`executeViewFileTool: error=${error}`);
    return {
      type: "tool_result",
      tool_use_id: toolCall.id,
      content: error,
      is_error: true,
    };
  }

  const lines = readResult.value.toString().split("\n");

  if (start_line !== undefined && start_line < 1) {
    deps.debugLog(
      `executeViewFileTool: start_line ${String(start_line)} is less than 1`,
    );
    return {
      type: "tool_result",
      tool_use_id: toolCall.id,
      content: `start_line must be at least 1, got ${String(start_line)}`,
      is_error: true,
    };
  }

  if (end_line !== undefined && end_line !== -1 && end_line < 1) {
    deps.debugLog(
      `executeViewFileTool: end_line ${String(end_line)} is less than 1`,
    );
    return {
      type: "tool_result",
      tool_use_id: toolCall.id,
      content: `end_line must be at least 1 or -1, got ${String(end_line)}`,
      is_error: true,
    };
  }

  const start = (start_line ?? 1) - 1;
  const end =
    end_line === undefined || end_line === -1 ? lines.length : end_line;

  if (start >= lines.length) {
    deps.debugLog(
      `executeViewFileTool: start_line ${String(start_line)} is past end of file`,
    );
    return {
      type: "tool_result",
      tool_use_id: toolCall.id,
      content: `start_line ${String(start_line)} is past end of file (file has ${String(lines.length)} lines)`,
      is_error: true,
    };
  }

  if (end > lines.length) {
    deps.debugLog(
      `executeViewFileTool: end_line ${String(end_line)} is past end of file`,
    );
    return {
      type: "tool_result",
      tool_use_id: toolCall.id,
      content: `end_line ${String(end_line)} is past end of file (file has ${String(lines.length)} lines)`,
      is_error: true,
    };
  }

  if (start >= end) {
    deps.debugLog(
      `executeViewFileTool: start_line ${String(start_line)} is greater than or equal to end_line ${String(end_line)}`,
    );
    return {
      type: "tool_result",
      tool_use_id: toolCall.id,
      content: `start_line (${String(start_line)}) must be less than end_line (${String(end_line)})`,
      is_error: true,
    };
  }

  const slice = lines.slice(start, end);
  const numbered = slice
    .map((line, i) => `${String(start + i + 1)}\t${line}`)
    .join("\n");

  deps.debugLog(
    `executeViewFileTool: ${path} lines ${String(start + 1)}-${String(end)}`,
  );
  return {
    type: "tool_result",
    tool_use_id: toolCall.id,
    content: numbered,
  };
}

const executeStrReplaceToolDeps = {
  fs: fsDeps,
  debugLog,
  toolLog,
};

type ExecuteStrReplaceToolDeps = typeof executeStrReplaceToolDeps;

const StrReplaceToolInputSchema = z.object({
  path: z.string(),
  old_str: z.string(),
  new_str: z.string(),
});

export function executeStrReplaceTool(
  toolCall: ToolCall,
  deps: ExecuteStrReplaceToolDeps = executeStrReplaceToolDeps,
): ToolResult {
  const { path, old_str, new_str } = StrReplaceToolInputSchema.parse(
    toolCall.input,
  );
  deps.toolLog("str_replace", path);
  deps.debugLog(`executeStrReplaceTool: path=${path}`);

  const readResult = tryCatch(() => deps.fs.readFileSync(path));
  if (!readResult.ok) {
    const error = getMessageFromError(readResult.error);
    deps.debugLog(`executeStrReplaceTool: error=${error}`);
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
    deps.debugLog(`executeStrReplaceTool: old_str not found in ${path}`);
    return {
      type: "tool_result",
      tool_use_id: toolCall.id,
      content: "old_str not found in file",
      is_error: true,
    };
  }

  if (occurrences > 1) {
    deps.debugLog(
      `executeStrReplaceTool: old_str matched ${String(occurrences)} times in ${path}`,
    );
    return {
      type: "tool_result",
      tool_use_id: toolCall.id,
      content: `old_str matched ${String(occurrences)} times — must match exactly once`,
      is_error: true,
    };
  }

  const writeResult = tryCatch(() =>
    deps.fs.writeFileSync(path, content.replace(old_str, new_str)),
  );
  if (!writeResult.ok) {
    const error = getMessageFromError(writeResult.error);
    deps.debugLog(`executeStrReplaceTool: error=${error}`);
    return {
      type: "tool_result",
      tool_use_id: toolCall.id,
      content: error,
      is_error: true,
    };
  }

  deps.debugLog(`executeStrReplaceTool: ${path} updated successfully`);
  return {
    type: "tool_result",
    tool_use_id: toolCall.id,
    content: `${path} updated successfully`,
  };
}

const executeInsertLinesToolDeps = {
  fs: fsDeps,
  debugLog,
  toolLog,
};

type ExecuteInsertLinesToolDeps = typeof executeInsertLinesToolDeps;

const InsertLinesToolInputSchema = z.object({
  path: z.string(),
  after_line: z.number().int(),
  content: z.string(),
});

export function executeInsertLinesTool(
  toolCall: ToolCall,
  deps: ExecuteInsertLinesToolDeps = executeInsertLinesToolDeps,
): ToolResult {
  const { path, after_line, content } = InsertLinesToolInputSchema.parse(
    toolCall.input,
  );
  deps.toolLog("insert_lines", path);
  deps.debugLog(
    `executeInsertLinesTool: path=${path}, after_line=${String(after_line)}`,
  );

  const readResult = tryCatch(() => deps.fs.readFileSync(path));
  if (!readResult.ok) {
    const error = getMessageFromError(readResult.error);
    deps.debugLog(`executeInsertLinesTool: error=${error}`);
    return {
      type: "tool_result",
      tool_use_id: toolCall.id,
      content: error,
      is_error: true,
    };
  }

  const lines = readResult.value.toString().split("\n");

  if (after_line < 0 || after_line > lines.length) {
    deps.debugLog(
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
    deps.fs.writeFileSync(path, lines.join("\n"));
  });
  if (!writeResult.ok) {
    const error = getMessageFromError(writeResult.error);
    deps.debugLog(`executeInsertLinesTool: error=${error}`);
    return {
      type: "tool_result",
      tool_use_id: toolCall.id,
      content: error,
      is_error: true,
    };
  }

  deps.debugLog(`executeInsertLinesTool: ${path} updated successfully`);
  return {
    type: "tool_result",
    tool_use_id: toolCall.id,
    content: `${path} updated successfully`,
  };
}

const executeWebFetchToolDeps = {
  fetch: (href: string, init?: RequestInit) => fetch(href, init),
  debugLog,
  toolLog,
};

type ExecuteWebFetchToolDeps = typeof executeWebFetchToolDeps;

const WebFetchToolSchema = z.object({
  href: z.string(),
});

export async function executeWebFetchHtmlTool(
  toolCall: ToolCall,
  deps: ExecuteWebFetchToolDeps = executeWebFetchToolDeps,
): Promise<ToolResult> {
  const { href } = WebFetchToolSchema.parse(toolCall.input);
  deps.toolLog("web_fetch_html", href);
  deps.debugLog(`executeWebFetchHtmlTool: href=${href}`);
  try {
    const headers = new Headers();
    headers.append("User-Agent", userAgent);
    headers.append("Accept", "text/html");

    const fetchController = new AbortController();
    const timeoutId = setTimeout(() => {
      fetchController.abort();
    }, 10_000);

    const response = await deps.fetch(href, {
      headers,
      signal: fetchController.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = `HTTP ${String(response.status)}: ${response.statusText}`;
      colorPrint(error, "yellow");
      throw new Error(error);
    }

    const htmlStr = await response.text();
    const doc = new JSDOM(htmlStr);
    const reader = new Readability(doc.window.document);
    const article = reader.parse();
    if (!article) {
      const error = `Failed to parse article from ${href}`;
      colorPrint(error, "yellow");
      throw new Error(error);
    }

    deps.debugLog(
      `executeWebFetchHtmlTool: success, title=${article.title ?? "null"}`,
    );
    return {
      content: stringify(article),
      tool_use_id: toolCall.id,
      type: "tool_result",
    };
  } catch (error: unknown) {
    const msg = getMessageFromError(error);
    deps.debugLog(`executeWebFetchHtmlTool: error=${msg}`);
    return {
      is_error: true,
      type: "tool_result",
      content: msg,
      tool_use_id: toolCall.id,
    };
  }
}

export async function executeWebFetchJsonTool(
  toolCall: ToolCall,
  deps: ExecuteWebFetchToolDeps = executeWebFetchToolDeps,
): Promise<ToolResult> {
  const { href } = WebFetchToolSchema.parse(toolCall.input);
  deps.toolLog("web_fetch_json", href);
  deps.debugLog(`executeWebFetchJsonTool: href=${href}`);
  try {
    const headers = new Headers();
    headers.append("User-Agent", userAgent);
    headers.append("Accept", "application/json");

    const fetchController = new AbortController();
    const timeoutId = setTimeout(() => {
      fetchController.abort();
    }, 10_000);

    const response = await deps.fetch(href, {
      headers,
      signal: fetchController.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = `HTTP ${String(response.status)}: ${response.statusText}`;
      colorPrint(error, "yellow");
      throw new Error(error);
    }

    const json = (await response.json()) as unknown;
    deps.debugLog(`executeWebFetchJsonTool: success`);
    return {
      content: stringify(json),
      tool_use_id: toolCall.id,
      type: "tool_result",
    };
  } catch (error: unknown) {
    const msg = getMessageFromError(error);
    deps.debugLog(`executeWebFetchJsonTool: error=${msg}`);
    return {
      is_error: true,
      type: "tool_result",
      content: msg,
      tool_use_id: toolCall.id,
    };
  }
}

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
  web_fetch_html: tool({
    description:
      "Fetch a web page by URL and return its readable content, parsed to extract the main article.",
    inputSchema: WebFetchToolSchema,
  }),
  web_fetch_json: tool({
    description:
      "Fetch a JSON API endpoint by URL and return the parsed JSON response.",
    inputSchema: WebFetchToolSchema,
  }),
};

const getToolResultBlockDeps = {
  fs: fsDeps,
};

type GetToolResultBlockDeps = typeof getToolResultBlockDeps;

export async function getToolResultBlock(
  toolCall: ToolCall,
  deps: GetToolResultBlockDeps = getToolResultBlockDeps,
) {
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
      const tempFileBefore = createTempFile({ initialContentPath: path });
      toolResult = executeStrReplaceTool(toolCall);
      if (!toolResult.is_error) {
        const tempFileAfter = createTempFile({ initialContentPath: path });
        await printGitDiff({
          tempFileBeforePath: tempFileBefore,
          tempFileAfterPath: tempFileAfter,
          path,
        });
        deps.fs.unlinkSync(tempFileBefore);
        deps.fs.unlinkSync(tempFileAfter);
      }
      break;
    }
    case "insert_lines": {
      const { path } = InsertLinesToolInputSchema.parse(toolCall.input);
      const tempFileBefore = createTempFile({ initialContentPath: path });
      toolResult = executeInsertLinesTool(toolCall);
      if (!toolResult.is_error) {
        const tempFileAfter = createTempFile({ initialContentPath: path });
        await printGitDiff({
          tempFileBeforePath: tempFileBefore,
          tempFileAfterPath: tempFileAfter,
          path,
        });
        deps.fs.unlinkSync(tempFileBefore);
        deps.fs.unlinkSync(tempFileAfter);
      }
      break;
    }
    case "web_fetch_html": {
      toolResult = await executeWebFetchHtmlTool(toolCall);
      break;
    }
    case "web_fetch_json": {
      toolResult = await executeWebFetchJsonTool(toolCall);
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

async function printGitDiff(args: {
  tempFileBeforePath: string;
  tempFileAfterPath: string;
  path: string;
}) {
  const diffArgs =
    selectors.getDiffStyle() === "lines"
      ? `--no-index --color=always ${args.tempFileBeforePath} ${args.tempFileAfterPath}`
      : `--no-index --color=always --stat ${args.tempFileBeforePath} ${args.tempFileAfterPath}`;

  const diffResult = await tryCatchAsync(execGitDiff(diffArgs));
  if (diffResult.ok && diffResult.value.stdout) {
    printNewline();
    fencePrint(`File change: ${args.path}`);
    colorPrint(normalizeLine(diffResult.value.stdout));
    printNewline();
  }
}
