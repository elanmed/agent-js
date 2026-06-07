import net from "node:net";
import { execSync } from "node:child_process";

net.createServer((socket) => socket.end(execSync("pbpaste"))).listen(12345);
