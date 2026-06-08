import net from "node:net";
import { execSync } from "node:child_process";

const server = net.createServer((socket) => socket.end(execSync("pbpaste")));

server.listen(0, "0.0.0.0", () => {
  const address = server.address();
  if (address === null) return;
  if (typeof address === "string") return;
  console.log(String(address.port));
});
