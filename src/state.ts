import type OpenAI from "openai";
import { DEFAULT_CONFIG, type DiffStyle } from "./config.ts";
import { debugLog } from "./utils.ts";
import type { ModelPricing, TokenUsage } from "./utils.ts";

interface State {
  appState: {
    interrupted: boolean;
    running: boolean;
    messageParams: OpenAI.Chat.ChatCompletionMessageParam[];
    messageUsages: TokenUsage[];
  };
  configState: {
    pricingPerModel: Record<string, ModelPricing>;
    model: string;
    baseURL: string | null;
    disableUsageMessage: boolean;
    diffStyle: DiffStyle;
  };
}

const initialState: State = {
  appState: {
    interrupted: false,
    running: true,
    messageParams: [],
    messageUsages: [],
  },
  configState: {
    model: DEFAULT_CONFIG.model,
    baseURL: null,
    disableUsageMessage: DEFAULT_CONFIG.disableUsageMessage,
    diffStyle: DEFAULT_CONFIG.diffStyle,
    pricingPerModel: structuredClone(DEFAULT_CONFIG.pricingPerModel),
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
      payload: OpenAI.Chat.ChatCompletionMessageParam;
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
      type: "set-base-url";
      payload: string | null;
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
    };

export const dispatch = (action: Action) => {
  debugLog(`dispatch: ${action.type}`);
  state = reducer(getState(), action);
};

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "set-interrupted": {
      const newState = structuredClone(state);
      newState.appState.interrupted = action.payload;
      return newState;
    }
    case "set-running": {
      const newState = structuredClone(state);
      newState.appState.running = action.payload;
      return newState;
    }
    case "append-to-message-params": {
      const newState = structuredClone(state);
      newState.appState.messageParams.push(action.payload);
      return newState;
    }
    case "append-to-message-usages": {
      const newState = structuredClone(state);
      newState.appState.messageUsages.push(action.payload);
      return newState;
    }
    case "set-model": {
      const newState = structuredClone(state);
      newState.configState.model = action.payload;
      return newState;
    }
    case "set-base-url": {
      const newState = structuredClone(state);
      newState.configState.baseURL = action.payload;
      return newState;
    }
    case "set-pricing-per-model": {
      const newState = structuredClone(state);
      newState.configState.pricingPerModel = action.payload;
      return newState;
    }
    case "set-disable-usage-message": {
      const newState = structuredClone(state);
      newState.configState.disableUsageMessage = action.payload;
      return newState;
    }
    case "set-diff-style": {
      const newState = structuredClone(state);
      newState.configState.diffStyle = action.payload;
      return newState;
    }
    case "truncate-message-params": {
      const newState = structuredClone(state);
      newState.appState.messageParams = newState.appState.messageParams.slice(
        0,
        action.payload,
      );
      return newState;
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

const appendToMessageParams = (
  message: OpenAI.Chat.ChatCompletionMessageParam,
): Action => {
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

const setBaseURL = (baseURL: string | null): Action => {
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

export const actions = {
  setInterrupted,
  setRunning,
  appendToMessageParams,
  appendToMessageUsages,
  setModel,
  setBaseURL,
  setPricingPerModel,
  setDisableUsageMessage,
  setDiffStyle,
  truncateMessageParams,
};

const getInterrupted = () => getState().appState.interrupted;
const getRunning = () => getState().appState.running;
const getMessageParams = () => getState().appState.messageParams;
const getMessageUsages = () => getState().appState.messageUsages;
const getModel = () => getState().configState.model;
const getBaseURL = () => getState().configState.baseURL;
const getPricingPerModel = () => getState().configState.pricingPerModel;
const getDisableUsageMessage = () => getState().configState.disableUsageMessage;
const getDiffStyle = () => getState().configState.diffStyle;

export const selectors = {
  getInterrupted,
  getRunning,
  getMessageParams,
  getMessageUsages,
  getModel,
  getBaseURL,
  getPricingPerModel,
  getDisableUsageMessage,
  getDiffStyle,
};
