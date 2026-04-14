import { fileURLToPath } from "node:url";
import { selectors } from "./state.ts";
import { colorLog, getMessageFromError, maybePrintUsageMessage } from "./utils.ts";
import { initState } from "./config.ts";
import { initReadline, initKeypress, initSigInt, resolveUserInput } from "./input.ts";
import { resolveUserInputApiCall, runToolLoop } from "./api.ts";

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

    const messageCountBeforeTurn = selectors.getMessageParams().length;

    const apiCallResult = await resolveUserInputApiCall(userInput);
    if (apiCallResult == null) continue;

    await runToolLoop(apiCallResult, messageCountBeforeTurn);

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

