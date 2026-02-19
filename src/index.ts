import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { actions, dispatch, selectors } from "./state.ts";

const rl = readline.createInterface({ input, output });

let currentAbortController: AbortController | null = null;

rl.on("SIGINT", () => {
  if (currentAbortController) {
    currentAbortController.abort();
  }

  // second <C-c> during exit confirmation
  if (selectors.getInterrupted()) {
    rl.close();
    process.exit(0);
  }
});

while (selectors.getRunning()) {
  currentAbortController = new AbortController();
  try {
    const answer = await rl.question("Question ", {
      signal: currentAbortController.signal,
    });
    console.log(`Answer: ${answer}`);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      dispatch(actions.setInterrupted(true));
      currentAbortController = new AbortController();
      try {
        const exitAnswer = await rl.question(
          "Are you sure you want to exit? ",
          {
            signal: currentAbortController.signal,
          },
        );
        if (/^y(es)?$/i.exec(exitAnswer)) {
          dispatch(actions.setRunning(false));
          rl.close();
        }
      } catch {
        // second <C-c> during confirmation is already handled by SIGINT
      }
      dispatch(actions.setInterrupted(false));
    } else {
      throw err;
    }
  } finally {
    currentAbortController = null;
  }
}

