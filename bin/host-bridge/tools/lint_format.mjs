#!/usr/bin/env node
// lint_format — typecheck gate. Runs `tsc --noEmit` (the project's `lint`
// script). typescript is a devDep absent from the runtime container, so we run
// it in the builder-target image (has full deps; layers are cached). Driven
// through the bridge so it stays a real bridge-integrated tool.
import { readFileSync } from "fs";
import os from "os";
import { join } from "path";

const TOKEN = readFileSync(join(os.homedir(), ".llm-mission-control", "bridge.token"), "utf8").trim();
const REPO = "/Users/emrecnyngmail.com/Desktop/ollamas";

const cmd =
  `cd ${REPO} && docker build -q --target builder -t ollamas-lint . >/dev/null 2>&1 && ` +
  `docker run --rm ollamas-lint npx tsc --noEmit 2>&1 | tail -20`;

const res = await fetch("http://127.0.0.1:7345/run", {
  method: "POST",
  headers: { "X-Bridge-Token": TOKEN, "Content-Type": "application/json" },
  body: JSON.stringify({ target: "terminal", command: cmd, timeoutMs: 240000 }),
});
const r = await res.json();
const out = (r.output || "").trim();
const clean = r.ok === true && r.exitCode === 0 && !r.timedOut && !/error TS\d+/.test(out);
console.log(JSON.stringify({ clean, exitCode: r.exitCode, timedOut: !!r.timedOut, errors: out.split("\n").filter((l) => /error TS\d+/.test(l)).slice(0, 10), tail: out.slice(-300) }, null, 2));
process.exit(clean ? 0 : 1);
