import { fileURLToPath } from "node:url";
import { selectors } from "./state.ts";
import { getMessageFromError } from "./utils.ts";
import {
  colorPrint,
  executeBat,
  fencePrint,
  initPrint,
  printNewline,
} from "./print.ts";
import { initState } from "./config.ts";
import {
  initKeypress,
  initReadline,
  initSigInt,
  resolveUserInput,
} from "./input.ts";
import { resolveApiCall } from "./api.ts";
import { initLogs } from "./log.ts";

async function main() {
  initLogs();
  initState();
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

    const text = await resolveApiCall(userInput);
    if (text) {
      printNewline();
      fencePrint("Output");
      await executeBat(text);
      printNewline();
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
