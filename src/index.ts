import { fileURLToPath } from "node:url";
import { actions, dispatch, selectors } from "./state.ts";
import {
  colorLog,
  executeBat,
  fenceLog,
  getMessageFromError,
  logNewline,
} from "./utils.ts";
import { initState } from "./config.ts";
import {
  initKeypress,
  initReadline,
  initSigInt,
  resolveUserInput,
} from "./input.ts";
import { resolveUserInputApiCall, runToolLoop } from "./api.ts";
import { initLogs } from "./log.ts";

async function main() {
  initLogs();
  await initState();

  initReadline();
  initKeypress();
  initSigInt();

  while (selectors.getRunning()) {
    const userInput = await resolveUserInput();
    if (userInput === null) continue;

    if (userInput === "") {
      colorLog("Empty input", "yellow");
      continue;
    }

    const messageCountBefore = selectors.getMessageParams().length;
    const userInputApiCall = await resolveUserInputApiCall(userInput);
    if (userInputApiCall == null) continue;

    if (userInputApiCall.text) {
      logNewline();
      fenceLog("Output");
      await executeBat(userInputApiCall.text);
      logNewline();
    }

    const toolLoopApiCall = await runToolLoop(
      userInputApiCall,
      messageCountBefore,
    );
    if (toolLoopApiCall.finishReason === "length") {
      colorLog("Response truncated, output hit the token limit", "yellow");
    }
  }

  selectors.getRl()!.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    colorLog(getMessageFromError(error), "red");
    process.exit(1);
  });
}
