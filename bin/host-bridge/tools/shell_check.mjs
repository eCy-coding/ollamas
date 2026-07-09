#!/usr/bin/env node
// @ts-check
// shell_check — lint a shell command/script BEFORE running it, to minimize
// errors. Two passes:
//   1. shellcheck (via docker koalaman/shellcheck:stable, stdin -> JSON1)
//   2. macOS/BSD portability heuristics (the pitfalls that bite on macOS).
// Reads the script from argv (joined) or stdin.  Read-only: never executes it.
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { emit, main } from "./lib/bridge-client.mjs";

const execFileP = promisify(execFile);
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// macOS/BSD portability + project-specific pitfalls.
/** @type {[RegExp, string][]} */
const HEURISTICS = [
  [/\bbase64\s+-d\b/, "BSD `base64` uses `-D` to decode, not `-d` (or `--decode`)."],
  [/\bsed\s+-i\s+(?!'')\S/, "BSD `sed -i` needs an explicit backup suffix: `sed -i '' …`."],
  [/(^|\s)timeout\s+\d/, "macOS has no `timeout`; use `gtimeout` or rely on the bridge watchdog."],
  [/\bgrep\s+-[A-Za-z]*P/, "BSD `grep` has no `-P` (PCRE); use `-E` or `perl -ne`."],
  [/\bxargs\s+-[A-Za-z]*r/, "BSD `xargs` has no `-r`; guard emptiness with `[ -n \"$x\" ]`."],
  [/\breadlink\s+-f\b/, "macOS `readlink -f` is unreliable; use python `os.path.realpath`."],
  [/\bdate\s+-d\b/, "GNU `date -d` differs on macOS; use `date -v` for math."],
  [/\bstat\s+-c\b/, "BSD `stat` uses `-f`, not `-c`."],
  [/\brequire\s*\(\s*['"]node-fetch['"]/, "Node 24 has global fetch; drop node-fetch."],
  [/\bundici\b/, "Node 24 has global fetch; drop undici."],
  [/\bDeno\./, "This runtime is Node, not Deno."],
  [/<<\s*['"]?EOF['"]?[\s\S]*\nEOF;/, "Heredoc terminator must be alone on its line (`EOF`, not `EOF;`)."],
];

function parseSc(out) {
  try { return (JSON.parse(out).comments || []).map((c) => ({ line: c.line, code: `SC${c.code}`, level: c.level, message: c.message })); }
  catch { return null; }
}

async function shellcheck(script) {
  // Write to a temp file and feed via shell redirect — async execFile has no
  // working stdin `input` option, so a bare `-` would hang.
  const tmp = `/tmp/shellcheck_${process.pid}.sh`;
  writeFileSync(tmp, script);
  try {
    const cmd = `docker run --rm -i koalaman/shellcheck:stable --format=json1 -s bash - < ${shq(tmp)}`;
    const { stdout } = await execFileP("bash", ["-lc", cmd], { timeout: 45000, maxBuffer: 4 * 1024 * 1024 });
    return parseSc(stdout) || [];
  } catch (e) {
    // shellcheck exits non-zero when it finds issues — stdout still holds JSON.
    return parseSc(e.stdout || "") || [{ code: "SHELLCHECK_UNAVAILABLE", level: "info", message: String(e.message || e).slice(0, 80) }];
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
}

main(async () => {
  const argv = process.argv.slice(2).join(" ");
  const script = argv.trim() || readFileSync(0, "utf8");
  if (!script.trim()) throw new Error("provide a command/script via args or stdin");

  const macos = HEURISTICS.filter(([re]) => re.test(script)).map(([, msg]) => msg);
  const sc = await shellcheck(script);
  const errors = sc.filter((c) => c.level === "error");
  const ok = macos.length === 0 && errors.length === 0;
  emit({ ok, clean: ok, shellcheck: sc, macos, severity: errors.length ? "error" : macos.length ? "warning" : "clean" });
});
