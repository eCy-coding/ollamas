#!/usr/bin/env node
// LLM Mission Control — host-side macOS terminal bridge.
// Drives iTerm2 + Terminal.app via osascript so the dockerized app can run
// commands in a REAL, visible terminal window in real time.
//
// Capture model: the wrapped command tees its output to a shared host file and
// writes its exit code to a sibling .rc file. The bridge polls the .rc file for
// completion, then reads the .out file. The command stays visible/live in the
// terminal (tee), while capture is deterministic (no AppleScript scrollback
// scraping). osascript receives the command via argv (no string escaping).
//
// Run: node terminal-bridge.mjs   (env: PORT, HOST_BRIDGE_TOKEN, BRIDGE_BIND)

import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const execFileP = promisify(execFile);

const PORT = Number(process.env.PORT) || 7345;
const BIND = process.env.BRIDGE_BIND || "127.0.0.1";
const TOKEN = process.env.HOST_BRIDGE_TOKEN || "";
const WORK = path.join(os.tmpdir(), "llm-bridge");
fs.mkdirSync(WORK, { recursive: true });

const ITERM_APP = "/Applications/iTerm.app";
const TERMINAL_APP = "/System/Applications/Utilities/Terminal.app";

// ---- osascript senders (command + stored window id passed via argv) ----
// A dedicated window per app is tracked by id so commands never land in a
// drifting "current"/"window 1" or a window still initializing its shell.
// argv: 1=command, 2=storedWindowId ("" = none). Returns the window id used.
const APPLESCRIPT = {
  iterm: `on run argv
  set theCmd to item 1 of argv
  set winId to item 2 of argv
  tell application "iTerm"
    activate
    set targetWin to missing value
    if winId is not "" then
      repeat with w in windows
        try
          if (id of w as string) is winId then set targetWin to w
        end try
      end repeat
    end if
    if targetWin is missing value then
      set targetWin to (create window with default profile)
      delay 1.3
    end if
    tell current session of targetWin to write text theCmd
    return (id of targetWin as string)
  end tell
end run`,
  terminal: `on run argv
  set theCmd to item 1 of argv
  set winId to item 2 of argv
  tell application "Terminal"
    activate
    set targetWin to missing value
    if winId is not "" then
      try
        set targetWin to (first window whose id is (winId as integer))
      end try
    end if
    if targetWin is missing value then
      do script ""
      set targetWin to front window
      delay 1.3
    end if
    do script theCmd in targetWin
    return (id of targetWin as string)
  end tell
end run`,
};

// Per-target dedicated window id (persists across runs while bridge lives).
const winState = { iterm: "", terminal: "" };

const READSCRIPT = {
  iterm: `tell application "iTerm" to return contents of current session of current window`,
  terminal: `tell application "Terminal" to return contents of selected tab of window 1`,
};

// Calibrated default terminal (from benchmark), falls back to iterm2.
let CAL_DEFAULT = "iterm2";
try {
  const cal = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".llm-mission-control/calibration.json"), "utf8"));
  if (cal.bestTerminal) CAL_DEFAULT = cal.bestTerminal;
} catch {}

function normTarget(t) {
  const v = (t || CAL_DEFAULT).toLowerCase();
  if (v === "terminal" || v === "terminal.app") return "terminal";
  return "iterm"; // iterm2 / iterm / default
}

async function osa(script, ...args) {
  // -e <script> then args become argv for the `on run` handler
  const { stdout } = await execFileP("osascript", ["-e", script, ...args], {
    timeout: 15000,
  });
  return stdout;
}

// Serialize all terminal access: one shared window per app means concurrent
// commands would interleave and race their capture files. Queue them.
let _chain = Promise.resolve();
function runCommand(target, command, timeoutMs) {
  const job = _chain.then(() => runCommandInner(target, command, timeoutMs));
  _chain = job.catch(() => {}); // keep chain alive on error
  return job;
}

// Send a command to the chosen terminal and capture output+rc via temp files.
async function runCommandInner(target, command, timeoutMs) {
  const t = normTarget(target);
  const id = `${Date.now().toString(36)}_${Math.floor(performance.now() * 1000) % 1e6}`;
  const outFile = path.join(WORK, `${id}.out`);
  const rcFile = path.join(WORK, `${id}.rc`);
  const shFile = path.join(WORK, `${id}.sh`);
  // Write the (possibly multi-line / heredoc) command to a script file so the
  // single line we type into the terminal stays simple — robust for any command
  // shape. `cat` shows the code (visible), then bash runs it; output + exit code
  // captured to files for deterministic readback.
  fs.writeFileSync(shFile, String(command) + "\n");
  // Watchdog: kill the command a few seconds before our poll deadline so a hung
  // command (infinite loop / waiting on input) can never poison the reused
  // session — the shell always returns to a prompt. rc 143/137 => killed.
  const tmoSec = Math.max(5, Math.ceil((timeoutMs || 60000) / 1000) - 5);
  const wrapped =
    `cat ${shq(shFile)}; echo '——— run ———'; ( bash ${shq(shFile)} > ${shq(outFile)} 2>&1 ) & __bp=$!; ( sleep ${tmoSec}; kill -TERM $__bp 2>/dev/null; sleep 1; kill -KILL $__bp 2>/dev/null ) & __wp=$!; wait $__bp 2>/dev/null; __rc=$?; kill $__wp 2>/dev/null; echo $__rc > ${shq(rcFile)}; cat ${shq(outFile)}`;

  const started = Date.now();
  const usedId = (await osa(APPLESCRIPT[t], wrapped, winState[t])).trim();
  if (usedId) winState[t] = usedId; // remember dedicated window for reuse

  // poll for completion (rc file appears when command group finished)
  const deadline = started + (timeoutMs || 60000);
  while (Date.now() < deadline) {
    if (fs.existsSync(rcFile)) {
      await sleep(60); // let final bytes flush
      const exitCode = parseInt(fs.readFileSync(rcFile, "utf8").trim(), 10);
      const output = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : "";
      cleanup(outFile, rcFile, shFile);
      return { ok: true, target: t, exitCode, output, durationMs: Date.now() - started };
    }
    await sleep(120);
  }
  const partial = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : "";
  cleanup(outFile, rcFile, shFile);
  winState[t] = ""; // drop the (possibly stuck) window so next run opens a fresh one
  return { ok: false, target: t, timedOut: true, output: partial, durationMs: Date.now() - started };
}

async function readBuffer(target) {
  const t = normTarget(target);
  try {
    const text = await osa(READSCRIPT[t]);
    return { ok: true, target: t, contents: text };
  } catch (e) {
    return { ok: false, target: t, error: String(e.message || e) };
  }
}

// ---- helpers ----
function shq(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function cleanup(...files) { for (const f of files) try { fs.unlinkSync(f); } catch {} }

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
  });
}
function authed(req) {
  if (!TOKEN) return true; // no token configured => open (dev)
  return req.headers["x-bridge-token"] === TOKEN;
}

// ---- HTTP server ----
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${BIND}:${PORT}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, {
      ok: true,
      service: "macos-terminal-bridge",
      terminals: { iterm2: fs.existsSync(ITERM_APP), terminal: fs.existsSync(TERMINAL_APP) },
      tokenRequired: !!TOKEN,
    });
  }

  if (req.method === "POST" && url.pathname === "/run") {
    if (!authed(req)) return send(res, 401, { ok: false, error: "bad token" });
    const body = await readBody(req);
    if (!body.command) return send(res, 400, { ok: false, error: "command required" });
    try {
      const r = await runCommand(body.target, body.command, body.timeoutMs);
      return send(res, 200, r);
    } catch (e) {
      // osascript -1743 = not authorized (TCC Automation permission)
      return send(res, 502, { ok: false, error: String(e.message || e), hint: String(e).includes("-1743") ? "Grant Automation permission: System Settings > Privacy & Security > Automation" : undefined });
    }
  }

  if (req.method === "GET" && url.pathname === "/read") {
    if (!authed(req)) return send(res, 401, { ok: false, error: "bad token" });
    return send(res, 200, await readBuffer(url.searchParams.get("target")));
  }

  // Run a command directly on the host (child_process, NOT a terminal session).
  // Holds no terminal mutex, so host tools that themselves call /run won't
  // deadlock. Used by the agent's first-class bridge tools.
  if (req.method === "POST" && url.pathname === "/exec") {
    if (!authed(req)) return send(res, 401, { ok: false, error: "bad token" });
    const body = await readBody(req);
    if (!body.command) return send(res, 400, { ok: false, error: "command required" });
    try {
      const { stdout, stderr } = await execFileP("bash", ["-lc", body.command], {
        timeout: body.timeoutMs || 90000,
        maxBuffer: 8 * 1024 * 1024,
      });
      return send(res, 200, { ok: true, exitCode: 0, output: (stdout || "") + (stderr || "") });
    } catch (e) {
      return send(res, 200, { ok: false, exitCode: e.code ?? 1, output: ((e.stdout || "") + (e.stderr || "")) || String(e.message || e) });
    }
  }

  // Write a file straight to the host filesystem (base64 body) — reliable host
  // authoring without fragile heredoc-over-keystrokes.
  if (req.method === "POST" && url.pathname === "/write") {
    if (!authed(req)) return send(res, 401, { ok: false, error: "bad token" });
    const body = await readBody(req);
    if (!body.path) return send(res, 400, { ok: false, error: "path required" });
    try {
      const buf = Buffer.from(body.contentB64 || "", "base64");
      fs.mkdirSync(path.dirname(body.path), { recursive: true });
      fs.writeFileSync(body.path, buf);
      return send(res, 200, { ok: true, path: body.path, bytes: buf.length });
    } catch (e) {
      return send(res, 500, { ok: false, error: String(e.message || e) });
    }
  }

  send(res, 404, { ok: false, error: "not found" });
});

server.listen(PORT, BIND, () => {
  console.log(`[bridge] macOS terminal bridge on http://${BIND}:${PORT} (token ${TOKEN ? "required" : "OFF"})`);
});
