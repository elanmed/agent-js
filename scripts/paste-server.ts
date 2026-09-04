import net from "node:net";
import { execSync } from "node:child_process";

const args = process.argv.slice(2);

if (args.length !== 1) {
  throw new Error("usage: --paste-cmd [cmd]");
}
const [command] = args;
if (command === undefined) {
  throw new Error("missing command");
}

const server = net.createServer((socket) => socket.end(execSync(command)));

server.listen(0, "0.0.0.0", () => {
  const address = server.address();
  if (address === null) return;
  if (typeof address === "string") return;
  console.log(String(address.port));
});
