import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const rl = readline.createInterface({ input, output });

const answer = await rl.question("Question");

console.log(`Thank you for your valuable feedback: ${answer}`);

rl.on("SIGINT", () => {
  void rl.question("Are you sure you want to exit? ").then((answer) => {
    if (/^y(es)?$/i.exec(answer)) rl.close();
  });
});
