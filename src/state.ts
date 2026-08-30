/* eslint-disable @typescript-eslint/no-base-to-string */
import type readline from "node:readline/promises";
import type { ModelMessage } from "ai";
import {
  DEFAULT_CONFIG,
  type DefaultedConfig,
  type Key,
  type ModelPricing,
  type Provider,
  type UsageLimit,
} from "./config.ts";
import { stringify } from "./utils.ts";
import { debugLog } from "./log.ts";
import type { ModelUsage } from "./usage.ts";
import type { ContextEntry, Skill } from "./context.ts";

export interface SlashCommand {
  name: string;
  filePath: string;
  content: string;
}

interface State {
  app: {
    messageParams: { tokens: number; messages: ModelMessage[] };
    editorInputValue: string | null;
    slashCommands: SlashCommand[];
    customSlashCommandDirs: string[];
    customSkillDirs: string[];
    stdout: string;
    debugLog: boolean;
    debugLogPath: string;
    chatHistoryPath: string;
    contextEntries: ContextEntry[];
    contextStr: string;
    skillsStr: string;
    skills: Skill[];
    rl: readline.Interface | null;
    loadingStateTimeout: NodeJS.Timeout | null;
    loadingStateFrameIdx: number;
    apiStartTime: number | null;
    apiEndTime: number | null;
    modelUsageForLimitWindow: Record<string, ModelUsage[]>;
    modelUsageForSession: Record<string, ModelUsage[]>;
    sessionStartDate: number;
  };
  config: DefaultedConfig;
  abortControllers: {
    question: AbortController | null;
    apiStream: AbortController | null;
  };
}

const initialState: State = {
  app: {
    messageParams: { tokens: 0, messages: [] },
    editorInputValue: null,
    slashCommands: [],
    customSlashCommandDirs: [],
    customSkillDirs: [],
    stdout: "",
    debugLog: false,
    debugLogPath: "",
    chatHistoryPath: "",
    contextEntries: [],
    contextStr: "",
    skillsStr: "",
    skills: [],
    rl: null,
    loadingStateTimeout: null,
    loadingStateFrameIdx: 0,
    apiStartTime: null,
    apiEndTime: null,
    modelUsageForLimitWindow: {},
    modelUsageForSession: {},
    sessionStartDate: 0,
  },
  config: {
    model: "",
    provider: DEFAULT_CONFIG.provider,
    baseURL: undefined,
    pricingPerModel: structuredClone(DEFAULT_CONFIG.pricingPerModel),
    contextWindowPerModel: structuredClone(
      DEFAULT_CONFIG.contextWindowPerModel,
    ),
    compactAtContextRatio: DEFAULT_CONFIG.compactAtContextRatio,
    compactTargetRatio: DEFAULT_CONFIG.compactTargetRatio,
    keymapEditPrompt: structuredClone(DEFAULT_CONFIG.keymaps.edit),
    keymapPastePrompt: structuredClone(DEFAULT_CONFIG.keymaps.paste),
    keymapChatHistory: structuredClone(DEFAULT_CONFIG.keymaps.history),
    keymapClear: structuredClone(DEFAULT_CONFIG.keymaps.clear),
    loadingStateFrames: structuredClone(DEFAULT_CONFIG.loadingStateFrames),
    loadingStateFrameDuration: DEFAULT_CONFIG.loadingStateFrameDuration,
    promptPrefix: DEFAULT_CONFIG.promptPrefix,
    usageLimit: undefined,
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
  appendToMessageParams(message: ModelMessage, tokens: number) {
    const before = state.app.messageParams.tokens;
    state.app.messageParams.messages.push(message);
    state.app.messageParams.tokens += tokens;
    logStateChange(
      "append-to-message-params",
      String(before),
      String(state.app.messageParams.tokens),
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

  setContextWindowPerModel(contextWindowPerModel: Record<string, number>) {
    const before = state.config.contextWindowPerModel;
    state.config.contextWindowPerModel = contextWindowPerModel;
    logStateChange(
      "set-context-window-per-model",
      stringify(before),
      stringify(contextWindowPerModel),
    );
  },

  setCompactAtContextRatio(compactAtContextRatio: number) {
    const before = state.config.compactAtContextRatio;
    state.config.compactAtContextRatio = compactAtContextRatio;
    logStateChange(
      "set-compact-at-context-ratio",
      String(before),
      String(compactAtContextRatio),
    );
  },

  setCompactTargetRatio(compactTargetRatio: number) {
    const before = state.config.compactTargetRatio;
    state.config.compactTargetRatio = compactTargetRatio;
    logStateChange(
      "set-compact-target-ratio",
      String(before),
      String(compactTargetRatio),
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

  setKeymapPastePrompt(keymap: Key) {
    const before = state.config.keymapPastePrompt;
    state.config.keymapPastePrompt = keymap;
    logStateChange(
      "set-keymap-paste-prompt",
      stringify(before),
      stringify(keymap),
    );
  },

  setKeymapChatHistory(keymap: Key) {
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

  resetMessageParams() {
    const before = state.app.messageParams.tokens;
    state.app.messageParams = { tokens: 0, messages: [] };
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
    // `logStateChange` returns early when `debugLog=false`
    // so it can't be called in the fn where `debugLog` is set
    state.app.debugLog = debugLog;
  },

  setDebugLogPath(debugLogPath: string) {
    const before = state.app.debugLogPath;
    state.app.debugLogPath = debugLogPath;
    logStateChange("set-debug-log-path", before, debugLogPath);
  },

  setChatHistoryPath(chatHistoryPath: string) {
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

  setModelUsageForLimitWindow(
    modelUsageForLimitWindow: Record<string, ModelUsage[]>,
  ) {
    const before = state.app.modelUsageForLimitWindow;
    state.app.modelUsageForLimitWindow = modelUsageForLimitWindow;

    logStateChange(
      "set-model-usage-for-limit-window",
      String(Object.keys(before).length),
      String(Object.keys(state.app.modelUsageForLimitWindow).length),
    );
  },

  setModelUsageForSession(modelUsageForSession: Record<string, ModelUsage[]>) {
    const before = state.app.modelUsageForSession;
    state.app.modelUsageForSession = modelUsageForSession;

    logStateChange(
      "set-model-usage-for-session",
      String(Object.keys(before).length),
      String(Object.keys(state.app.modelUsageForSession).length),
    );
  },

  appendToModelUsageForSession(usage: ModelUsage) {
    const model = state.config.model;
    state.app.modelUsageForSession[model] ??= [];

    const before = state.app.modelUsageForSession[model];
    state.app.modelUsageForSession[model].push(usage);

    logStateChange(
      "append-to-model-usage-for-session",
      String(before.length),
      String(state.app.modelUsageForSession[model].length),
    );
  },

  setRl(rl: readline.Interface | null) {
    const before = state.app.rl;
    state.app.rl = rl;
    logStateChange("set-rl", String(before), String(rl));
  },

  setLoadingStateTimeout(timeout: NodeJS.Timeout | null) {
    const before = state.app.loadingStateTimeout;
    state.app.loadingStateTimeout = timeout;
    logStateChange(
      "set-loading-state-timeout",
      String(before),
      String(timeout),
    );
  },

  setApiStartTime() {
    const before = state.app.apiStartTime;
    const now = performance.now();
    state.app.apiStartTime = now;
    logStateChange("set-api-start-time", String(before), String(now));
  },

  setApiEndTime() {
    const before = state.app.apiEndTime;
    const now = performance.now();
    state.app.apiEndTime = now;
    logStateChange("set-api-end-time", String(before), String(now));
  },

  setSessionStartDate() {
    const before = state.app.sessionStartDate;
    const now = Date.now();
    state.app.sessionStartDate = now;
    logStateChange("set-session-start-date", String(before), String(now));
  },

  resetState() {
    state = structuredClone(initialState);
    logStateChange("reset-state", "[truncating]", stringify(state));
  },

  incrementLoadingStateFrameIdx() {
    const before = state.app.loadingStateFrameIdx;
    state.app.loadingStateFrameIdx++;
    const after = state.app.loadingStateFrameIdx;
    logStateChange(
      "set-loading-state-frame-idx",
      String(before),
      String(after),
    );
  },

  resetLoadingStateFrameIdx() {
    const before = state.app.loadingStateFrameIdx;
    state.app.loadingStateFrameIdx = 0;
    logStateChange(
      "set-loading-state-frame-idx",
      String(before),
      String(state.app.loadingStateFrameIdx),
    );
  },

  setLoadingStateFrames(loadingStateFrames: string[]) {
    const before = state.config.loadingStateFrames;
    state.config.loadingStateFrames = loadingStateFrames;
    logStateChange(
      "set-loading-state-frames",
      stringify(before),
      stringify(loadingStateFrames),
    );
  },

  setLoadingStateFrameDuration(loadingStateFrameDuration: number) {
    const before = state.config.loadingStateFrameDuration;
    state.config.loadingStateFrameDuration = loadingStateFrameDuration;
    logStateChange(
      "set-loading-state-frame-duration",
      String(before),
      String(loadingStateFrameDuration),
    );
  },

  setPromptPrefix(promptPrefix: string) {
    const before = state.config.promptPrefix;
    state.config.promptPrefix = promptPrefix;
    logStateChange("set-prompt-prefix", before, promptPrefix);
  },

  setUsageLimit(usageLimit: UsageLimit | undefined) {
    const before = state.config.usageLimit;
    state.config.usageLimit = usageLimit;
    logStateChange("set-usage-limit", stringify(before), stringify(usageLimit));
  },
};
