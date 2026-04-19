/* eslint-disable @typescript-eslint/no-base-to-string */
import type { ModelMessage } from "ai";
import {
  DEFAULT_CONFIG,
  MISSING,
  type DiffStyle,
  type Key,
  type ModelPricing,
  type Provider,
} from "./config.ts";
import { debugLog, stringify } from "./utils.ts";
import type { TokenUsage } from "./utils.ts";

interface State {
  appState: {
    interrupted: boolean;
    running: boolean;
    messageParams: ModelMessage[];
    messageUsages: TokenUsage[];
    editorInputValue: string | null;
    slashCommands: string[];
    stdout: string;
  };
  configState: {
    pricingPerModel: Record<string, ModelPricing>;
    model: string;
    baseURL: string | null;
    provider: Provider;
    disableUsageMessage: boolean;
    diffStyle: DiffStyle;
    keymaps: { editor: Key };
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
  },
  configState: {
    model: MISSING,
    provider: DEFAULT_CONFIG.provider,
    baseURL: null,
    disableUsageMessage: DEFAULT_CONFIG.disableUsageMessage,
    diffStyle: DEFAULT_CONFIG.diffStyle,
    pricingPerModel: structuredClone(DEFAULT_CONFIG.pricingPerModel),
    keymaps: structuredClone(DEFAULT_CONFIG.keymaps),
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
      type: "set-keymaps";
      payload: { editor: Key };
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
    case "set-keymaps": {
      const before = state.configState.keymaps;
      const next = {
        ...state,
        configState: { ...state.configState, keymaps: action.payload },
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

const setKeymaps = (keymaps: { editor: Key }): Action => {
  return { type: "set-keymaps", payload: keymaps };
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
  setKeymaps,
  truncateMessageParams,
  resetMessageUsages,
  resetMessageParams,
  setQuestionAbortController,
  setApiStreamAbortController,
  setEditorInputValue,
  setSlashCommands,
  resetStdout,
  appendToStdout,
  resetState,
};

const getInterrupted = () => getState().appState.interrupted;
const getRunning = () => getState().appState.running;
const getMessageParams = () => getState().appState.messageParams;
const getMessageUsages = () => getState().appState.messageUsages;
const getEditorInputValue = () => getState().appState.editorInputValue;
const getSlashCommands = () => getState().appState.slashCommands;
const getStdout = () => getState().appState.stdout;
const getModel = () => getState().configState.model;
const getProvider = () => getState().configState.provider;
const getBaseURL = () => getState().configState.baseURL;
const getPricingPerModel = () => getState().configState.pricingPerModel;
const getDisableUsageMessage = () => getState().configState.disableUsageMessage;
const getDiffStyle = () => getState().configState.diffStyle;
const getKeymaps = () => getState().configState.keymaps;
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
  getKeymaps,
  getQuestionAbortController,
  getApiStreamAbortController,
  getEditorInputValue,
  getSlashCommands,
  getStdout,
};
