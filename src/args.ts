export interface CliArgs {
  debug: boolean;
}

export const defaultCliArgs: CliArgs = {
  debug: false,
};

export const parseCliArgsDeps = {
  getArgv: () => process.argv,
};

export function parseCliArgs() {
  const args = parseCliArgsDeps.getArgv().slice(2);

  const parsedArgs: CliArgs = structuredClone(defaultCliArgs);
  while (args.length) {
    const arg = args.pop()!;

    if (arg === "--debug") {
      parsedArgs.debug = true;
    } else {
      throw new Error("Usage: [--debug]");
    }
  }
  return parsedArgs;
}
