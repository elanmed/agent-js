/* eslint-disable @typescript-eslint/no-base-to-string */
import type * as readline from "node:readline/promises";
import type { ModelMessage } from "ai";
import {
  DEFAULT_CONFIG,
  MISSING,
  type DiffStyle,
  type Key,
  type ModelPricing,
  type Provider,
} from "./config.ts";
import { stringify } from "./utils.ts";
import { debugLog } from "./log.ts";
import type { TokenUsage } from "./utils.ts";
export type { DebugLog, EditorLog } from "./log.ts";
export type { ToolLog } from "./tools.ts";

interface State {
  appState: {
    interrupted: boolean;
    running: boolean;
    messageParams: ModelMessage[];
    messageUsages: TokenUsage[];
    editorInputValue: string | null;
    slashCommands: string[];
    stdout: string;
    debugLog: boolean;
    editorLog: boolean;
    agentsMdFilesStr: string;
    rl: readline.Interface | null;
  };
  configState: {
    pricingPerModel: Record<string, ModelPricing>;
    model: string;
    baseURL: string | null;
    provider: Provider;
    disableUsageMessage: boolean;
    diffStyle: DiffStyle;
    keymapEdit: Key;
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
    interrupted: false,
    running: true,
    messageParams: [],
    messageUsages: [],
    editorInputValue: null,
    slashCommands: [],
    stdout: "",
    debugLog: false,
    editorLog: false,
    agentsMdFilesStr: "",
    rl: null,
  },
  configState: {
    model: MISSING,
    provider: DEFAULT_CONFIG.provider,
    baseURL: null,
    disableUsageMessage: DEFAULT_CONFIG.disableUsageMessage,
    diffStyle: DEFAULT_CONFIG.diffStyle,
    pricingPerModel: structuredClone(DEFAULT_CONFIG.pricingPerModel),
    keymapEdit: structuredClone(DEFAULT_CONFIG.keymaps.edit),
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
      type: "set-interrupted";
      payload: boolean;
    }
  | {
      type: "set-running";
      payload: boolean;
    }
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
      type: "set-disable-usage-message";
      payload: boolean;
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
      type: "set-keymap-edit-log";
      payload: Key;
    }
  | {
      type: "set-keymap-clear";
      payload: Key;
    }
  | {
      type: "truncate-message-params";
      payload: number;
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
      type: "set-agents-md-files-str";
      payload: string;
    }
  | {
      type: "set-rl";
      payload: readline.Interface | null;
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
    case "set-interrupted": {
      const before = state.appState.interrupted;
      const next = {
        ...state,
        appState: { ...state.appState, interrupted: action.payload },
      };
      logStateChange(action.type, String(before), String(action.payload));
      return next;
    }
    case "set-running": {
      const before = state.appState.running;
      const next = {
        ...state,
        appState: { ...state.appState, running: action.payload },
      };
      logStateChange(action.type, String(before), String(action.payload));
      return next;
    }
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
    case "set-disable-usage-message": {
      const before = state.configState.disableUsageMessage;
      const next = {
        ...state,
        configState: {
          ...state.configState,
          disableUsageMessage: action.payload,
        },
      };
      logStateChange(action.type, String(before), String(action.payload));
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
    case "truncate-message-params": {
      const before = state.appState.messageParams.length;
      const next = {
        ...state,
        appState: {
          ...state.appState,
          messageParams: state.appState.messageParams.slice(0, action.payload),
        },
      };
      logStateChange(
        action.type,
        String(before),
        String(next.appState.messageParams.length),
      );
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
      logStateChange(action.type, "", String(action.payload));
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
    case "set-agents-md-files-str": {
      const before = state.appState.agentsMdFilesStr;
      const next = {
        ...state,
        appState: { ...state.appState, agentsMdFilesStr: action.payload },
      };
      logStateChange(
        action.type,
        String(before.length),
        String(action.payload.length),
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
    case "reset-state": {
      const next = structuredClone(initialState);
      logStateChange(action.type, "[truncating]", stringify(next));
      return next;
    }
  }
};

const setInterrupted = (interrupted: boolean): Action => {
  return {
    type: "set-interrupted",
    payload: interrupted,
  };
};

const setRunning = (running: boolean): Action => {
  return {
    type: "set-running",
    payload: running,
  };
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

const setDisableUsageMessage = (disabled: boolean): Action => {
  return { type: "set-disable-usage-message", payload: disabled };
};

const setDiffStyle = (diffStyle: DiffStyle): Action => {
  return { type: "set-diff-style", payload: diffStyle };
};

const setKeymapEdit = (keymap: Key): Action => {
  return { type: "set-keymap-edit", payload: keymap };
};

const setKeymapEditLog = (keymap: Key): Action => {
  return { type: "set-keymap-edit-log", payload: keymap };
};

const setKeymapClear = (keymap: Key): Action => {
  return { type: "set-keymap-clear", payload: keymap };
};

const truncateMessageParams = (count: number): Action => {
  return { type: "truncate-message-params", payload: count };
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

const setSlashCommands = (commands: string[]): Action => {
  return { type: "set-slash-commands", payload: commands };
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

const setAgentsMdFilesStr = (agentsMdFilesStr: string): Action => {
  return { type: "set-agents-md-files-str", payload: agentsMdFilesStr };
};

const setRl = (rl: readline.Interface | null): Action => {
  return { type: "set-rl", payload: rl };
};

const resetState = (): Action => {
  return { type: "reset-state" };
};

export const actions = {
  setInterrupted,
  setRunning,
  appendToMessageParams,
  appendToMessageUsages,
  setModel,
  setProvider,
  setBaseURL,
  setPricingPerModel,
  setDisableUsageMessage,
  setDiffStyle,
  setKeymapEdit,
  setKeymapEditLog,
  setKeymapClear,
  truncateMessageParams,
  resetMessageUsages,
  resetMessageParams,
  setQuestionAbortController,
  setApiStreamAbortController,
  setEditorInputValue,
  setSlashCommands,
  resetStdout,
  appendToStdout,
  setDebugLog,
  setEditorLog,
  setAgentsMdFilesStr,
  setRl,
  resetState,
};

const getInterrupted = () => getState().appState.interrupted;
const getRunning = () => getState().appState.running;
const getMessageParams = () => getState().appState.messageParams;
const getMessageUsages = () => getState().appState.messageUsages;
const getEditorInputValue = () => getState().appState.editorInputValue;
const getSlashCommands = () => getState().appState.slashCommands;
const getStdout = () => getState().appState.stdout;
const getDebugLog = () => getState().appState.debugLog;
const getEditorLog = () => getState().appState.editorLog;
const getAgentsMdFilesStr = () => getState().appState.agentsMdFilesStr;
const getRl = () => getState().appState.rl;
const getModel = () => getState().configState.model;
const getProvider = () => getState().configState.provider;
const getBaseURL = () => getState().configState.baseURL;
const getPricingPerModel = () => getState().configState.pricingPerModel;
const getDisableUsageMessage = () => getState().configState.disableUsageMessage;
const getDiffStyle = () => getState().configState.diffStyle;
const getKeymapEdit = () => getState().configState.keymapEdit;
const getKeymapEditLog = () => getState().configState.keymapEditLog;
const getKeymapClear = () => getState().configState.keymapClear;
const getQuestionAbortController = () => getState().abortControllers.question;
const getApiStreamAbortController = () => getState().abortControllers.apiStream;

export const selectors = {
  getInterrupted,
  getRunning,
  getMessageParams,
  getMessageUsages,
  getModel,
  getProvider,
  getBaseURL,
  getPricingPerModel,
  getDisableUsageMessage,
  getDiffStyle,
  getKeymapEdit,
  getKeymapEditLog,
  getKeymapClear,
  getQuestionAbortController,
  getApiStreamAbortController,
  getEditorInputValue,
  getSlashCommands,
  getStdout,
  getDebugLog,
  getEditorLog,
  getAgentsMdFilesStr,
  getRl,
};
