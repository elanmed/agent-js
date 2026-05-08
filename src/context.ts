import { join } from "node:path";
import { fsDeps, type FsDeps } from "./fs-deps.ts";
import { tryCatch } from "./utils.ts";
import { colorPrint } from "./print.ts";
import { debugLog } from "./log.ts";
import {
  GLOBAL_SKILLS_DIR_PATH,
  LOCAL_SKILLS_DIR_PATH,
} from "./config.ts";
import frontMatter from "front-matter";
import z from "zod";

export interface GetAgentsContextDeps {
  debugLog: (content: string) => void;
  fs: FsDeps;
}

export const getAgentsContextDeps: GetAgentsContextDeps = {
  debugLog,
  fs: fsDeps,
};

export function getAgentsContext(
  deps: GetAgentsContextDeps = getAgentsContextDeps,
) {
  const agentFilePaths = deps.fs.globSync("**/AGENTS.md");

  deps.debugLog(`AGENTS.md found: ${agentFilePaths.join(",")}`);

  const entries: { filePath: string; content: string }[] = [];

  for (const filePath of agentFilePaths) {
    const readResult = tryCatch(() =>
      deps.fs.readFileSync(filePath).toString(),
    );
    if (readResult.ok) {
      entries.push({ filePath, content: readResult.value });
    }
  }

  if (entries.length === 0) return "";

  const agentFilesList = entries
    .map((entry) => `Path: ${entry.filePath}\nContent: ${entry.content}\n`)
    .join("\n");
  return `
AGENTS.md context files:
${agentFilesList}`;
}

const skillSchema = z.object({
  name: z.string(),
  description: z.string(),
});
export type Skill = z.infer<typeof skillSchema>;

export interface GetSkillsContextDeps {
  fs: FsDeps;
  skillsDirPaths?: string[];
  colorPrint: typeof colorPrint;
}

export const getSkillsContextDeps: GetSkillsContextDeps = {
  fs: fsDeps,
  colorPrint,
};

export function getSkillsContext(
  deps: GetSkillsContextDeps = getSkillsContextDeps,
) {
  const seenSkills = new Set();
  const skillsDirPaths = deps.skillsDirPaths ?? [
    LOCAL_SKILLS_DIR_PATH,
    GLOBAL_SKILLS_DIR_PATH,
  ];
  const skillsJSON: Skill[] = [];

  skillsDirPaths.forEach((dirPath) => {
    if (!deps.fs.existsSync(dirPath)) return;

    for (const dirName of deps.fs.readdirSync(dirPath)) {
      const fullDirPath = join(dirPath, dirName);
      const statResult = tryCatch(() => deps.fs.statSync(fullDirPath));
      if (!statResult.ok) continue;
      if (statResult.value.isFile()) continue;

      const skillJSON = getSkillJSON(fullDirPath, {
        fs: deps.fs,
        colorPrint: deps.colorPrint,
      });
      if (skillJSON === null) continue;
      if (seenSkills.has(skillJSON.name)) continue;
      seenSkills.add(skillJSON.name);
      skillsJSON.push(skillJSON);
    }
  });

  const skillsList = skillsJSON
    .map((skill) => `- ${skill.name}: ${skill.description}`)
    .join("\n");

  return `
Skills:

Use the \`loadSkill\` tool to load a skill when the user's request
would benefit from specialized instructions.

 Available skills:
${skillsList}
`;
}

export interface GetSkillJSONDeps {
  fs: FsDeps;
  colorPrint: typeof colorPrint;
}

export const getSkillJSONDeps: GetSkillJSONDeps = {
  fs: fsDeps,
  colorPrint,
};

export function getSkillJSON(
  dirPath: string,
  deps: GetSkillJSONDeps = getSkillJSONDeps,
) {
  for (const name of deps.fs.readdirSync(dirPath)) {
    const fullPath = join(dirPath, name);
    const statResult = tryCatch(() => deps.fs.statSync(fullPath));
    if (!statResult.ok) continue;
    if (!statResult.value.isFile()) continue;
    if (name !== "SKILL.md") continue;

    const readResult = tryCatch(() =>
      deps.fs.readFileSync(fullPath).toString(),
    );
    if (!readResult.ok) continue;

    const rawData = frontMatter(readResult.value);
    const parseResult = skillSchema.safeParse(rawData.attributes);
    if (!parseResult.success) {
      deps.colorPrint(
        `Malformed skill at ${fullPath}! A skill's front matter must contain a \`name\` and \`description\` field.`,
        "red",
      );
      continue;
    }
    return parseResult.data;
  }

  return null;
}

export const BASE_SYSTEM_PROMPT = `
You are an AI agent being called from a minimal terminal cli. 

- Keep responses under 25 words unless the task requires detail.
- No filler: omit "I'll help", "Sure", "Here is", etc.
- Answer in 1 sentence when possible
- For code edits: show only the change, no description
- Questions get answers only, no padding
- When giving commands for debugging, give one command at a time - not multiple.
- The CLI will automatically output a diff for every file-modifying tool. DO NOT include code snippets in markdown responses if the code snippet was already applied in a file-modifying tool.
- DO display code snippets in markdown responses when the snippet has not been applied with a file-modifying tool

CRITICAL: All responses will be parsed by bat as markdown, you MUST format as valid markdown.
`;

