import { fileURLToPath } from "node:url";
import { getMessageFromError } from "./utils.ts";
import {
  print,
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

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    const userInput = await resolveUserInput();
    if (userInput === null) continue;

    if (userInput === "") {
      print.warning("Empty input");
      continue;
    }

    const text = await resolveApiCall(userInput);
    if (text === null) continue;

    printNewline();
    fencePrint("Output", { showSessionUsage: true, showApiDuration: true });
    await executeBat(text);
    printNewline();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    print.error(getMessageFromError(error));
    process.exit(1);
  });
}
