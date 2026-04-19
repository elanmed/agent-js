export interface CliArgs {
  debug: boolean;
  resumeSessionId: string | null;
}

export const defaultCliArgs: CliArgs = {
  debug: false,
  resumeSessionId: null,
};

export const parseCliArgsDeps = {
  getArgv: () => process.argv,
};

export type ParseCliArgsDeps = typeof parseCliArgsDeps;

export function parseCliArgs(deps: ParseCliArgsDeps = parseCliArgsDeps) {
  const args = deps.getArgv().slice(2);

  const parsedArgs: CliArgs = structuredClone(defaultCliArgs);
  while (args.length) {
    const arg = args.pop()!;

    if (arg === "--debug") {
      parsedArgs.debug = true;
    } else if (arg.startsWith("--resume")) {
      const resumeSessionId = arg.split("=")[1];
      if (!resumeSessionId) {
        throw new Error("Usage: [--debug] [--resume=sessionId]");
      }
      parsedArgs.resumeSessionId = resumeSessionId;
    } else {
      throw new Error("Usage: [--debug] [--resume=sessionId]");
    }
  }
  return parsedArgs;
}
