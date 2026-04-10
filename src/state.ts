import type { ModelMessage } from "ai";
import { DEFAULT_CONFIG, type DiffStyle, type Provider } from "./config.ts";
import { debugLog } from "./utils.ts";
import type { ModelPricing, TokenUsage } from "./utils.ts";

export const MISSING = "MISSING" as const;

interface State {
  appState: {
    interrupted: boolean;
    running: boolean;
    messageParams: ModelMessage[];
    messageUsages: TokenUsage[];
    editorInputValue: string | null;
  };
  configState: {
    pricingPerModel: Record<string, ModelPricing>;
    model: string;
    provider: Provider;
    baseURL: string;
    disableUsageMessage: boolean;
    diffStyle: DiffStyle;
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
  },
  configState: {
    model: MISSING,
    provider: DEFAULT_CONFIG.provider,
    baseURL: MISSING,
    disableUsageMessage: DEFAULT_CONFIG.disableUsageMessage,
    diffStyle: DEFAULT_CONFIG.diffStyle,
    pricingPerModel: structuredClone(DEFAULT_CONFIG.pricingPerModel),
  },
  abortControllers: {
    question: null,
    apiStream: null,
  },
};

let state: State = structuredClone(initialState);

export const getState = () => state;

export const resetState = () => {
  state = structuredClone(initialState);
};

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
    };

export const dispatch = (action: Action) => {
  debugLog(`dispatch: ${action.type}`);
  state = reducer(getState(), action);
};

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "set-interrupted": {
      return {
        ...state,
        appState: { ...state.appState, interrupted: action.payload },
      };
    }
    case "set-running": {
      return {
        ...state,
        appState: { ...state.appState, running: action.payload },
      };
    }
    case "append-to-message-params": {
      return {
        ...state,
        appState: {
          ...state.appState,
          messageParams: [...state.appState.messageParams, action.payload],
        },
      };
    }
    case "append-to-message-usages": {
      return {
        ...state,
        appState: {
          ...state.appState,
          messageUsages: [...state.appState.messageUsages, action.payload],
        },
      };
    }
    case "set-model": {
      return {
        ...state,
        configState: { ...state.configState, model: action.payload },
      };
    }
    case "set-provider": {
      return {
        ...state,
        configState: { ...state.configState, provider: action.payload },
      };
    }
    case "set-base-url": {
      return {
        ...state,
        configState: { ...state.configState, baseURL: action.payload },
      };
    }
    case "set-pricing-per-model": {
      return {
        ...state,
        configState: { ...state.configState, pricingPerModel: action.payload },
      };
    }
    case "set-disable-usage-message": {
      return {
        ...state,
        configState: {
          ...state.configState,
          disableUsageMessage: action.payload,
        },
      };
    }
    case "set-diff-style": {
      return {
        ...state,
        configState: { ...state.configState, diffStyle: action.payload },
      };
    }
    case "truncate-message-params": {
      return {
        ...state,
        appState: {
          ...state.appState,
          messageParams: state.appState.messageParams.slice(0, action.payload),
        },
      };
    }
    case "reset-message-usages": {
      return {
        ...state,
        appState: { ...state.appState, messageUsages: [] },
      };
    }
    case "reset-message-params": {
      return {
        ...state,
        appState: { ...state.appState, messageParams: [] },
      };
    }
    case "set-question-abort-controller": {
      return {
        ...state,
        abortControllers: {
          ...state.abortControllers,
          question: action.payload,
        },
      };
    }
    case "set-api-stream-abort-controller": {
      return {
        ...state,
        abortControllers: {
          ...state.abortControllers,
          apiStream: action.payload,
        },
      };
    }
    case "set-editor-input-value": {
      return {
        ...state,
        appState: {
          ...state.appState,
          editorInputValue: action.payload,
        },
      };
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
  truncateMessageParams,
  resetMessageUsages,
  resetMessageParams,
  setQuestionAbortController,
  setApiStreamAbortController,
  setEditorInputValue,
};

const getInterrupted = () => getState().appState.interrupted;
const getRunning = () => getState().appState.running;
const getMessageParams = () => getState().appState.messageParams;
const getMessageUsages = () => getState().appState.messageUsages;
const getEditorInputValue = () => getState().appState.editorInputValue;
const getModel = () => getState().configState.model;
const getProvider = () => getState().configState.provider;
const getBaseURL = () => getState().configState.baseURL;
const getPricingPerModel = () => getState().configState.pricingPerModel;
const getDisableUsageMessage = () => getState().configState.disableUsageMessage;
const getDiffStyle = () => getState().configState.diffStyle;
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
  getQuestionAbortController,
  getApiStreamAbortController,
  getEditorInputValue,
};
