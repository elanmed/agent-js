import { homedir } from "node:os";
import { join } from "node:path";

export const GLOBAL_CONFIG_DIR_PATH = join(homedir(), ".config", ".agent-js");
export const LOCAL_CONFIG_DIR_PATH = join(process.cwd(), ".agent-js");

export const GLOBAL_CONFIG_PATH = join(GLOBAL_CONFIG_DIR_PATH, "settings.json");
export const LOCAL_CONFIG_PATH = join(LOCAL_CONFIG_DIR_PATH, "settings.json");

export const GLOBAL_AGENTS_PATH = join(GLOBAL_CONFIG_DIR_PATH, "AGENTS.md");

export const GLOBAL_SKILLS_DIR_PATH = join(GLOBAL_CONFIG_DIR_PATH, "skills");
export const LOCAL_SKILLS_DIR_PATH = join(process.cwd(), ".agent-js", "skills");
