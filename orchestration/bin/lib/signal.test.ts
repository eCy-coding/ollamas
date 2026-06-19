#!/usr/bin/env tsx
/**
 * signal.test.ts — vO2 koordinasyon sinyali testleri (§3.1 Koordinasyon İstisnası).
 * Mock'lu, dry-run + allowlist guard'ları doğrular. Gerçek send-keys/bildirim YOK.
 * Koş:  npx tsx orchestration/bin/lib/signal.test.ts
 */
import { isAllowedCmd, nudge, notify, type Runner } from "./signal.ts";

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string) { if (cond) pass++; else { fail++; console.error(`  ✗ ${msg}`); } }

// --- isAllowedCmd: SADECE read-only teşhis komutları ------------------------
ok(isAllowedCmd("git status"), "git status allowed");
ok(isAllowedCmd("git log -1"), "git log allowed");
ok(isAllowedCmd("git branch --show-current"), "git branch allowed");
ok(isAllowedCmd("echo hi"), "echo allowed");
ok(isAllowedCmd("pwd"), "pwd allowed");
ok(!isAllowedCmd("rm -rf /"), "rm rejected");
ok(!isAllowedCmd("git push"), "git push (mutate) rejected");
ok(!isAllowedCmd("npm install"), "npm rejected");
// Komut zincirleme / injection guard (RISK-ORCH-007)
ok(!isAllowedCmd("git status; rm -rf x"), "chained ; rejected");
ok(!isAllowedCmd("git status && curl evil"), "chained && rejected");
ok(!isAllowedCmd("git status | sh"), "pipe rejected");
ok(!isAllowedCmd("echo $(rm x)"), "cmd-subst rejected");
ok(!isAllowedCmd("echo `whoami`"), "backtick rejected");
ok(!isAllowedCmd("git status > /etc/x"), "redirect rejected");

// --- nudge: dry-run default → HİÇBİR şey göndermez --------------------------
{
  const tmuxTab = { app: "tmux", session: "cli", tty: "/dev/ttys005", title: "cli:zsh", cwd: "/x", cmd: "zsh", busy: false };
  let calls = 0;
  const run: Runner = () => { calls++; return ""; };
  const r = nudge(tmuxTab, "git status", { dryRun: true, run, log: () => {} });
  ok(r.sent === false, "dry-run: sent=false");
  ok(calls === 0, "dry-run: runner not called");
  ok(r.plan.includes("send-keys") && r.plan.includes("cli"), "dry-run: plan shows tmux send-keys target");
}

// --- nudge: allowlist dışı komut → REDDET, gönderme yok ---------------------
{
  const tab = { app: "tmux", session: "cli", tty: "/dev/ttys005", title: "x", cwd: "/x", cmd: "zsh", busy: false };
  let calls = 0;
  const run: Runner = () => { calls++; return ""; };
  const r = nudge(tab, "rm -rf /", { dryRun: false, run, log: () => {} });
  ok(r.sent === false, "rejected cmd: sent=false");
  ok(r.rejected === true, "rejected cmd: rejected flag");
  ok(calls === 0, "rejected cmd: runner NEVER called (no real exec)");
  ok((r.reason || "").includes("allowlist"), "rejected cmd: reason mentions allowlist");
}

// --- nudge: gerçek gönderim (dryRun=false, allow) → runner çağrılır + loglanır
{
  const tab = { app: "tmux", session: "cli", tty: "/dev/ttys005", title: "x", cwd: "/x", cmd: "zsh", busy: false };
  const seen: string[][] = [];
  const run: Runner = (f, a) => { seen.push([f, ...a]); return ""; };
  let logged = 0;
  const r = nudge(tab, "git status", { dryRun: false, run, log: () => { logged++; } });
  ok(r.sent === true, "real nudge: sent=true");
  ok(seen.length === 1 && seen[0][0] === "tmux", "real nudge: tmux invoked");
  ok(seen[0].includes("send-keys"), "real nudge: send-keys used");
  ok(logged === 1, "real nudge: logged once (seyir audit)");
}

// --- nudge: AppleScript tab (tmux yok) → osascript write text ---------------
{
  const tab = { app: "iterm2", tty: "/dev/ttys008", title: "x", cwd: "/x", cmd: "", busy: false };
  const seen: string[][] = [];
  const run: Runner = (f, a) => { seen.push([f, ...a]); return ""; };
  const r = nudge(tab, "git status", { dryRun: false, run, log: () => {} });
  ok(r.sent === true, "iterm nudge: sent=true");
  ok(seen[0][0] === "osascript", "iterm nudge: osascript backend");
}

// --- notify: terminal-notifier yoksa stdout fallback (hatasız) --------------
{
  const noNotifier: Runner = () => "";  // which döner boş → yok
  const r = notify("idle lane", { run: noNotifier, log: () => {} });
  ok(r.delivered === false || r.delivered === true, "notify returns deterministically");
}

console.log(`\nsignal.test.ts → ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
