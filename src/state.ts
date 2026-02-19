import type Anthropic from "@anthropic-ai/sdk";

interface State {
  interrupted: boolean;
  running: boolean;
  messageParams: Anthropic.Messages.MessageParam[];
  messageUsages: Anthropic.Messages.Usage[];
}

let state: State = {
  interrupted: false,
  running: true,
  messageParams: [],
  messageUsages: [],
};

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
      payload: Anthropic.Messages.MessageParam;
    }
  | {
      type: "append-to-message-responses";
      payload: Anthropic.Messages.Usage;
    };

export const dispatch = (action: Action) => {
  state = reducer(getState(), action);
};

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "set-interrupted": {
      return {
        ...state,
        interrupted: action.payload,
      };
    }
    case "set-running": {
      return {
        ...state,
        running: action.payload,
      };
    }
    case "append-to-message-params": {
      const withoutCacheMarkers = state.messageParams.map((message) => {
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
      });

      return {
        ...state,
        messageParams: [...withoutCacheMarkers, action.payload],
      };
    }
    case "append-to-message-responses": {
      return {
        ...state,
        messageUsages: [...state.messageUsages, action.payload],
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
    type: "append-to-message-responses",
    payload: message,
  };
};

export const actions = {
  setInterrupted,
  setRunning,
  appendToMessageParams,
  appendToMessageUsages,
};

const getInterrupted = () => getState().interrupted;
const getRunning = () => getState().running;
const getMessageParams = () => getState().messageParams;
const getMessageUsages = () => getState().messageUsages;

export const selectors = {
  getInterrupted,
  getRunning,
  getMessageParams,
  getMessageUsages,
};
