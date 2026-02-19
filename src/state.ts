import type Anthropic from "@anthropic-ai/sdk";

interface State {
  interrupted: boolean;
  running: boolean;
  messages: Anthropic.Messages.MessageParam[];
  response: Anthropic.Messages.Message | undefined;
}

let state: State = {
  interrupted: false,
  running: true,
  messages: [],
  response: undefined,
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
      type: "append-to-messages";
      payload: Anthropic.Messages.MessageParam;
    }
  | {
      type: "set-response";
      payload: Anthropic.Messages.Message;
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
    case "append-to-messages": {
      return {
        ...state,
        messages: [...state.messages, action.payload],
      };
    }
    case "set-response": {
      return {
        ...state,
        response: action.payload,
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

const appendToMessages = (message: Anthropic.Messages.MessageParam): Action => {
  return {
    type: "append-to-messages",
    payload: message,
  };
};

const setResponse = (message: Anthropic.Messages.Message): Action => {
  return {
    type: "set-response",
    payload: message,
  };
};

export const actions = {
  setInterrupted,
  setRunning,
  appendToMessages,
  setResponse,
};

const getInterrupted = () => getState().interrupted;
const getRunning = () => getState().running;
const getMessages = () => getState().messages;
const getResponse = () => getState().response;

export const selectors = {
  getInterrupted,
  getRunning,
  getMessages,
  getResponse,
};
