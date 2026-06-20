import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_LABEL,
  agentPath,
  agentStatus,
  installAgent,
  renderLaunchAgent,
  uninstallAgent,
  type DaemonPlan,
  type Launchctl,
} from "./daemon.ts";

const plan: DaemonPlan = {
  label: DEFAULT_LABEL,
  nodeBin: "/usr/bin/node",
  cliPath: "/Users/x/tunnel/src/cli.ts",
  args: ["auto", "--watch"],
  logPath: "/Users/x/tunnel/keys/daemon.log",
  workdir: "/Users/x/tunnel",
};

test("renderLaunchAgent: RunAtLoad + KeepAlive + autopilot args", () => {
  const p = renderLaunchAgent(plan);
  assert.match(p, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(p, /<key>KeepAlive<\/key>/);
  assert.match(p, /<string>auto<\/string>/);
  assert.match(p, /<string>--watch<\/string>/);
  assert.match(p, /<string>\/usr\/bin\/node<\/string>/);
  assert.match(p, new RegExp(DEFAULT_LABEL));
});

test("renderLaunchAgent: ProcessType Background + ThrottleInterval (no restart storm)", () => {
  const p = renderLaunchAgent(plan);
  assert.match(p, /<string>Background<\/string>/);
  assert.match(p, /<key>ThrottleInterval<\/key>\s*<integer>10<\/integer>/);
});

test("renderLaunchAgent: XML-escapes args", () => {
  const p = renderLaunchAgent({ ...plan, args: ["auto", "--x=a&b<c>"] });
  assert.match(p, /a&amp;b&lt;c&gt;/);
  assert.doesNotMatch(p, /a&b<c>/);
});

test("agentPath → ~/Library/LaunchAgents/<label>.plist", () => {
  assert.equal(agentPath("com.test.x", "/Users/x"), "/Users/x/Library/LaunchAgents/com.test.x.plist");
});

test("installAgent writes plist + loads; uninstall unloads + removes (fake launchctl)", () => {
  const home = mkdtempSync(join(tmpdir(), "tunnel-daemon-"));
  try {
    const calls: string[][] = [];
    const fake: Launchctl = (a) => {
      calls.push(a);
      return { code: 0, stdout: "" };
    };
    const r = installAgent(plan, { launchctl: fake, home });
    assert.equal(r.ok, true);
    assert.equal(existsSync(agentPath(plan.label, home)), true);
    assert.deepEqual(calls[0]?.slice(0, 2), ["load", "-w"]);

    const u = uninstallAgent(plan.label, { launchctl: fake, home });
    assert.equal(u.ok, true);
    assert.equal(existsSync(agentPath(plan.label, home)), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("installAgent graceful when launchctl missing (plist still written)", () => {
  const home = mkdtempSync(join(tmpdir(), "tunnel-daemon-"));
  try {
    const missing: Launchctl = () => ({ code: 127, stdout: "" });
    const r = installAgent(plan, { launchctl: missing, home });
    assert.equal(r.ok, false);
    assert.match(r.reason, /launchctl not available/);
    assert.equal(existsSync(agentPath(plan.label, home)), true); // plist written regardless
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("agentStatus reports installed + loaded + pid from launchctl list", () => {
  const home = mkdtempSync(join(tmpdir(), "tunnel-daemon-"));
  try {
    const loadedList: Launchctl = (a) =>
      a[0] === "list" ? { code: 0, stdout: `4321\t0\t${DEFAULT_LABEL}\n` } : { code: 0, stdout: "" };
    // not installed yet
    let s = agentStatus(plan.label, { launchctl: loadedList, home });
    assert.equal(s.installed, false);
    // install then status
    installAgent(plan, { launchctl: loadedList, home });
    s = agentStatus(plan.label, { launchctl: loadedList, home });
    assert.equal(s.installed, true);
    assert.equal(s.loaded, true);
    assert.equal(s.pid, 4321);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("agentStatus: not loaded when label absent from list", () => {
  const home = mkdtempSync(join(tmpdir(), "tunnel-daemon-"));
  try {
    const empty: Launchctl = () => ({ code: 0, stdout: "999\t0\tcom.other.thing\n" });
    const s = agentStatus(plan.label, { launchctl: empty, home });
    assert.equal(s.loaded, false);
    assert.equal(s.pid, null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
