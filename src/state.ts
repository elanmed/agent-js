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
    promptHistoryPath: string;
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
    keymapPromptHistory: Key;
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
    promptHistoryPath: "",
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
    keymapPromptHistory: structuredClone(DEFAULT_CONFIG.keymaps.history),
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

const appendToMessageParams = (message: ModelMessage) => {
  const before = state.app.messageParams;
  state = {
    ...state,
    app: {
      ...state.app,
      messageParams: [...state.app.messageParams, message],
    },
  };
  logStateChange(
    "append-to-message-params",
    String(before.length),
    String(state.app.messageParams.length),
  );
};

const appendToMessageUsages = (message: TokenUsage) => {
  const before = state.app.messageUsages;
  state = {
    ...state,
    app: {
      ...state.app,
      messageUsages: [...state.app.messageUsages, message],
    },
  };
  logStateChange(
    "append-to-message-usages",
    String(before.length),
    String(state.app.messageUsages.length),
  );
};

const setModel = (model: string) => {
  const before = state.config.model;
  state = {
    ...state,
    config: { ...state.config, model },
  };
  logStateChange("set-model", before, model);
};

const setProvider = (provider: Provider) => {
  const before = state.config.provider;
  state = {
    ...state,
    config: { ...state.config, provider },
  };
  logStateChange("set-provider", before, provider);
};

const setBaseURL = (baseURL: string) => {
  const before = state.config.baseURL;
  state = {
    ...state,
    config: { ...state.config, baseURL },
  };
  logStateChange("set-base-url", String(before), baseURL);
};

const setPricingPerModel = (pricing: Record<string, ModelPricing>) => {
  const before = state.config.pricingPerModel;
  state = {
    ...state,
    config: { ...state.config, pricingPerModel: pricing },
  };
  logStateChange(
    "set-pricing-per-model",
    stringify(before),
    stringify(pricing),
  );
};

const setKeymapEditPrompt = (keymap: Key) => {
  const before = state.config.keymapEditPrompt;
  state = {
    ...state,
    config: { ...state.config, keymapEditPrompt: keymap },
  };
  logStateChange(
    "set-keymap-edit-prompt",
    stringify(before),
    stringify(keymap),
  );
};

const setKeymapEditPastePrompt = (keymap: Key) => {
  const before = state.config.keymapEditPastePrompt;
  state = {
    ...state,
    config: {
      ...state.config,
      keymapEditPastePrompt: keymap,
    },
  };
  logStateChange(
    "set-keymap-edit-paste-prompt",
    stringify(before),
    stringify(keymap),
  );
};

const setKeymapPromptHistory = (keymap: Key) => {
  const before = state.config.keymapPromptHistory;
  state = {
    ...state,
    config: {
      ...state.config,
      keymapPromptHistory: keymap,
    },
  };
  logStateChange(
    "set-keymap-prompt-history",
    stringify(before),
    stringify(keymap),
  );
};

const setKeymapClear = (keymap: Key) => {
  const before = state.config.keymapClear;
  state = {
    ...state,
    config: { ...state.config, keymapClear: keymap },
  };
  logStateChange("set-keymap-clear", stringify(before), stringify(keymap));
};

const resetMessageUsages = () => {
  const before = state.app.messageUsages.length;
  state = {
    ...state,
    app: { ...state.app, messageUsages: [] },
  };
  logStateChange("reset-message-usages", String(before), "0");
};

const resetMessageParams = () => {
  const before = state.app.messageParams.length;
  state = {
    ...state,
    app: { ...state.app, messageParams: [] },
  };
  logStateChange("reset-message-params", String(before), "0");
};

const setQuestionAbortController = (controller: AbortController | null) => {
  const before = state.abortControllers.question;
  state = {
    ...state,
    abortControllers: {
      ...state.abortControllers,
      question: controller,
    },
  };
  logStateChange(
    "set-question-abort-controller",
    String(before),
    String(controller),
  );
};

const setApiStreamAbortController = (controller: AbortController | null) => {
  const before = state.abortControllers.apiStream;
  state = {
    ...state,
    abortControllers: {
      ...state.abortControllers,
      apiStream: controller,
    },
  };
  logStateChange(
    "set-api-stream-abort-controller",
    String(before),
    String(controller),
  );
};

const setEditorInputValue = (value: string | null) => {
  const before = state.app.editorInputValue;
  state = {
    ...state,
    app: {
      ...state.app,
      editorInputValue: value,
    },
  };
  logStateChange("set-editor-input-value", String(before), String(value));
};

const setSlashCommands = (commands: SlashCommand[]) => {
  const before = state.app.slashCommands;
  state = {
    ...state,
    app: {
      ...state.app,
      slashCommands: commands,
    },
  };
  logStateChange("set-slash-commands", String(before), String(commands));
};

const setCustomSlashCommandDirs = (dirs: string[]) => {
  const before = state.app.customSlashCommandDirs;
  state = {
    ...state,
    app: {
      ...state.app,
      customSlashCommandDirs: dirs,
    },
  };
  logStateChange("set-custom-slash-command-dirs", String(before), String(dirs));
};

const setCustomSkillDirs = (dirs: string[]) => {
  const before = state.app.customSkillDirs;
  state = {
    ...state,
    app: {
      ...state.app,
      customSkillDirs: dirs,
    },
  };
  logStateChange("set-custom-skill-dirs", String(before), String(dirs));
};

const resetStdout = () => {
  const before = state.app.stdout;
  state = {
    ...state,
    app: { ...state.app, stdout: "" },
  };
  logStateChange("reset-stdout", before, "");
};

const appendToStdout = (line: string) => {
  const before = state.app.stdout;
  state = {
    ...state,
    app: {
      ...state.app,
      stdout: state.app.stdout + line,
    },
  };
  logStateChange(
    "append-to-stdout",
    String(before.length),
    String(state.app.stdout.length),
  );
};

const setDebugLog = (debugLog: boolean) => {
  state = {
    ...state,
    app: { ...state.app, debugLog },
  };
};

const setPromptHistoryPath = (promptHistoryPath: string) => {
  const before = state.app.promptHistoryPath;
  state = {
    ...state,
    app: { ...state.app, promptHistoryPath },
  };
  logStateChange("set-prompt-history-path", before, promptHistoryPath);
};

const setContextEntries = (contextEntries: ContextEntry[]) => {
  const before = state.app.contextEntries.length;
  state = {
    ...state,
    app: { ...state.app, contextEntries },
  };
  logStateChange(
    "set-context-entries",
    String(before),
    String(state.app.contextEntries.length),
  );
};

const setContextStr = (contextStr: string) => {
  const before = state.app.contextStr;
  state = {
    ...state,
    app: { ...state.app, contextStr },
  };
  logStateChange(
    "set-context-str",
    String(before.length),
    String(contextStr.length),
  );
};

const setSkillsStr = (skillsStr: string) => {
  const before = state.app.skillsStr;
  state = {
    ...state,
    app: { ...state.app, skillsStr },
  };
  logStateChange(
    "set-skills-str",
    String(before.length),
    String(skillsStr.length),
  );
};

const setSkills = (skills: Skill[]) => {
  const before = state.app.skills.length;
  state = {
    ...state,
    app: {
      ...state.app,
      skills,
    },
  };
  logStateChange("set-skills", String(before), String(state.app.skills.length));
};

const setRl = (rl: readline.Interface | null) => {
  const before = state.app.rl;
  state = {
    ...state,
    app: { ...state.app, rl },
  };
  logStateChange("set-rl", String(before), String(rl));
};

const setSpinnerTimeout = (timeout: NodeJS.Timeout | null) => {
  const before = state.app.spinnerTimeout;
  state = {
    ...state,
    app: { ...state.app, spinnerTimeout: timeout },
  };
  logStateChange("set-spinner-timeout", String(before), String(timeout));
};

const setApiStartTime = () => {
  const before = state.app.apiStartTime;
  const now = Date.now();
  state = {
    ...state,
    app: { ...state.app, apiStartTime: now },
  };
  logStateChange("set-api-start-time", String(before), String(now));
};

const setApiEndTime = () => {
  const before = state.app.apiEndTime;
  const now = Date.now();
  state = {
    ...state,
    app: { ...state.app, apiEndTime: now },
  };
  logStateChange("set-api-end-time", String(before), String(now));
};

const resetState = () => {
  state = structuredClone(initialState);
  logStateChange("reset-state", "[truncating]", stringify(state));
};

export const actions = {
  appendToMessageParams,
  appendToMessageUsages,
  setModel,
  setProvider,
  setBaseURL,
  setPricingPerModel,
  setKeymapEditPrompt,
  setKeymapEditPastePrompt,
  setKeymapPromptHistory,
  setKeymapClear,
  resetMessageUsages,
  resetMessageParams,
  setQuestionAbortController,
  setApiStreamAbortController,
  setEditorInputValue,
  setSlashCommands,
  setCustomSlashCommandDirs,
  setCustomSkillDirs,
  resetStdout,
  appendToStdout,
  setDebugLog,
  setPromptHistoryPath,
  setContextEntries,
  setContextStr,
  setSkillsStr,
  setSkills,
  setRl,
  setSpinnerTimeout,
  setApiStartTime,
  setApiEndTime,
  resetState,
};
