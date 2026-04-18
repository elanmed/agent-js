import { fileURLToPath } from "node:url";
import { selectors } from "./state.ts";
import {
  colorLog,
  maybePrintUsageMessage,
  getMessageFromError,
} from "./utils.ts";
import { initState } from "./config.ts";
import {
  initKeypress,
  initReadline,
  initSigInt,
  resolveUserInput,
} from "./input.ts";
import {
  resolveUserInputApiCall,
  runReachedMaxLengthLoop,
  runToolLoop,
} from "./api.ts";

async function main() {
  initState();

  const rl = initReadline();
  initKeypress(rl);
  initSigInt(rl);

  while (selectors.getRunning()) {
    const userInput = await resolveUserInput(rl);
    if (userInput === null) continue;

    if (userInput === "") {
      colorLog("Empty input", "yellow");
      continue;
    }

    const userInputApiCall = await resolveUserInputApiCall(userInput);
    if (userInputApiCall == null) continue;

    const messageCountBeforeToolLoop = selectors.getMessageParams().length;
    const toolLoopApiCall = await runToolLoop(
      userInputApiCall,
      messageCountBeforeToolLoop,
    );

    const messageCountBeforeMaxLengthLoop = selectors.getMessageParams().length;
    await runReachedMaxLengthLoop(
      toolLoopApiCall,
      messageCountBeforeMaxLengthLoop,
    );

    maybePrintUsageMessage();
  }

  rl.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    colorLog(getMessageFromError(error), "red");
    process.exit(1);
  });
}
