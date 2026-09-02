import { fileURLToPath } from "node:url";
import { getMessageFromError } from "./utils.ts";
import {
  print,
  executeBat,
  fencePrint,
  printNewline,
  printSessionStartDate,
  warnOnMissingBat,
} from "./print.ts";
import { initState } from "./config.ts";
import {
  initKeypress,
  initReadline,
  initSigInt,
  resolveUserInput,
} from "./input.ts";
import { resolveApiCall, maybeCompactMessageParams } from "./api.ts";
import { blockOnMissingConfig } from "./config.ts";
import { initLogs } from "./log.ts";

async function main() {
  await initState();
  initLogs();

  initReadline();
  initKeypress();
  initSigInt();

  await warnOnMissingBat();

  let isFirstInput = true;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    const userInput = await resolveUserInput({ isFirstInput });
    isFirstInput = false;
    if (userInput === null) continue;

    if (userInput === "") {
      await print.warning("Empty input");
      continue;
    }

    const missingConfig = await blockOnMissingConfig();
    if (missingConfig) continue;

    const text = await resolveApiCall(userInput);
    if (text === null) continue;

    await maybeCompactMessageParams(userInput);
    await printNewline();
    await fencePrint("Output", {
      showSessionInfo: true,
    });
    await executeBat(text);
    await printNewline();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(async (error: unknown) => {
    await print.error(getMessageFromError(error));
    await printSessionStartDate();
    process.exit(1);
  });
}
