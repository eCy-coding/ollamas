import { describe, it, expect } from "vitest";
import {
  taskFingerprint, sessionTarget, foldSessions, reconcileSessions, autoCompleteSessions,
  staleCounts, spawnsInWindow, shouldAudit, planDispatch, buildDispatchPrompt, renderDispatchMd,
  nextPending,
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
  fingerprint: "aaaaaaaaaaaa", task: "CRITICAL:red:backend", target: "red:backend", app: "Terminal.app",
  startedTs: "2026-07-03T11:00:00Z", status: "active", ...over,
});

describe("taskFingerprint (vO41: criticality HARİÇ)", () => {
  it("deterministik + hex12", () => {
    expect(taskFingerprint(REQ)).toBe(taskFingerprint({ ...REQ }));
    expect(taskFingerprint(REQ)).toMatch(/^[0-9a-f]{12}$/);
  });
  it("criticality flip aynı target → fingerprint DEĞİŞMEZ (false-done + duplicate önlenir)", () => {
    expect(taskFingerprint({ ...REQ, criticality: "COMPLETENESS", score: 35 })).toBe(taskFingerprint(REQ));
  });
  it("farklı target/action → farklı fingerprint", () => {
    expect(taskFingerprint({ ...REQ, target: "red:frontend" })).not.toBe(taskFingerprint(REQ));
    expect(taskFingerprint({ ...REQ, action: "başka aksiyon" })).not.toBe(taskFingerprint(REQ));
  });
});

describe("sessionTarget", () => {
  it("target alanı varsa onu, yoksa task'tan türetir (vO40 ledger migration)", () => {
    expect(sessionTarget(sess({}))).toBe("red:backend");
    const old = sess({ target: undefined, task: "CRITICAL:red:integration/v17-core" });
    expect(sessionTarget(old)).toBe("red:integration/v17-core"); // target içinde ':' korunur
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
    const old = sess({ fingerprint: "cccccccccccc", startedTs: "2026-07-02T12:00:00Z" });
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

describe("autoCompleteSessions — vO41 success function", () => {
  const oldEnough = sess({ startedTs: "2026-07-03T10:00:00Z" }); // 2h yaşında
  it("hedefi taze+dolu REQUIREMENTS'ta olmayan yaşlı aktif → done", () => {
    const out = autoCompleteSessions([oldEnough], new Set(["red:frontend"]), { reqsFresh: true, reqsNonEmpty: true, nowMs: NOW });
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe("done");
  });
  it("hedef hâlâ listede → done DEĞİL", () => {
    expect(autoCompleteSessions([oldEnough], new Set(["red:backend"]), { reqsFresh: true, reqsNonEmpty: true, nowMs: NOW })).toHaveLength(0);
  });
  it("BOŞ requirements (fuse-crash) → mass-done fırtınası YOK", () => {
    expect(autoCompleteSessions([oldEnough], new Set(), { reqsFresh: true, reqsNonEmpty: false, nowMs: NOW })).toHaveLength(0);
  });
  it("bayat requirements → auto-complete YOK", () => {
    expect(autoCompleteSessions([oldEnough], new Set(["x"]), { reqsFresh: false, reqsNonEmpty: true, nowMs: NOW })).toHaveLength(0);
  });
  it("genç (<30dk) oturum → auto-complete YOK (cap-bypass yarışı önlenir)", () => {
    const young = sess({ startedTs: "2026-07-03T11:50:00Z" }); // 10dk
    expect(autoCompleteSessions([young], new Set(["başka"]), { reqsFresh: true, reqsNonEmpty: true, nowMs: NOW })).toHaveLength(0);
  });
  it("criticality flip (task farklı, target aynı) → false-done YOK (target-bazlı üyelik)", () => {
    const s = sess({ task: "COMPLETENESS:red:backend", startedTs: "2026-07-03T10:00:00Z" });
    expect(autoCompleteSessions([s], new Set(["red:backend"]), { reqsFresh: true, reqsNonEmpty: true, nowMs: NOW })).toHaveLength(0);
  });
});

describe("staleCounts + spawnsInWindow (raw ledger history)", () => {
  const lines = [
    JSON.stringify(sess({ status: "active", startedTs: "2026-07-03T10:00:00Z" })),
    JSON.stringify(sess({ status: "stale", startedTs: "2026-07-03T10:00:00Z" })),
    JSON.stringify(sess({ status: "active", startedTs: "2026-07-03T11:00:00Z" })),
    JSON.stringify(sess({ status: "stale", startedTs: "2026-07-03T11:00:00Z" })),
    JSON.stringify(sess({ fingerprint: "bbbbbbbbbbbb", status: "active", startedTs: "2026-07-01T00:00:00Z" })), // 60h önce
    JSON.stringify(sess({ fingerprint: "cccccccccccc", status: "done", startedTs: "2026-07-03T11:30:00Z" })),
    "bozuk-satır",
  ];
  it("staleCounts: fingerprint başına stale-satır sayısı", () => {
    const c = staleCounts(lines);
    expect(c.get("aaaaaaaaaaaa")).toBe(2);
    expect(c.get("bbbbbbbbbbbb")).toBeUndefined();
  });
  it("spawnsInWindow: yalnız 24h içindeki ACTIVE satırlar sayılır (done bütçe yemez, eski sayılmaz)", () => {
    expect(spawnsInWindow(lines, NOW)).toBe(2);
  });
});

describe("shouldAudit — churn dedup", () => {
  const e = { action: "skip", fingerprint: "abc", reason: "aynı görev zaten aktif" };
  it("özdeş ardışık → false", () => {
    expect(shouldAudit(JSON.stringify({ ts: "t1", ...e }), { ts: "t2", ...e } as any)).toBe(false);
  });
  it("farklı reason/action → true; boş/bozuk son satır → true", () => {
    expect(shouldAudit(JSON.stringify({ ...e, reason: "başka" }), e)).toBe(true);
    expect(shouldAudit(undefined, e)).toBe(true);
    expect(shouldAudit("bozuk{", e)).toBe(true);
  });
});

describe("planDispatch v2 — zincir + güvenlik katmanları", () => {
  const base = { sessions: [] as DispatchSession[], req: REQ, nowMs: NOW, killSwitch: false, goEnabled: true };
  it("kill-switch → skip, her şeyden önce", () => {
    expect(planDispatch({ ...base, killSwitch: true }).reason).toContain("kill-switch");
  });
  it("requirement yok → skip", () => {
    expect(planDispatch({ ...base, req: null }).mode).toBe("skip");
  });
  it("escalation: 2× stale → blocked (asla respawn)", () => {
    const p = planDispatch({ ...base, staleCountForReq: 2 });
    expect(p.mode).toBe("blocked");
    expect(p.reason).toContain("insan");
  });
  it("dup-active TARGET-bazlı (eski-format fp'li ledger'da bile bloklar — migration)", () => {
    const oldFp = sess({ fingerprint: "eskiformat999", target: undefined, task: "CRITICAL:red:backend" });
    const p = planDispatch({ ...base, sessions: [oldFp] });
    expect(p.mode).toBe("skip");
    expect(p.reason).toContain("aktif");
  });
  it("cap=1: başka target'ta aktif oturum → skip", () => {
    const other = sess({ fingerprint: "ffffffffffff", target: "red:frontend", task: "CRITICAL:red:frontend", startedTs: "2026-07-02T00:00:00Z" });
    expect(planDispatch({ ...base, sessions: [other] }).reason).toContain("limit");
  });
  it("24h bütçe dolu → skip", () => {
    const p = planDispatch({ ...base, spawns24h: 6 });
    expect(p.mode).toBe("skip");
    expect(p.reason).toContain("bütçe");
  });
  it("ZİNCİR: son oturum done → cooldown YOK, anında spawn", () => {
    const done = sess({ fingerprint: "ffffffffffff", status: "done", startedTs: "2026-07-03T11:55:00Z" }); // 5dk önce
    expect(planDispatch({ ...base, sessions: [done], lastStatus: "done" }).mode).toBe("spawn");
  });
  it("failure-backoff: son oturum stale + 4h dolmadı → skip", () => {
    const stale = sess({ fingerprint: "ffffffffffff", status: "stale", startedTs: "2026-07-03T11:00:00Z" });
    const p = planDispatch({ ...base, sessions: [stale], lastStatus: "stale" });
    expect(p.mode).toBe("skip");
    expect(p.reason).toContain("backoff");
  });
  it("failure-backoff dolmuş stale → spawn", () => {
    const stale = sess({ fingerprint: "ffffffffffff", status: "stale", startedTs: "2026-07-03T06:00:00Z" }); // 6h önce
    expect(planDispatch({ ...base, sessions: [stale], lastStatus: "stale" }).mode).toBe("spawn");
  });
  it("goEnabled=false → dry (spawn asla)", () => {
    expect(planDispatch({ ...base, goEnabled: false })).toMatchObject({ go: false, mode: "dry" });
  });
  it("tüm kapılar açık → spawn + fingerprint", () => {
    expect(planDispatch(base)).toMatchObject({ go: true, mode: "spawn", fingerprint: taskFingerprint(REQ) });
  });
});

describe("buildDispatchPrompt — Anthropic lead-agent deseni", () => {
  const SEL = { selection: { model: "qwen3-coder:30b", tokS: 114.6, config: { num_ctx: 8192 } }, champions: { combination: { implementer: { model: "qwen3-coder:480b-cloud" }, verifier: { model: "qwen3:8b" } } } };
  it("OBJECTIVE/BOUNDARIES/OUTPUT FORMAT/SUCCESS CRITERION + doktrin + completion", () => {
    const p = buildDispatchPrompt(REQ, SEL, "/repo");
    for (const marker of ["OBJECTIVE", "BOUNDARIES", "OUTPUT FORMAT", "SUCCESS CRITERION", "fleet-orchestrator", "AUTONOMOUS MODE", "red:backend", "qwen3-coder:30b", "claude-dispatch-state.jsonl"]) {
      expect(p).toContain(marker);
    }
    expect(p).toContain(taskFingerprint(REQ));
  });
  it("vO42 zero-question: onay/plan-approval metni YOK; completion autopilot-refresh adımı VAR", () => {
    const p = buildDispatchPrompt(REQ, SEL, "/repo");
    expect(p).not.toContain("present a plan for approval");
    expect(p).toContain("NEVER ask the operator");
    expect(p).toContain("autopilot.ts --quiet");
  });
  it("MODEL_SELECTION yoksa benchprompt tazeleme talimatı", () => {
    expect(buildDispatchPrompt(REQ, null, "/repo")).toContain("benchprompt");
  });
});

describe("nextPending — vO42 paralel ön-hesap kuyruğu", () => {
  const R2: typeof REQ = { ...REQ, criticality: "COMPLETENESS", target: "crit:x", score: 45 };
  const R3: typeof REQ = { ...REQ, criticality: "ROADMAP", target: "next:y", score: 10 };
  it("aktif/blocked target atlanır, sıradaki rank'lı gereksinim döner", () => {
    const active = sess({ target: "red:backend" });
    expect(nextPending([REQ, R2, R3], [active])?.target).toBe("crit:x");
    const blocked = sess({ fingerprint: "bbbbbbbbbbbb", target: "crit:x", status: "blocked" });
    expect(nextPending([REQ, R2, R3], [active, blocked])?.target).toBe("next:y");
  });
  it("hiç oturum yoksa ilk gereksinim; boş liste → null", () => {
    expect(nextPending([REQ, R2], [])?.target).toBe("red:backend");
    expect(nextPending([], [sess({})])).toBeNull();
  });
  it("done oturum busy sayılmaz", () => {
    expect(nextPending([REQ], [sess({ status: "done" })])?.target).toBe("red:backend");
  });
});

describe("planDispatch maxPerDay override (ORCH_CLAUDE_MAX_PER_DAY)", () => {
  it("maxPerDay=2 iken 2 spawn → skip; default 6'da geçer", () => {
    const base = { sessions: [] as DispatchSession[], req: REQ, nowMs: NOW, killSwitch: false, goEnabled: true };
    expect(planDispatch({ ...base, spawns24h: 2, maxPerDay: 2 }).reason).toContain("bütçe");
    expect(planDispatch({ ...base, spawns24h: 2 }).mode).toBe("spawn");
  });
});

describe("renderDispatchMd", () => {
  it("vO42 nextUp satırı görünür", () => {
    const md = renderDispatchMd({
      ts: "t", plan: { go: false, mode: "skip", reason: "aktif" }, req: REQ, sessions: [sess({})],
      killSwitch: false, goEnabled: true, app: "Terminal.app", spawns24h: 1,
      nextUp: { ...REQ, criticality: "COMPLETENESS", target: "crit:x" },
    });
    expect(md).toContain("sıradaki (prefetched");
    expect(md).toContain("COMPLETENESS:crit:x");
  });
  it("karar + bütçe satırı + blocked listesi + oturum tablosu", () => {
    const md = renderDispatchMd({
      ts: "2026-07-03T12:00:00Z", plan: { go: true, mode: "spawn", reason: "spawn: CRITICAL:red:backend", fingerprint: "abc" },
      req: REQ, sessions: [sess({}), sess({ fingerprint: "bbbbbbbbbbbb", status: "blocked", target: "red:x" })],
      killSwitch: false, goEnabled: true, app: "Terminal.app", spawns24h: 2,
    });
    expect(md).toContain("## ▶ SPAWN");
    expect(md).toContain("24h bütçe: 2/6");
    expect(md).toContain("blocked (insan gerekli): red:x");
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

describe("kenar durumları — şekil koruması + override'lar", () => {
  it("foldSessions: geçerli JSON ama fingerprint/status eksik → atlanır (tip koruması)", () => {
    const lines = [
      JSON.stringify({ task: "x", startedTs: "t" }),            // fingerprint yok
      JSON.stringify({ fingerprint: "abcabcabcabc" }),          // status yok
      JSON.stringify({ fingerprint: 42, status: "active" }),    // fingerprint string değil
      "null",
      JSON.stringify(sess({})),
    ];
    expect(foldSessions(lines)).toHaveLength(1);
  });
  it("reconcileSessions: default staleH=8 sınırı — 7h59m aktif kalır, 9h stale olur", () => {
    const justUnder = sess({ fingerprint: "111111111111", startedTs: "2026-07-03T04:01:00Z" }); // 7h59m
    const over = sess({ fingerprint: "222222222222", startedTs: "2026-07-03T03:00:00Z" });      // 9h
    const changed = reconcileSessions([justUnder, over], NOW); // staleH verilmedi → default
    expect(changed.map((s) => s.fingerprint)).toEqual(["222222222222"]);
  });
  it("spawnsInWindow: özel windowH daraltır + geçersiz startedTs sayılmaz", () => {
    const lines = [
      JSON.stringify(sess({ status: "active", startedTs: "2026-07-03T11:30:00Z" })), // 30dk önce
      JSON.stringify(sess({ status: "active", startedTs: "2026-07-03T09:00:00Z" })), // 3h önce
      JSON.stringify(sess({ status: "active", startedTs: "geçersiz-ts" })),
    ];
    expect(spawnsInWindow(lines, NOW, 1)).toBe(1);
    expect(spawnsInWindow(lines, NOW, 24)).toBe(2);
  });
  it("planDispatch: maxActive=2 override — 1 farklı-target aktifken ikinci spawn'a izin verir", () => {
    const other = sess({ fingerprint: "ffffffffffff", target: "red:frontend", task: "CRITICAL:red:frontend" });
    const base = { sessions: [other], req: REQ, nowMs: NOW, killSwitch: false, goEnabled: true };
    expect(planDispatch(base).mode).toBe("skip");                    // default cap=1
    expect(planDispatch({ ...base, maxActive: 2 }).mode).toBe("spawn");
  });
  it("planDispatch: maxStale=1 override — tek stale bile blocked'a yükseltir", () => {
    const base = { sessions: [] as DispatchSession[], req: REQ, nowMs: NOW, killSwitch: false, goEnabled: true };
    expect(planDispatch({ ...base, staleCountForReq: 1 }).mode).toBe("spawn");            // default maxStale=2
    expect(planDispatch({ ...base, staleCountForReq: 1, maxStale: 1 }).mode).toBe("blocked");
  });
  it("shouldAudit: fingerprint undefined ↔ null normalize edilir (aynı sayılır)", () => {
    const last = JSON.stringify({ action: "skip", reason: "r" }); // fingerprint alanı hiç yok
    expect(shouldAudit(last, { action: "skip", fingerprint: null, reason: "r" })).toBe(false);
    expect(shouldAudit(last, { action: "skip", fingerprint: "abc", reason: "r" })).toBe(true);
  });
  it("nextPending: eski-format (target'sız) aktif oturum da busy sayılır — task'tan türetilir", () => {
    const oldFormat = sess({ target: undefined, task: "CRITICAL:red:backend" });
    expect(nextPending([REQ], [oldFormat])).toBeNull();
  });
});
