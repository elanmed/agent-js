import { homedir } from "node:os";
import { join } from "node:path";

export function getGlobalConfigDirPath() {
  return join(homedir(), ".config", ".agent-js");
}

export function getLocalConfigDirPath() {
  return join(process.cwd(), ".agent-js");
}

export function getGlobalConfigPath() {
  return join(getGlobalConfigDirPath(), "settings.json");
}

export function getLocalConfigPath() {
  return join(getLocalConfigDirPath(), "settings.json");
}

export function getGlobalAgentsPath() {
  return join(getGlobalConfigDirPath(), "AGENTS.md");
}

export function getGlobalSkillsDirPath() {
  return join(getGlobalConfigDirPath(), "skills");
}

export function getLocalSkillsDirPath() {
  return join(process.cwd(), ".agent-js", "skills");
}
