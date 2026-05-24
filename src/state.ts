/* eslint-disable @typescript-eslint/no-base-to-string */
import type readline from "node:readline/promises";
import type { ModelMessage } from "ai";
import {
  DEFAULT_CONFIG,
  type DiffStyle,
  type Key,
  type ModelPricing,
  type Provider,
} from "./config.ts";
import { MISSING, stringify } from "./utils.ts";
import { debugLog } from "./log.ts";
import type { TokenUsage } from "./print.ts";
export type { EditorLog } from "./log.ts";
export type { ToolPrint } from "./tools.ts";
import type { ContextEntry, Skill } from "./context.ts";

export interface SlashCommand {
  name: string;
  filePath: string;
  content: string;
}

interface State {
  appState: {
    messageParams: ModelMessage[];
    messageUsages: TokenUsage[];
    editorInputValue: string | null;
    slashCommands: SlashCommand[];
    customSlashCommandDirs: string[];
    customSkillDirs: string[];
    stdout: string;
    debugLog: boolean;
    editorLog: boolean;
    editorLogPath: string;
    contextEntries: ContextEntry[];
    contextStr: string;
    skillsStr: string;
    skills: Skill[];
    rl: readline.Interface | null;
    spinnerTimeout: NodeJS.Timeout | null;
    apiStartTime: number | null;
    apiEndTime: number | null;
  };
  configState: {
    pricingPerModel: Record<string, ModelPricing>;
    model: string;
    baseURL: string | null;
    provider: Provider;
    diffStyle: DiffStyle;
    keymapEdit: Key;
    keymapEditPaste: Key;
    keymapEditLog: Key;
    keymapClear: Key;
  };
  abortControllers: {
    question: AbortController | null;
    apiStream: AbortController | null;
  };
}

const initialState: State = {
  appState: {
    messageParams: [],
    messageUsages: [],
    editorInputValue: null,
    slashCommands: [],
    customSlashCommandDirs: [],
    customSkillDirs: [],
    stdout: "",
    debugLog: false,
    editorLog: false,
    editorLogPath: "",
    contextEntries: [],
    contextStr: "",
    skillsStr: "",
    skills: [],
    rl: null,
    spinnerTimeout: null,
    apiStartTime: null,
    apiEndTime: null,
  },
  configState: {
    model: MISSING,
    provider: DEFAULT_CONFIG.provider,
    baseURL: null,
    diffStyle: DEFAULT_CONFIG.diffStyle,
    pricingPerModel: structuredClone(DEFAULT_CONFIG.pricingPerModel),
    keymapEdit: structuredClone(DEFAULT_CONFIG.keymaps.edit),
    keymapEditPaste: structuredClone(DEFAULT_CONFIG.keymaps.editPaste),
    keymapEditLog: structuredClone(DEFAULT_CONFIG.keymaps.editLog),
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
      type: "set-diff-style";
      payload: "unified" | "lines";
    }
  | {
      type: "set-keymap-edit";
      payload: Key;
    }
  | {
      type: "set-keymap-edit-paste";
      payload: Key;
    }
  | {
      type: "set-keymap-edit-log";
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
      type: "set-editor-log";
      payload: boolean;
    }
  | {
      type: "set-editor-log-path";
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
      const before = state.appState.messageParams;
      const next = {
        ...state,
        appState: {
          ...state.appState,
          messageParams: [...state.appState.messageParams, action.payload],
        },
      };
      logStateChange(
        action.type,
        String(before.length),
        String(next.appState.messageParams.length),
      );
      return next;
    }
    case "append-to-message-usages": {
      const before = state.appState.messageUsages;
      const next = {
        ...state,
        appState: {
          ...state.appState,
          messageUsages: [...state.appState.messageUsages, action.payload],
        },
      };
      logStateChange(
        action.type,
        String(before.length),
        String(next.appState.messageUsages.length),
      );
      return next;
    }
    case "set-model": {
      const before = state.configState.model;
      const next = {
        ...state,
        configState: { ...state.configState, model: action.payload },
      };
      logStateChange(action.type, before, action.payload);
      return next;
    }
    case "set-provider": {
      const before = state.configState.provider;
      const next = {
        ...state,
        configState: { ...state.configState, provider: action.payload },
      };
      logStateChange(action.type, before, action.payload);
      return next;
    }
    case "set-base-url": {
      const before = state.configState.baseURL;
      const next = {
        ...state,
        configState: { ...state.configState, baseURL: action.payload },
      };
      logStateChange(action.type, String(before), action.payload);
      return next;
    }
    case "set-pricing-per-model": {
      const before = state.configState.pricingPerModel;
      const next = {
        ...state,
        configState: { ...state.configState, pricingPerModel: action.payload },
      };
      logStateChange(action.type, stringify(before), stringify(action.payload));
      return next;
    }
    case "set-diff-style": {
      const before = state.configState.diffStyle;
      const next = {
        ...state,
        configState: { ...state.configState, diffStyle: action.payload },
      };
      logStateChange(action.type, before, action.payload);
      return next;
    }
    case "set-keymap-edit": {
      const before = state.configState.keymapEdit;
      const next = {
        ...state,
        configState: { ...state.configState, keymapEdit: action.payload },
      };
      logStateChange(action.type, stringify(before), stringify(action.payload));
      return next;
    }
    case "set-keymap-edit-paste": {
      const before = state.configState.keymapEditPaste;
      const next = {
        ...state,
        configState: { ...state.configState, keymapEditPaste: action.payload },
      };
      logStateChange(action.type, stringify(before), stringify(action.payload));
      return next;
    }
    case "set-keymap-edit-log": {
      const before = state.configState.keymapEditLog;
      const next = {
        ...state,
        configState: { ...state.configState, keymapEditLog: action.payload },
      };
      logStateChange(action.type, stringify(before), stringify(action.payload));
      return next;
    }
    case "set-keymap-clear": {
      const before = state.configState.keymapClear;
      const next = {
        ...state,
        configState: { ...state.configState, keymapClear: action.payload },
      };
      logStateChange(action.type, stringify(before), stringify(action.payload));
      return next;
    }
    case "reset-message-usages": {
      const before = state.appState.messageUsages.length;
      const next = {
        ...state,
        appState: { ...state.appState, messageUsages: [] },
      };
      logStateChange(action.type, String(before), "0");
      return next;
    }
    case "reset-message-params": {
      const before = state.appState.messageParams.length;
      const next = {
        ...state,
        appState: { ...state.appState, messageParams: [] },
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
      const before = state.appState.editorInputValue;
      const next = {
        ...state,
        appState: {
          ...state.appState,
          editorInputValue: action.payload,
        },
      };
      logStateChange(action.type, String(before), String(action.payload));
      return next;
    }
    case "set-slash-commands": {
      const before = state.appState.slashCommands;
      const next = {
        ...state,
        appState: {
          ...state.appState,
          slashCommands: action.payload,
        },
      };
      logStateChange(action.type, String(before), String(action.payload));
      return next;
    }
    case "set-custom-slash-command-dirs": {
      const before = state.appState.customSlashCommandDirs;
      const next = {
        ...state,
        appState: {
          ...state.appState,
          customSlashCommandDirs: action.payload,
        },
      };
      logStateChange(action.type, String(before), String(action.payload));
      return next;
    }
    case "set-custom-skill-dirs": {
      const before = state.appState.customSkillDirs;
      const next = {
        ...state,
        appState: {
          ...state.appState,
          customSkillDirs: action.payload,
        },
      };
      logStateChange(action.type, String(before), String(action.payload));
      return next;
    }
    case "reset-stdout": {
      const before = state.appState.stdout;
      const next = {
        ...state,
        appState: { ...state.appState, stdout: "" },
      };
      logStateChange(action.type, before, "");
      return next;
    }
    case "append-to-stdout": {
      const before = state.appState.stdout;
      const next = {
        ...state,
        appState: {
          ...state.appState,
          stdout: state.appState.stdout + action.payload,
        },
      };
      logStateChange(
        action.type,
        String(before.length),
        String(next.appState.stdout.length),
      );
      return next;
    }
    case "set-debug-log": {
      const next = {
        ...state,
        appState: { ...state.appState, debugLog: action.payload },
      };
      return next;
    }
    case "set-editor-log": {
      const before = state.appState.editorLog;
      const next = {
        ...state,
        appState: { ...state.appState, editorLog: action.payload },
      };
      logStateChange(action.type, String(before), String(action.payload));
      return next;
    }
    case "set-editor-log-path": {
      const before = state.appState.editorLogPath;
      const next = {
        ...state,
        appState: { ...state.appState, editorLogPath: action.payload },
      };
      logStateChange(action.type, before, action.payload);
      return next;
    }
    case "set-context-entries": {
      const before = state.appState.contextEntries.length;
      const next = {
        ...state,
        appState: { ...state.appState, contextEntries: action.payload },
      };
      logStateChange(
        action.type,
        String(before),
        String(next.appState.contextEntries.length),
      );
      return next;
    }
    case "set-context-str": {
      const before = state.appState.contextStr;
      const next = {
        ...state,
        appState: { ...state.appState, contextStr: action.payload },
      };
      logStateChange(
        action.type,
        String(before.length),
        String(action.payload.length),
      );
      return next;
    }
    case "set-skills-str": {
      const before = state.appState.skillsStr;
      const next = {
        ...state,
        appState: { ...state.appState, skillsStr: action.payload },
      };
      logStateChange(
        action.type,
        String(before.length),
        String(action.payload.length),
      );
      return next;
    }
    case "set-skills": {
      const before = state.appState.skills.length;
      const next = {
        ...state,
        appState: {
          ...state.appState,
          skills: action.payload,
        },
      };
      logStateChange(
        action.type,
        String(before),
        String(next.appState.skills.length),
      );
      return next;
    }
    case "set-rl": {
      const before = state.appState.rl;
      const next = {
        ...state,
        appState: { ...state.appState, rl: action.payload },
      };
      logStateChange(action.type, String(before), String(action.payload));
      return next;
    }
    case "set-spinner-timeout": {
      const before = state.appState.spinnerTimeout;
      const next = {
        ...state,
        appState: { ...state.appState, spinnerTimeout: action.payload },
      };
      logStateChange(action.type, String(before), String(action.payload));
      return next;
    }
    case "set-api-start-time": {
      const before = state.appState.apiStartTime;
      const now = Date.now();
      const next = {
        ...state,
        appState: { ...state.appState, apiStartTime: now },
      };
      logStateChange(action.type, String(before), String(now));
      return next;
    }
    case "set-api-end-time": {
      const before = state.appState.apiEndTime;
      const now = Date.now();
      const next = {
        ...state,
        appState: { ...state.appState, apiEndTime: now },
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

const setDiffStyle = (diffStyle: DiffStyle): Action => {
  return { type: "set-diff-style", payload: diffStyle };
};

const setKeymapEdit = (keymap: Key): Action => {
  return { type: "set-keymap-edit", payload: keymap };
};

const setKeymapEditPaste = (keymap: Key): Action => {
  return { type: "set-keymap-edit-paste", payload: keymap };
};

const setKeymapEditLog = (keymap: Key): Action => {
  return { type: "set-keymap-edit-log", payload: keymap };
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

const setEditorLog = (editorLog: boolean): Action => {
  return { type: "set-editor-log", payload: editorLog };
};

const setEditorLogPath = (editorLogPath: string): Action => {
  return { type: "set-editor-log-path", payload: editorLogPath };
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
  setDiffStyle,
  setKeymapEdit,
  setKeymapEditPaste,
  setKeymapEditLog,
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
  setEditorLog,
  setEditorLogPath,
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

const getMessageParams = () => getState().appState.messageParams;
const getMessageUsages = () => getState().appState.messageUsages;
const getEditorInputValue = () => getState().appState.editorInputValue;
const getSlashCommands = () => getState().appState.slashCommands;
const getCustomSlashCommandDirs = () =>
  getState().appState.customSlashCommandDirs;
const getCustomSkillDirs = () => getState().appState.customSkillDirs;
const getStdout = () => getState().appState.stdout;
const getDebugLog = () => getState().appState.debugLog;
const getEditorLog = () => getState().appState.editorLog;
const getEditorLogPath = () => getState().appState.editorLogPath;
const getContextEntries = () => getState().appState.contextEntries;
const getContextStr = () => getState().appState.contextStr;
const getSkillsStr = () => getState().appState.skillsStr;
const getSkills = () => getState().appState.skills;
const getRl = () => getState().appState.rl;
const getSpinnerTimeout = () => getState().appState.spinnerTimeout;
const getApiStartTime = () => getState().appState.apiStartTime;
const getApiEndTime = () => getState().appState.apiEndTime;
const getModel = () => getState().configState.model;
const getProvider = () => getState().configState.provider;
const getBaseURL = () => getState().configState.baseURL;
const getPricingPerModel = () => getState().configState.pricingPerModel;
const getDiffStyle = () => getState().configState.diffStyle;
const getKeymapEdit = () => getState().configState.keymapEdit;
const getKeymapEditPaste = () => getState().configState.keymapEditPaste;
const getKeymapEditLog = () => getState().configState.keymapEditLog;
const getKeymapClear = () => getState().configState.keymapClear;
const getQuestionAbortController = () => getState().abortControllers.question;
const getApiStreamAbortController = () => getState().abortControllers.apiStream;

export const selectors = {
  getMessageParams,
  getMessageUsages,
  getModel,
  getProvider,
  getBaseURL,
  getPricingPerModel,
  getDiffStyle,
  getKeymapEdit,
  getKeymapEditPaste,
  getKeymapEditLog,
  getKeymapClear,
  getQuestionAbortController,
  getApiStreamAbortController,
  getEditorInputValue,
  getSlashCommands,
  getCustomSlashCommandDirs,
  getCustomSkillDirs,
  getStdout,
  getDebugLog,
  getEditorLog,
  getEditorLogPath,
  getContextEntries,
  getContextStr,
  getSkillsStr,
  getSkills,
  getRl,
  getSpinnerTimeout,
  getApiStartTime,
  getApiEndTime,
};
