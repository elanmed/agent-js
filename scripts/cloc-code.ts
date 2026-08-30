const chunks: Buffer[] = [];
process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
process.stdin.on("end", () => {
  const input = Buffer.concat(chunks).toString("utf8");
  const result = JSON.parse(input) as { SUM: { code: number } };
  console.log(result.SUM.code);
});
