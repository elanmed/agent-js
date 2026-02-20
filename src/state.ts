import type Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_CONFIG } from "./config.ts";
import { debugLog } from "./utils.ts";
import type { ModelPricing, SupportedModel } from "./utils.ts";

interface State {
  appState: {
    interrupted: boolean;
    running: boolean;
    messageParams: Anthropic.Messages.MessageParam[];
    messageUsages: Anthropic.Messages.Usage[];
  };
  configState: {
    pricingPerModel: Record<SupportedModel, ModelPricing>;
    model: SupportedModel;
    disableCostMessage: boolean;
  };
}

const initialState: State = {
  appState: {
    interrupted: false,
    running: true,
    messageParams: [],
    messageUsages: [],
  },
  configState: structuredClone(DEFAULT_CONFIG),
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
      payload: Anthropic.Messages.MessageParam;
    }
  | {
      type: "append-to-message-usages";
      payload: Anthropic.Messages.Usage;
    }
  | {
      type: "set-model";
      payload: SupportedModel;
    }
  | {
      type: "set-pricing-per-model";
      payload: Record<SupportedModel, ModelPricing>;
    }
  | {
      type: "set-disable-cost-message";
      payload: boolean;
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
      newState.appState.messageParams = newState.appState.messageParams.map(
        (message) => {
          if (typeof message.content === "string") {
            return message;
          }

          return {
            ...message,
            content: message.content.map((content) => ({
              ...content,
              cache_control: null,
            })),
          };
        },
      );
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
    case "set-pricing-per-model": {
      const newState = structuredClone(state);
      newState.configState.pricingPerModel = action.payload;
      return newState;
    }
    case "set-disable-cost-message": {
      const newState = structuredClone(state);
      newState.configState.disableCostMessage = action.payload;
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
  message: Anthropic.Messages.MessageParam,
): Action => {
  return {
    type: "append-to-message-params",
    payload: message,
  };
};

const appendToMessageUsages = (message: Anthropic.Messages.Usage): Action => {
  return {
    type: "append-to-message-usages",
    payload: message,
  };
};

const setModel = (model: SupportedModel): Action => {
  return { type: "set-model", payload: model };
};

const setPricingPerModel = (
  pricing: Record<SupportedModel, ModelPricing>,
): Action => {
  return { type: "set-pricing-per-model", payload: pricing };
};

const setDisableCostMessage = (disabled: boolean): Action => {
  return { type: "set-disable-cost-message", payload: disabled };
};

export const actions = {
  setInterrupted,
  setRunning,
  appendToMessageParams,
  appendToMessageUsages,
  setModel,
  setPricingPerModel,
  setDisableCostMessage,
};

const getInterrupted = () => getState().appState.interrupted;
const getRunning = () => getState().appState.running;
const getMessageParams = () => getState().appState.messageParams;
const getMessageUsages = () => getState().appState.messageUsages;
const getModel = () => getState().configState.model;
const getPricingPerModel = () => getState().configState.pricingPerModel;
const getDisableCostMessage = () => getState().configState.disableCostMessage;

export const selectors = {
  getInterrupted,
  getRunning,
  getMessageParams,
  getMessageUsages,
  getModel,
  getPricingPerModel,
  getDisableCostMessage,
};
