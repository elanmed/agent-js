import { fileURLToPath } from "node:url";
import { selectors } from "./state.ts";
import {
  colorPrint,
  executeBat,
  fencePrint,
  getMessageFromError,
  initPrint,
  printNewline,
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
  initPrint();

  initReadline();
  initKeypress();
  initSigInt();

  while (selectors.getRunning()) {
    const userInput = await resolveUserInput();
    if (userInput === null) continue;

    if (userInput === "") {
      colorPrint("Empty input", "yellow");
      continue;
    }

    const messageCountBefore = selectors.getMessageParams().length;
    const userInputApiCall = await resolveUserInputApiCall(userInput);
    if (userInputApiCall == null) continue;

    if (userInputApiCall.text) {
      printNewline();
      fencePrint("Output");
      await executeBat(userInputApiCall.text);
      printNewline();
    }

    const toolLoopApiCall = await runToolLoop(
      userInputApiCall,
      messageCountBefore,
    );
    if (toolLoopApiCall.finishReason === "length") {
      colorPrint("Response truncated, output hit the token limit", "yellow");
    }
  }

  selectors.getRl()!.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    colorPrint(getMessageFromError(error), "red");
    process.exit(1);
  });
}
