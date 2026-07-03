import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectHeartbeat, joinPool, heartbeatOnce,
  renderAgentPlist, agentPlistPath, installAgent, uninstallAgent, AGENT_LABEL,
} from "./agent.ts";

const OS = { totalmemBytes: 32 * 1024 ** 3, loadavg1: 2.0, cpuCount: 8, platform: "darwin", arch: "arm64" };

function fetchSeq(responses: Array<{ status: number; json: unknown }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let i = 0;
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return { ok: (r?.status ?? 500) < 400, status: r?.status ?? 500, json: async () => r?.json ?? {} } as Response;
  };
  return { fn: fn as unknown as typeof fetch, calls };
}

test("collectHeartbeat: specs from os, models from ollama tags, load clamped", async () => {
  const { fn } = fetchSeq([{ status: 200, json: { models: [{ name: "qwen3:8b" }, { name: "phi4:latest" }] } }]);
  const hb = await collectHeartbeat({ osInfo: OS, fetchFn: fn, ollamaUrl: "http://127.0.0.1:11434" });
  assert.equal(hb.ollamaUrl, "http://127.0.0.1:11434");
  assert.deepEqual(hb.models, ["qwen3:8b", "phi4:latest"]);
  assert.equal(hb.load, 0.25); // 2.0 / 8
});

test("collectHeartbeat: ollama down → empty models, load still reported", async () => {
  const { fn } = fetchSeq([{ status: 500, json: {} }]);
  const hb = await collectHeartbeat({ osInfo: { ...OS, loadavg1: 99 }, fetchFn: fn, ollamaUrl: "http://127.0.0.1:11434" });
  assert.deepEqual(hb.models, []);
  assert.equal(hb.load, 1); // clamp
});

test("joinPool: document→apply→poll until active, returns one-time key", async () => {
  const { fn, calls } = fetchSeq([
    { status: 200, json: { hash: "e".repeat(64) } },
    { status: 202, json: { id: "m_1", status: "pending" } },
    { status: 200, json: { member: { id: "m_1", status: "pending" } } },
    { status: 200, json: { member: { id: "m_1", status: "active" }, key: "olm_SECRET" } },
  ]);
  const r = await joinPool({
    baseUrl: "http://x", email: "a@b.co", specs: { ramGB: 32, os: "darwin", arch: "arm64" },
    machinePubkey: "aa".repeat(32), fetchFn: fn, pollIntervalMs: 1, timeoutMs: 5000, sleep: async () => {},
  });
  assert.equal(r.memberId, "m_1");
  assert.equal(r.key, "olm_SECRET");
  assert.ok(calls[0]?.url.endsWith("/api/contract/document"));
  assert.ok(calls[1]?.url.endsWith("/api/contract/apply"));
});

test("joinPool: rejected → throws; timeout → throws", async () => {
  const rej = fetchSeq([
    { status: 200, json: { hash: "e".repeat(64) } },
    { status: 202, json: { id: "m_1", status: "pending" } },
    { status: 200, json: { member: { id: "m_1", status: "rejected" } } },
  ]);
  await assert.rejects(
    () => joinPool({ baseUrl: "http://x", email: "a@b.co", specs: { ramGB: 1, os: "d", arch: "a" }, machinePubkey: "aa".repeat(32), fetchFn: rej.fn, pollIntervalMs: 1, timeoutMs: 5000, sleep: async () => {} }),
    /rejected/i,
  );
  const pend = fetchSeq([
    { status: 200, json: { hash: "e".repeat(64) } },
    { status: 202, json: { id: "m_1", status: "pending" } },
    { status: 200, json: { member: { id: "m_1", status: "pending" } } },
  ]);
  let now = 0;
  await assert.rejects(
    () => joinPool({ baseUrl: "http://x", email: "a@b.co", specs: { ramGB: 1, os: "d", arch: "a" }, machinePubkey: "aa".repeat(32), fetchFn: pend.fn, pollIntervalMs: 1, timeoutMs: 10, sleep: async () => { now += 20; }, clock: () => now }),
    /timeout/i,
  );
});

test("heartbeatOnce posts Bearer heartbeat", async () => {
  const { fn, calls } = fetchSeq([{ status: 200, json: { ok: true, memberId: "m_1" } }]);
  const r = await heartbeatOnce({ baseUrl: "http://x", key: "olm_k", fetchFn: fn, hb: { ollamaUrl: "http://o", models: [] } });
  assert.equal(r.ok, true);
  assert.match(String((calls[0]?.init?.headers as Record<string, string>)?.authorization), /Bearer olm_k/);
});

test("launchd plist: render + install/uninstall with fake launchctl (vK8)", () => {
  const home = mkdtempSync(join(tmpdir(), "agent-home-"));
  const plan = { label: AGENT_LABEL, nodeBin: "/usr/local/bin/node", cliPath: "/x/cli.ts", args: ["agent", "run"], logPath: "/tmp/a.log", workdir: "/x" };
  const xml = renderAgentPlist(plan);
  assert.ok(xml.includes(AGENT_LABEL) && xml.includes("<key>RunAtLoad</key>") && xml.includes("<key>KeepAlive</key>"));

  const cmds: string[][] = [];
  const fake = (args: string[]) => { cmds.push(args); return { code: 0, stdout: "" }; };
  const r = installAgent(plan, { launchctl: fake, home });
  assert.equal(r.ok, true);
  assert.ok(existsSync(agentPlistPath(AGENT_LABEL, home)));
  assert.ok(readFileSync(agentPlistPath(AGENT_LABEL, home), "utf8").includes("agent"));
  assert.deepEqual(cmds[0]?.[0], "load");

  const u = uninstallAgent(AGENT_LABEL, { launchctl: fake, home });
  assert.equal(u.ok, true);
  assert.equal(existsSync(agentPlistPath(AGENT_LABEL, home)), false);
});
