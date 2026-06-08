import net from "node:net";
import { execSync } from "node:child_process";

const args = process.argv.slice(2);

if (args.length !== 1) {
  throw new Error("usage: --paste-cmd [cmd]");
}

const server = net.createServer((socket) => socket.end(execSync(args[0]!)));

server.listen(0, "0.0.0.0", () => {
  const address = server.address();
  if (address === null) return;
  if (typeof address === "string") return;
  console.log(String(address.port));
});
