interface State {
  interrupted: boolean;
  running: boolean;
}

let state: State = {
  interrupted: false,
  running: true,
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

export const actions = {
  setInterrupted,
  setRunning,
};

const getInterrupted = () => getState().interrupted;
const getRunning = () => getState().running;

export const selectors = {
  getInterrupted,
  getRunning,
};
