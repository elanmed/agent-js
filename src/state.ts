/* eslint-disable @typescript-eslint/no-base-to-string */
import type readline from "node:readline/promises";
import type { ModelMessage } from "ai";
import {
  DEFAULT_CONFIG,
  type Key,
  type ModelPricing,
  type Provider,
} from "./config.ts";
import { MISSING, stringify } from "./utils.ts";
import { debugLog } from "./log.ts";
import type { TokenUsage } from "./print.ts";
import type { ContextEntry, Skill } from "./context.ts";

export interface SlashCommand {
  name: string;
  filePath: string;
  content: string;
}

interface State {
  app: {
    messageParams: ModelMessage[];
    messageUsages: TokenUsage[];
    editorInputValue: string | null;
    slashCommands: SlashCommand[];
    customSlashCommandDirs: string[];
    customSkillDirs: string[];
    stdout: string;
    debugLog: boolean;
    chatHistoryPath: string;
    contextEntries: ContextEntry[];
    contextStr: string;
    skillsStr: string;
    skills: Skill[];
    rl: readline.Interface | null;
    spinnerTimeout: NodeJS.Timeout | null;
    apiStartTime: number | null;
    apiEndTime: number | null;
  };
  config: {
    pricingPerModel: Record<string, ModelPricing>;
    model: string;
    baseURL: string | null;
    provider: Provider;
    keymapEditPrompt: Key;
    keymapEditPastePrompt: Key;
    keymapChatHistory: Key;
    keymapClear: Key;
  };
  abortControllers: {
    question: AbortController | null;
    apiStream: AbortController | null;
  };
}

const initialState: State = {
  app: {
    messageParams: [],
    messageUsages: [],
    editorInputValue: null,
    slashCommands: [],
    customSlashCommandDirs: [],
    customSkillDirs: [],
    stdout: "",
    debugLog: false,
    chatHistoryPath: "",
    contextEntries: [],
    contextStr: "",
    skillsStr: "",
    skills: [],
    rl: null,
    spinnerTimeout: null,
    apiStartTime: null,
    apiEndTime: null,
  },
  config: {
    model: MISSING,
    provider: DEFAULT_CONFIG.provider,
    baseURL: null,
    pricingPerModel: structuredClone(DEFAULT_CONFIG.pricingPerModel),
    keymapEditPrompt: structuredClone(DEFAULT_CONFIG.keymaps.edit),
    keymapEditPastePrompt: structuredClone(DEFAULT_CONFIG.keymaps.paste),
    keymapChatHistory: structuredClone(DEFAULT_CONFIG.keymaps.history),
    keymapClear: structuredClone(DEFAULT_CONFIG.keymaps.clear),
  },
  abortControllers: {
    question: null,
    apiStream: null,
  },
};

let state: State = structuredClone(initialState);

export const getState = () => state;

const logStateChange = (actionType: string, before: string, after: string) => {
  debugLog(`dispatch ${actionType}: before=${before}, after=${after}`);
};

export const actions = {
  appendToMessageParams(message: ModelMessage) {
    const before = state.app.messageParams;
    state.app.messageParams.push(message);
    logStateChange(
      "append-to-message-params",
      String(before.length),
      String(state.app.messageParams.length),
    );
  },

  appendToMessageUsages(message: TokenUsage) {
    const before = state.app.messageUsages;
    state.app.messageUsages.push(message);
    logStateChange(
      "append-to-message-usages",
      String(before.length),
      String(state.app.messageUsages.length),
    );
  },

  setModel(model: string) {
    const before = state.config.model;
    state.config.model = model;
    logStateChange("set-model", before, model);
  },

  setProvider(provider: Provider) {
    const before = state.config.provider;
    state.config.provider = provider;
    logStateChange("set-provider", before, provider);
  },

  setBaseURL(baseURL: string) {
    const before = state.config.baseURL;
    state.config.baseURL = baseURL;
    logStateChange("set-base-url", String(before), baseURL);
  },

  setPricingPerModel(pricing: Record<string, ModelPricing>) {
    const before = state.config.pricingPerModel;
    state.config.pricingPerModel = pricing;
    logStateChange(
      "set-pricing-per-model",
      stringify(before),
      stringify(pricing),
    );
  },

  setKeymapEditPrompt(keymap: Key) {
    const before = state.config.keymapEditPrompt;
    state.config.keymapEditPrompt = keymap;
    logStateChange(
      "set-keymap-edit-prompt",
      stringify(before),
      stringify(keymap),
    );
  },

  setKeymapEditPastePrompt(keymap: Key) {
    const before = state.config.keymapEditPastePrompt;
    state.config.keymapEditPastePrompt = keymap;
    logStateChange(
      "set-keymap-edit-paste-prompt",
      stringify(before),
      stringify(keymap),
    );
  },

  setKeymapPromptHistory(keymap: Key) {
    const before = state.config.keymapChatHistory;
    state.config.keymapChatHistory = keymap;
    logStateChange(
      "set-keymap-chat-history",
      stringify(before),
      stringify(keymap),
    );
  },

  setKeymapClear(keymap: Key) {
    const before = state.config.keymapClear;
    state.config.keymapClear = keymap;
    logStateChange("set-keymap-clear", stringify(before), stringify(keymap));
  },

  resetMessageUsages() {
    const before = state.app.messageUsages.length;
    state.app.messageUsages = [];
    logStateChange("reset-message-usages", String(before), "0");
  },

  resetMessageParams() {
    const before = state.app.messageParams.length;
    state.app.messageParams = [];
    logStateChange("reset-message-params", String(before), "0");
  },

  setQuestionAbortController(controller: AbortController | null) {
    const before = state.abortControllers.question;
    state.abortControllers.question = controller;
    logStateChange(
      "set-question-abort-controller",
      String(before),
      String(controller),
    );
  },

  setApiStreamAbortController(controller: AbortController | null) {
    const before = state.abortControllers.apiStream;
    state.abortControllers.apiStream = controller;
    logStateChange(
      "set-api-stream-abort-controller",
      String(before),
      String(controller),
    );
  },

  setEditorInputValue(value: string | null) {
    const before = state.app.editorInputValue;
    state.app.editorInputValue = value;
    logStateChange("set-editor-input-value", String(before), String(value));
  },

  setSlashCommands(commands: SlashCommand[]) {
    const before = state.app.slashCommands;
    state.app.slashCommands = commands;
    logStateChange("set-slash-commands", String(before), String(commands));
  },

  setCustomSlashCommandDirs(dirs: string[]) {
    const before = state.app.customSlashCommandDirs;
    state.app.customSlashCommandDirs = dirs;
    logStateChange(
      "set-custom-slash-command-dirs",
      String(before),
      String(dirs),
    );
  },

  setCustomSkillDirs(dirs: string[]) {
    const before = state.app.customSkillDirs;
    state.app.customSkillDirs = dirs;
    logStateChange("set-custom-skill-dirs", String(before), String(dirs));
  },

  resetStdout() {
    const before = state.app.stdout;
    state.app.stdout = "";
    logStateChange("reset-stdout", before, "");
  },

  appendToStdout(line: string) {
    const before = state.app.stdout;
    state.app.stdout += line;
    logStateChange(
      "append-to-stdout",
      String(before.length),
      String(state.app.stdout.length),
    );
  },

  setDebugLog(debugLog: boolean) {
    state.app.debugLog = debugLog;
  },

  setPromptHistoryPath(chatHistoryPath: string) {
    const before = state.app.chatHistoryPath;
    state.app.chatHistoryPath = chatHistoryPath;
    logStateChange("set-chat-history-path", before, chatHistoryPath);
  },

  setContextEntries(contextEntries: ContextEntry[]) {
    const before = state.app.contextEntries.length;
    state.app.contextEntries = contextEntries;
    logStateChange(
      "set-context-entries",
      String(before),
      String(state.app.contextEntries.length),
    );
  },

  setContextStr(contextStr: string) {
    const before = state.app.contextStr;
    state.app.contextStr = contextStr;
    logStateChange(
      "set-context-str",
      String(before.length),
      String(contextStr.length),
    );
  },

  setSkillsStr(skillsStr: string) {
    const before = state.app.skillsStr;
    state.app.skillsStr = skillsStr;
    logStateChange(
      "set-skills-str",
      String(before.length),
      String(skillsStr.length),
    );
  },

  setSkills(skills: Skill[]) {
    const before = state.app.skills.length;
    state.app.skills = skills;
    logStateChange(
      "set-skills",
      String(before),
      String(state.app.skills.length),
    );
  },

  setRl(rl: readline.Interface | null) {
    const before = state.app.rl;
    state.app.rl = rl;
    logStateChange("set-rl", String(before), String(rl));
  },

  setSpinnerTimeout(timeout: NodeJS.Timeout | null) {
    const before = state.app.spinnerTimeout;
    state.app.spinnerTimeout = timeout;
    logStateChange("set-spinner-timeout", String(before), String(timeout));
  },

  setApiStartTime() {
    const before = state.app.apiStartTime;
    const now = Date.now();
    state.app.apiStartTime = now;
    logStateChange("set-api-start-time", String(before), String(now));
  },

  setApiEndTime() {
    const before = state.app.apiEndTime;
    const now = Date.now();
    state.app.apiEndTime = now;
    logStateChange("set-api-end-time", String(before), String(now));
  },

  resetState() {
    state = structuredClone(initialState);
    logStateChange("reset-state", "[truncating]", stringify(state));
  },
};
