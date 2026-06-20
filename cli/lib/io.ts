// Small TTY/stdin helpers shared by chat and agent commands.
import { createInterface } from "node:readline";

// Read all of stdin as a string. Used when a command gets no prompt arg but is
// fed via a pipe: `echo "hi" | ollamas chat` (G2).
export function readStdin(stream: NodeJS.ReadStream = process.stdin): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    stream.setEncoding("utf8");
    stream.on("data", (c) => (data += c));
    stream.on("end", () => resolve(data.trim()));
    stream.on("error", () => resolve(data.trim()));
  });
}

// y/N confirmation on a TTY. Returns false without prompting when not a TTY.
export async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ans = await new Promise<string>((res) => rl.question(question, res));
    return /^y(es)?$/i.test(ans.trim());
  } finally {
    rl.close();
  }
}
