import { describe, it, expect } from "vitest";
import { roadmapStruct, errorStruct, buildSnapshot, summarizeAdoptions, liveTabMap, contractStruct, type LaneStatus } from "../bin/lib/collect";
import { parseAdoptionRows, gate } from "../bin/adopt";

describe("roadmapStruct", () => {
  it("son DONE + ilk NEXT/planned satırını çıkarır (struct, pre-join string DEĞİL)", () => {
    const md = [
      "| vO1 | ✅ DONE | Bootstrap |",
      "| vO2 | ✅ DONE | Live discovery |",
      "| vO3 | planned | Canlı cockpit |",
    ].join("\n");
    const r = roadmapStruct(md);
    expect(r.current).toContain("vO2");
    expect(r.next).toContain("vO3");
  });
  it("eşleşme yok → boş struct", () => {
    expect(roadmapStruct("alakasız metin")).toEqual({ current: "", next: "" });
  });
});

describe("errorStruct", () => {
  it("errors_registry.json'dan sayı + son id", () => {
    const j = JSON.stringify({ errors: [{ id: "ERR-ORCH-001" }, { id: "ERR-ORCH-002" }] });
    expect(errorStruct(j)).toEqual({ count: 2, lastId: "ERR-ORCH-002" });
  });
  it("boş errors → 0 / null", () => {
    expect(errorStruct(JSON.stringify({ errors: [] }))).toEqual({ count: 0, lastId: null });
  });
  it("bozuk JSON → 0 / null (kırılmaz)", () => {
    expect(errorStruct("{bad")).toEqual({ count: 0, lastId: null });
  });
});

describe("buildSnapshot — toplamlar", () => {
  const lane = (over: Partial<LaneStatus>): LaneStatus => ({
    lane: "x", branch: "feat/x", head: "abc1234", ageHours: 1,
    dirtyFiles: 0, ahead: 0, behind: 0, devServer: null, tabs: 0, idle: false,
    roadmap: { current: "", next: "" }, errors: { count: 0, lastId: null }, ...over,
  });
  it("live/idle/dirty/errors doğru toplanır", () => {
    const snap = buildSnapshot({
      ts: "2026-06-20T00:00:00Z",
      expectedLanes: 8,
      lanes: [
        lane({ devServer: { port: 3000, up: true }, dirtyFiles: 2, errors: { count: 1, lastId: "E1" } }),
        lane({ idle: true, dirtyFiles: 3 }),
        lane({ devServer: { port: 5173, up: true } }),
      ],
      backend: null,
    });
    expect(snap.totals).toEqual({ live: 2, idle: 1, dirty: 5, errors: 1 });
    expect(snap.expectedLanes).toBe(8);
    expect(snap.lanes.length).toBe(3);
    expect(snap.backend).toBeNull();
  });
  it("ts ve backend pass-through", () => {
    const snap = buildSnapshot({
      ts: "T", expectedLanes: 1, lanes: [],
      backend: { cpu: 1, ram: 2, ollamaVersion: "0.5", mode: "live", db: "up", models: 1, toolCalls: 9, webhookQueue: 0, migrationVersion: 13, loaded: [] },
    });
    expect(snap.ts).toBe("T");
    expect(snap.backend?.toolCalls).toBe(9);
    expect(snap.totals.live).toBe(0);
  });
  it("adoptions default null (verilmezse)", () => {
    const snap = buildSnapshot({ ts: "T", expectedLanes: 1, lanes: [], backend: null });
    expect(snap.adoptions).toBeNull();
  });
  it("adoptions pass-through", () => {
    const a = { total: 3, permissive: 2, weakCopyleft: 0, copyleft: 1, unknown: 0, violations: [{ repo: "x", reason: "y" }] };
    const snap = buildSnapshot({ ts: "T", expectedLanes: 1, lanes: [], backend: null, adoptions: a });
    expect(snap.adoptions).toEqual(a);
  });
});

describe("summarizeAdoptions (adopt.ts/licenses.ts REUSE)", () => {
  const MD = [
    "| # | Repo | ⭐ | Lisans | Hedef Lane | Ne adopt edilir |",
    "|---|------|-----|--------|-----------|-----------------|",
    "| 1 | foo/permissive | 10K | MIT | cli | ADOPT desen |",
    "| 2 | bar/apache | 5K | Apache-2.0 | bench | pattern-ADOPT |",
    "| 3 | baz/copyleft | 17K | GPL-2.0 | orchestration | ref-only tab otomasyon |",
    "| 4 | qux/violator | 1K | GPL-3.0 | orchestration | ADOPT kopya — İHLAL |",
  ].join("\n");
  it("kategori sayımları + ihlal (GPL+ADOPT) doğru", () => {
    const rows = parseAdoptionRows(MD);
    const s = summarizeAdoptions(rows, gate(rows, "test"));
    expect(s.total).toBe(4);
    expect(s.permissive).toBe(2);   // MIT + Apache
    expect(s.copyleft).toBe(2);     // iki GPL
    expect(s.unknown).toBe(0);
    // qux: GPL-3.0 + ADOPT → İHLAL; baz: GPL + ref-only → OK
    expect(s.violations.length).toBe(1);
    expect(s.violations[0].repo).toBe("qux/violator");
  });
  it("boş satır → 0 total, 0 ihlal", () => {
    expect(summarizeAdoptions([], [])).toEqual({ total: 0, permissive: 0, weakCopyleft: 0, copyleft: 0, unknown: 0, violations: [] });
  });
});

describe("liveTabMap — graceful (osascript'siz, deterministik)", () => {
  it("ORCH_TAB_SIM=fail → null (sekme keşfi atlanır, asla throw)", () => {
    const prev = process.env.ORCH_TAB_SIM;
    process.env.ORCH_TAB_SIM = "fail";
    try {
      const r = liveTabMap();
      expect(r).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.ORCH_TAB_SIM;
      else process.env.ORCH_TAB_SIM = prev;
    }
  });
});

describe("contractStruct (vK9) — maskeli pool özeti", () => {
  it("state+backends+head → sayaçlar; email/keyId ASLA çıktıda yok", () => {
    const state = JSON.stringify({ members: [
      { id: "m_1", email: "a@b.co", status: "active", keyId: "key_x" },
      { id: "m_2", email: "c@d.co", status: "pending" },
      { id: "m_3", email: "e@f.co", status: "revoked" },
    ]});
    const backends = JSON.stringify([
      { name: "windows-cuda", url: "http://x", priority: 10 },
      { name: "contract:m_1", url: "http://y", priority: 30 },
    ]);
    const head = JSON.stringify({ up: true, url: "http://127.0.0.1:8085" });
    const c = contractStruct(state, backends, head)!;
    expect(c.members).toEqual({ pending: 1, active: 1, rejected: 0, revoked: 1, suspended: 0 });
    expect(c.fleetContractNodes).toBe(1);
    expect(c.shardHeadUp).toBe(true);
    expect(JSON.stringify(c)).not.toMatch(/@|key_|olm_/); // maskeleme garantisi
  });
  it("bozuk girdi → throw yok, sıfır sayaçlar; hepsi null → null", () => {
    const c = contractStruct("{not json", "garbage", "also bad")!;
    expect(c.members.active).toBe(0);
    expect(c.shardHeadUp).toBe(false);
    expect(contractStruct(null, null, null)).toBeNull();
  });
});
