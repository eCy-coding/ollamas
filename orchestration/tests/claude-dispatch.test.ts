import { describe, it, expect } from "vitest";
import {
  taskFingerprint, foldSessions, reconcileSessions, planDispatch, buildDispatchPrompt, renderDispatchMd,
  type DispatchSession,
} from "../bin/lib/claude-dispatch";
import { buildSpawnScript, openTab, type SpawnRunner } from "../bin/lib/tab-spawn";
import type { Requirement } from "../bin/lib/fuse";

const REQ: Requirement = {
  criticality: "CRITICAL", source: "conduct", target: "red:backend",
  detail: "backend kalite kapısı kırık (test FAILED)", action: "backend: test FAILED düzelt", score: 100,
};
const NOW = Date.parse("2026-07-03T12:00:00Z");
const sess = (over: Partial<DispatchSession>): DispatchSession => ({
  fingerprint: "aaaaaaaaaaaa", task: "CRITICAL:red:backend", app: "Terminal.app",
  startedTs: "2026-07-03T11:00:00Z", status: "active", ...over,
});

describe("taskFingerprint", () => {
  it("deterministik: aynı requirement aynı fingerprint", () => {
    expect(taskFingerprint(REQ)).toBe(taskFingerprint({ ...REQ }));
    expect(taskFingerprint(REQ)).toMatch(/^[0-9a-f]{12}$/);
  });
  it("farklı target/action → farklı fingerprint", () => {
    expect(taskFingerprint({ ...REQ, target: "red:frontend" })).not.toBe(taskFingerprint(REQ));
    expect(taskFingerprint({ ...REQ, action: "başka aksiyon" })).not.toBe(taskFingerprint(REQ));
  });
  it("detail/score fingerprint'i DEĞİŞTİRMEZ (aynı iş, farklı ölçüm → idempotent)", () => {
    expect(taskFingerprint({ ...REQ, detail: "x", score: 1 })).toBe(taskFingerprint(REQ));
  });
});

describe("foldSessions", () => {
  it("JSONL last-write-wins per fingerprint + bozuk satır atlanır", () => {
    const lines = [
      JSON.stringify(sess({ status: "active" })),
      "NOT-JSON{{{",
      JSON.stringify(sess({ status: "done" })),
      JSON.stringify(sess({ fingerprint: "bbbbbbbbbbbb", status: "active" })),
    ];
    const out = foldSessions(lines);
    expect(out).toHaveLength(2);
    expect(out.find((s) => s.fingerprint === "aaaaaaaaaaaa")?.status).toBe("done");
  });
});

describe("reconcileSessions", () => {
  it("aktif + staleH'den yaşlı → stale; genç aktif ve done dokunulmaz", () => {
    const old = sess({ fingerprint: "cccccccccccc", startedTs: "2026-07-02T12:00:00Z" }); // 24h
    const young = sess({ fingerprint: "dddddddddddd", startedTs: "2026-07-03T11:30:00Z" });
    const done = sess({ fingerprint: "eeeeeeeeeeee", status: "done", startedTs: "2026-07-01T00:00:00Z" });
    const changed = reconcileSessions([old, young, done], NOW, 8);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ fingerprint: "cccccccccccc", status: "stale" });
  });
  it("geçersiz startedTs → dokunma (güvenli)", () => {
    expect(reconcileSessions([sess({ startedTs: "bozuk" })], NOW)).toHaveLength(0);
  });
});

describe("planDispatch — güvenlik katmanları", () => {
  const base = { sessions: [] as DispatchSession[], req: REQ, nowMs: NOW, killSwitch: false, goEnabled: true };
  it("kill-switch → skip, her şeyden önce", () => {
    const p = planDispatch({ ...base, killSwitch: true });
    expect(p).toMatchObject({ go: false, mode: "skip" });
    expect(p.reason).toContain("kill-switch");
  });
  it("requirement yok → skip", () => {
    expect(planDispatch({ ...base, req: null }).mode).toBe("skip");
  });
  it("aynı fingerprint aktif → skip (idempotency, launchd re-fire guard)", () => {
    const p = planDispatch({ ...base, sessions: [sess({ fingerprint: taskFingerprint(REQ) })] });
    expect(p.mode).toBe("skip");
    expect(p.reason).toContain("aktif");
  });
  it("aktif oturum cap (default 1) dolu → skip", () => {
    const other = sess({ fingerprint: "ffffffffffff", startedTs: "2026-07-02T00:00:00Z" });
    const p = planDispatch({ ...base, sessions: [other] });
    expect(p.mode).toBe("skip");
    expect(p.reason).toContain("limit");
  });
  it("cooldown dolmadı → skip (son oturum 1h önce, cooldown 4h)", () => {
    const done = sess({ fingerprint: "ffffffffffff", status: "done", startedTs: "2026-07-03T11:00:00Z" });
    const p = planDispatch({ ...base, sessions: [done] });
    expect(p.mode).toBe("skip");
    expect(p.reason).toContain("cooldown");
  });
  it("goEnabled=false → dry (spawn asla)", () => {
    const p = planDispatch({ ...base, goEnabled: false });
    expect(p).toMatchObject({ go: false, mode: "dry" });
  });
  it("tüm kapılar açık → spawn + fingerprint", () => {
    const p = planDispatch(base);
    expect(p).toMatchObject({ go: true, mode: "spawn", fingerprint: taskFingerprint(REQ) });
  });
  it("cooldown geçmiş done oturum spawn'ı ENGELLEMEZ", () => {
    const done = sess({ fingerprint: "ffffffffffff", status: "done", startedTs: "2026-07-03T00:00:00Z" }); // 12h önce
    expect(planDispatch({ ...base, sessions: [done] }).mode).toBe("spawn");
  });
});

describe("buildDispatchPrompt", () => {
  const SEL = { selection: { model: "qwen3-coder:30b", tokS: 114.6, config: { num_ctx: 8192 } }, champions: { combination: { implementer: { model: "qwen3-coder:480b-cloud" }, verifier: { model: "qwen3:8b" } } } };
  it("conductor doktrini + görev + completion protokolü içerir", () => {
    const p = buildDispatchPrompt(REQ, SEL, "/repo");
    expect(p).toContain("fleet-orchestrator");
    expect(p).toContain("PLAN MODE");
    expect(p).toContain("red:backend");
    expect(p).toContain("qwen3-coder:30b");
    expect(p).toContain("claude-dispatch-state.jsonl");
    expect(p).toContain(taskFingerprint(REQ));
  });
  it("MODEL_SELECTION yoksa benchprompt tazeleme talimatı", () => {
    expect(buildDispatchPrompt(REQ, null, "/repo")).toContain("benchprompt");
  });
});

describe("renderDispatchMd", () => {
  it("karar satırı + oturum tablosu", () => {
    const md = renderDispatchMd({
      ts: "2026-07-03T12:00:00Z", plan: { go: true, mode: "spawn", reason: "spawn: CRITICAL:red:backend", fingerprint: "abc" },
      req: REQ, sessions: [sess({})], killSwitch: false, goEnabled: true, app: "Terminal.app",
    });
    expect(md).toContain("## ▶ SPAWN");
    expect(md).toContain("| aaaaaaaaaaaa |");
  });
  it("stale-requirement uyarısı görünür", () => {
    const md = renderDispatchMd({
      ts: "t", plan: { go: false, mode: "skip", reason: "x" }, req: null, sessions: [],
      killSwitch: false, goEnabled: false, app: "iTerm2", reqStale: true,
    });
    expect(md).toContain("REQUIREMENTS bayat");
  });
});

describe("tab-spawn", () => {
  it("buildSpawnScript: Terminal.app do script + quote escape", () => {
    const s = buildSpawnScript("Terminal.app", `echo "hi"`);
    expect(s).toContain('tell application "Terminal"');
    expect(s).toContain('do script "echo \\"hi\\""');
  });
  it("buildSpawnScript: iTerm2 create tab + pencere-yoksa create window", () => {
    const s = buildSpawnScript("iTerm2", "cmd");
    expect(s).toContain('tell application "iTerm"');
    expect(s).toContain("create window with default profile");
    expect(s).toContain("create tab with default profile");
  });
  it("openTab: injected runner osascript -e ile çağrılır (gerçek exec yok)", () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const run: SpawnRunner = (file, args) => { calls.push({ file, args }); };
    openTab("Terminal.app", "wrapper.sh; exec $SHELL", run);
    expect(calls).toHaveLength(1);
    expect(calls[0].file).toBe("osascript");
    expect(calls[0].args[0]).toBe("-e");
    expect(calls[0].args[1]).toContain("wrapper.sh");
  });
});
