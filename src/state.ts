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

type Action =
  | {
      type: "append-to-message-params";
      payload: ModelMessage;
    }
  | {
      type: "append-to-message-usages";
      payload: TokenUsage;
    }
  | {
      type: "set-model";
      payload: string;
    }
  | {
      type: "set-provider";
      payload: Provider;
    }
  | {
      type: "set-base-url";
      payload: string;
    }
  | {
      type: "set-pricing-per-model";
      payload: Record<string, ModelPricing>;
    }
  | {
      type: "set-keymap-edit-prompt";
      payload: Key;
    }
  | {
      type: "set-keymap-edit-paste-prompt";
      payload: Key;
    }
  | {
      type: "set-keymap-prompt-history";
      payload: Key;
    }
  | {
      type: "set-keymap-clear";
      payload: Key;
    }
  | {
      type: "reset-message-usages";
    }
  | {
      type: "reset-message-params";
    }
  | {
      type: "set-question-abort-controller";
      payload: AbortController | null;
    }
  | {
      type: "set-api-stream-abort-controller";
      payload: AbortController | null;
    }
  | {
      type: "set-editor-input-value";
      payload: string | null;
    }
  | {
      type: "set-slash-commands";
      payload: SlashCommand[];
    }
  | {
      type: "set-custom-slash-command-dirs";
      payload: string[];
    }
  | {
      type: "set-custom-skill-dirs";
      payload: string[];
    }
  | {
      type: "reset-stdout";
    }
  | {
      type: "append-to-stdout";
      payload: string;
    }
  | {
      type: "set-debug-log";
      payload: boolean;
    }
  | {
      type: "set-prompt-history-path";
      payload: string;
    }
  | {
      type: "set-context-entries";
      payload: ContextEntry[];
    }
  | {
      type: "set-context-str";
      payload: string;
    }
  | {
      type: "set-skills-str";
      payload: string;
    }
  | {
      type: "set-skills";
      payload: Skill[];
    }
  | {
      type: "set-rl";
      payload: readline.Interface | null;
    }
  | {
      type: "set-spinner-timeout";
      payload: NodeJS.Timeout | null;
    }
  | {
      type: "set-api-start-time";
    }
  | {
      type: "set-api-end-time";
    }
  | {
      type: "reset-state";
    };

export const dispatch = (action: Action) => {
  state = reducer(getState(), action);
};

const logStateChange = (actionType: string, before: string, after: string) => {
  debugLog(`dispatch ${actionType}: before=${before}, after=${after}`);
};

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "append-to-message-params": {
      const before = state.app.messageParams;
      const next = {
        ...state,
        app: {
          ...state.app,
          messageParams: [...state.app.messageParams, action.payload],
        },
      };
      logStateChange(
        action.type,
        String(before.length),
        String(next.app.messageParams.length),
      );
      return next;
    }
    case "append-to-message-usages": {
      const before = state.app.messageUsages;
      const next = {
        ...state,
        app: {
          ...state.app,
          messageUsages: [...state.app.messageUsages, action.payload],
        },
      };
      logStateChange(
        action.type,
        String(before.length),
        String(next.app.messageUsages.length),
      );
      return next;
    }
    case "set-model": {
      const before = state.config.model;
      const next = {
        ...state,
        config: { ...state.config, model: action.payload },
      };
      logStateChange(action.type, before, action.payload);
      return next;
    }
    case "set-provider": {
      const before = state.config.provider;
      const next = {
        ...state,
        config: { ...state.config, provider: action.payload },
      };
      logStateChange(action.type, before, action.payload);
      return next;
    }
    case "set-base-url": {
      const before = state.config.baseURL;
      const next = {
        ...state,
        config: { ...state.config, baseURL: action.payload },
      };
      logStateChange(action.type, String(before), action.payload);
      return next;
    }
    case "set-pricing-per-model": {
      const before = state.config.pricingPerModel;
      const next = {
        ...state,
        config: { ...state.config, pricingPerModel: action.payload },
      };
      logStateChange(action.type, stringify(before), stringify(action.payload));
      return next;
    }
    case "set-keymap-edit-prompt": {
      const before = state.config.keymapEditPrompt;
      const next = {
        ...state,
        config: { ...state.config, keymapEditPrompt: action.payload },
      };
      logStateChange(action.type, stringify(before), stringify(action.payload));
      return next;
    }
    case "set-keymap-edit-paste-prompt": {
      const before = state.config.keymapEditPastePrompt;
      const next = {
        ...state,
        config: {
          ...state.config,
          keymapEditPastePrompt: action.payload,
        },
      };
      logStateChange(action.type, stringify(before), stringify(action.payload));
      return next;
    }
    case "set-keymap-prompt-history": {
      const before = state.config.keymapPromptHistory;
      const next = {
        ...state,
        config: {
          ...state.config,
          keymapPromptHistory: action.payload,
        },
      };
      logStateChange(action.type, stringify(before), stringify(action.payload));
      return next;
    }
    case "set-keymap-clear": {
      const before = state.config.keymapClear;
      const next = {
        ...state,
        config: { ...state.config, keymapClear: action.payload },
      };
      logStateChange(action.type, stringify(before), stringify(action.payload));
      return next;
    }
    case "reset-message-usages": {
      const before = state.app.messageUsages.length;
      const next = {
        ...state,
        app: { ...state.app, messageUsages: [] },
      };
      logStateChange(action.type, String(before), "0");
      return next;
    }
    case "reset-message-params": {
      const before = state.app.messageParams.length;
      const next = {
        ...state,
        app: { ...state.app, messageParams: [] },
      };
      logStateChange(action.type, String(before), "0");
      return next;
    }
    case "set-question-abort-controller": {
      const before = state.abortControllers.question;
      const next = {
        ...state,
        abortControllers: {
          ...state.abortControllers,
          question: action.payload,
        },
      };
      logStateChange(action.type, String(before), String(action.payload));
      return next;
    }
    case "set-api-stream-abort-controller": {
      const before = state.abortControllers.apiStream;
      const next = {
        ...state,
        abortControllers: {
          ...state.abortControllers,
          apiStream: action.payload,
        },
      };
      logStateChange(action.type, String(before), String(action.payload));
      return next;
    }
    case "set-editor-input-value": {
      const before = state.app.editorInputValue;
      const next = {
        ...state,
        app: {
          ...state.app,
          editorInputValue: action.payload,
        },
      };
      logStateChange(action.type, String(before), String(action.payload));
      return next;
    }
    case "set-slash-commands": {
      const before = state.app.slashCommands;
      const next = {
        ...state,
        app: {
          ...state.app,
          slashCommands: action.payload,
        },
      };
      logStateChange(action.type, String(before), String(action.payload));
      return next;
    }
    case "set-custom-slash-command-dirs": {
      const before = state.app.customSlashCommandDirs;
      const next = {
        ...state,
        app: {
          ...state.app,
          customSlashCommandDirs: action.payload,
        },
      };
      logStateChange(action.type, String(before), String(action.payload));
      return next;
    }
    case "set-custom-skill-dirs": {
      const before = state.app.customSkillDirs;
      const next = {
        ...state,
        app: {
          ...state.app,
          customSkillDirs: action.payload,
        },
      };
      logStateChange(action.type, String(before), String(action.payload));
      return next;
    }
    case "reset-stdout": {
      const before = state.app.stdout;
      const next = {
        ...state,
        app: { ...state.app, stdout: "" },
      };
      logStateChange(action.type, before, "");
      return next;
    }
    case "append-to-stdout": {
      const before = state.app.stdout;
      const next = {
        ...state,
        app: {
          ...state.app,
          stdout: state.app.stdout + action.payload,
        },
      };
      logStateChange(
        action.type,
        String(before.length),
        String(next.app.stdout.length),
      );
      return next;
    }
    case "set-debug-log": {
      const next = {
        ...state,
        app: { ...state.app, debugLog: action.payload },
      };
      return next;
    }
    case "set-prompt-history-path": {
      const before = state.app.promptHistoryPath;
      const next = {
        ...state,
        app: { ...state.app, promptHistoryPath: action.payload },
      };
      logStateChange(action.type, before, action.payload);
      return next;
    }
    case "set-context-entries": {
      const before = state.app.contextEntries.length;
      const next = {
        ...state,
        app: { ...state.app, contextEntries: action.payload },
      };
      logStateChange(
        action.type,
        String(before),
        String(next.app.contextEntries.length),
      );
      return next;
    }
    case "set-context-str": {
      const before = state.app.contextStr;
      const next = {
        ...state,
        app: { ...state.app, contextStr: action.payload },
      };
      logStateChange(
        action.type,
        String(before.length),
        String(action.payload.length),
      );
      return next;
    }
    case "set-skills-str": {
      const before = state.app.skillsStr;
      const next = {
        ...state,
        app: { ...state.app, skillsStr: action.payload },
      };
      logStateChange(
        action.type,
        String(before.length),
        String(action.payload.length),
      );
      return next;
    }
    case "set-skills": {
      const before = state.app.skills.length;
      const next = {
        ...state,
        app: {
          ...state.app,
          skills: action.payload,
        },
      };
      logStateChange(
        action.type,
        String(before),
        String(next.app.skills.length),
      );
      return next;
    }
    case "set-rl": {
      const before = state.app.rl;
      const next = {
        ...state,
        app: { ...state.app, rl: action.payload },
      };
      logStateChange(action.type, String(before), String(action.payload));
      return next;
    }
    case "set-spinner-timeout": {
      const before = state.app.spinnerTimeout;
      const next = {
        ...state,
        app: { ...state.app, spinnerTimeout: action.payload },
      };
      logStateChange(action.type, String(before), String(action.payload));
      return next;
    }
    case "set-api-start-time": {
      const before = state.app.apiStartTime;
      const now = Date.now();
      const next = {
        ...state,
        app: { ...state.app, apiStartTime: now },
      };
      logStateChange(action.type, String(before), String(now));
      return next;
    }
    case "set-api-end-time": {
      const before = state.app.apiEndTime;
      const now = Date.now();
      const next = {
        ...state,
        app: { ...state.app, apiEndTime: now },
      };
      logStateChange(action.type, String(before), String(now));
      return next;
    }
    case "reset-state": {
      const next = structuredClone(initialState);
      logStateChange(action.type, "[truncating]", stringify(next));
      return next;
    }
    default: {
      return state;
    }
  }
};

const appendToMessageParams = (message: ModelMessage): Action => {
  return {
    type: "append-to-message-params",
    payload: message,
  };
};

const appendToMessageUsages = (message: TokenUsage): Action => {
  return {
    type: "append-to-message-usages",
    payload: message,
  };
};

const setModel = (model: string): Action => {
  return { type: "set-model", payload: model };
};

const setProvider = (provider: Provider): Action => {
  return { type: "set-provider", payload: provider };
};

const setBaseURL = (baseURL: string): Action => {
  return { type: "set-base-url", payload: baseURL };
};

const setPricingPerModel = (pricing: Record<string, ModelPricing>): Action => {
  return { type: "set-pricing-per-model", payload: pricing };
};

const setKeymapEditPrompt = (keymap: Key): Action => {
  return { type: "set-keymap-edit-prompt", payload: keymap };
};

const setKeymapEditPastePrompt = (keymap: Key): Action => {
  return { type: "set-keymap-edit-paste-prompt", payload: keymap };
};

const setKeymapPromptHistory = (keymap: Key): Action => {
  return { type: "set-keymap-prompt-history", payload: keymap };
};

const setKeymapClear = (keymap: Key): Action => {
  return { type: "set-keymap-clear", payload: keymap };
};

const resetMessageUsages = (): Action => {
  return { type: "reset-message-usages" };
};

const resetMessageParams = (): Action => {
  return { type: "reset-message-params" };
};

const setQuestionAbortController = (
  controller: AbortController | null,
): Action => {
  return { type: "set-question-abort-controller", payload: controller };
};

const setApiStreamAbortController = (
  controller: AbortController | null,
): Action => {
  return { type: "set-api-stream-abort-controller", payload: controller };
};

const setEditorInputValue = (value: string | null): Action => {
  return { type: "set-editor-input-value", payload: value };
};

const setSlashCommands = (commands: SlashCommand[]): Action => {
  return { type: "set-slash-commands", payload: commands };
};

const setCustomSlashCommandDirs = (dirs: string[]): Action => {
  return { type: "set-custom-slash-command-dirs", payload: dirs };
};

const setCustomSkillDirs = (dirs: string[]): Action => {
  return { type: "set-custom-skill-dirs", payload: dirs };
};

const resetStdout = (): Action => {
  return { type: "reset-stdout" };
};

const appendToStdout = (line: string): Action => {
  return { type: "append-to-stdout", payload: line };
};

const setDebugLog = (debugLog: boolean): Action => {
  return { type: "set-debug-log", payload: debugLog };
};

const setPromptHistoryPath = (promptHistoryPath: string): Action => {
  return { type: "set-prompt-history-path", payload: promptHistoryPath };
};

const setContextEntries = (contextEntries: ContextEntry[]): Action => {
  return { type: "set-context-entries", payload: contextEntries };
};

const setContextStr = (contextStr: string): Action => {
  return { type: "set-context-str", payload: contextStr };
};

const setSkillsStr = (skillsStr: string): Action => {
  return { type: "set-skills-str", payload: skillsStr };
};

const setSkills = (skills: Skill[]): Action => {
  return { type: "set-skills", payload: skills };
};

const setRl = (rl: readline.Interface | null): Action => {
  return { type: "set-rl", payload: rl };
};

const setSpinnerTimeout = (timeout: NodeJS.Timeout | null): Action => {
  return { type: "set-spinner-timeout", payload: timeout };
};

const setApiStartTime = (): Action => {
  return { type: "set-api-start-time" };
};

const setApiEndTime = (): Action => {
  return { type: "set-api-end-time" };
};

const resetState = (): Action => {
  return { type: "reset-state" };
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

const getMessageParams = () => getState().app.messageParams;
const getMessageUsages = () => getState().app.messageUsages;
const getEditorInputValue = () => getState().app.editorInputValue;
const getSlashCommands = () => getState().app.slashCommands;
const getCustomSlashCommandDirs = () => getState().app.customSlashCommandDirs;
const getCustomSkillDirs = () => getState().app.customSkillDirs;
const getStdout = () => getState().app.stdout;
const getDebugLog = () => getState().app.debugLog;
const getPromptHistoryPath = () => getState().app.promptHistoryPath;
const getContextEntries = () => getState().app.contextEntries;
const getContextStr = () => getState().app.contextStr;
const getSkillsStr = () => getState().app.skillsStr;
const getSkills = () => getState().app.skills;
const getRl = () => getState().app.rl;
const getSpinnerTimeout = () => getState().app.spinnerTimeout;
const getApiStartTime = () => getState().app.apiStartTime;
const getApiEndTime = () => getState().app.apiEndTime;
const getModel = () => getState().config.model;
const getProvider = () => getState().config.provider;
const getBaseURL = () => getState().config.baseURL;
const getPricingPerModel = () => getState().config.pricingPerModel;
const getKeymapEditPrompt = () => getState().config.keymapEditPrompt;
const getKeymapEditPastePrompt = () => getState().config.keymapEditPastePrompt;
const getKeymapPromptHistory = () => getState().config.keymapPromptHistory;
const getKeymapClear = () => getState().config.keymapClear;
const getQuestionAbortController = () => getState().abortControllers.question;
const getApiStreamAbortController = () => getState().abortControllers.apiStream;

export const selectors = {
  getMessageParams,
  getMessageUsages,
  getModel,
  getProvider,
  getBaseURL,
  getPricingPerModel,
  getKeymapEditPrompt,
  getKeymapEditPastePrompt,
  getKeymapPromptHistory,
  getKeymapClear,
  getQuestionAbortController,
  getApiStreamAbortController,
  getEditorInputValue,
  getSlashCommands,
  getCustomSlashCommandDirs,
  getCustomSkillDirs,
  getStdout,
  getDebugLog,
  getPromptHistoryPath,
  getContextEntries,
  getContextStr,
  getSkillsStr,
  getSkills,
  getRl,
  getSpinnerTimeout,
  getApiStartTime,
  getApiEndTime,
};
