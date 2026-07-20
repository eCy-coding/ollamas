// withCapability sözleşmesi: kapı loop'u ASLA düşürmez.
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withCapability, loadLedger, saveLedger, ensureCap } from "./brain-capability-runner";
import { emptyLedger, emptyCap, recordRun, type Ledger, type Run } from "./brain-capabilities";

let dir = "";
const prev = process.env.BRAIN_LOOP_DIR;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "caps-")); process.env.BRAIN_LOOP_DIR = dir; });
afterEach(() => {
  if (prev === undefined) delete process.env.BRAIN_LOOP_DIR; else process.env.BRAIN_LOOP_DIR = prev;
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* geçici */ }
});

/** Yeteneği otonom duruma taşı (sandbox + canlı pencereyi geçir). */
const makeAutonomous = (l: Ledger, id: string) => {
  let c = emptyCap(id);
  const run = (i: number, mode: "sandbox" | "live"): Run => ({ turn: i, at: 1_000 + i, mode, ok: true, ms: 10 });
  for (let i = 0; i < 10; i++) c = recordRun(c, run(i, "sandbox"), 1_000 + i);
  for (let i = 0; i < 10; i++) c = recordRun(c, run(i, "live"), 2_000 + i);
  l.caps[id] = c;
  return c;
};

describe("withCapability", () => {
  test("sandbox durumundaki yetenek CANLIDA koşmaz — fallback döner", async () => {
    const l = emptyLedger();
    ensureCap(l, "x");
    let ran = false;
    const out = await withCapability("x", async () => { ran = true; return "yeni"; }, async () => "eski", { ledger: l, turn: 1 });
    expect(out).toBe("eski");
    expect(ran).toBe(false); // yeni yol hiç çağrılmadı
  });

  test("otonom yetenek canlıda koşar ve sonucu döner", async () => {
    const l = emptyLedger();
    makeAutonomous(l, "x");
    const out = await withCapability("x", async () => "yeni", async () => "eski", { ledger: l, turn: 1 });
    expect(out).toBe("yeni");
  });

  test("otonom yetenek PATLARSA fallback döner ve KARANTINAYA alınır", async () => {
    const l = emptyLedger();
    makeAutonomous(l, "x");
    const out = await withCapability("x", async () => { throw new Error("boom"); }, async () => "eski", { ledger: l, turn: 7 });
    expect(out).toBe("eski");                      // loop düşmedi
    expect(l.caps.x.status).toBe("quarantined");   // bir daha denenmez
    expect(l.caps.x.quarantine?.reason).toContain("boom");
  });

  test("sandbox modunda sonuç KULLANILMAZ — yalnız ölçülür", async () => {
    const l = emptyLedger();
    ensureCap(l, "x");
    let ran = false;
    const out = await withCapability("x", async () => { ran = true; return "yeni"; }, async () => "eski",
      { ledger: l, turn: 1, mode: "sandbox" });
    expect(ran).toBe(true);   // ölçüm için koştu
    expect(out).toBe("eski"); // ama canlı davranış DEĞİŞMEDİ
    expect(l.caps.x.runs.length).toBe(1);
  });

  test("bilinmeyen yetenek otomatik sandbox olarak doğar (asla otonom değil)", async () => {
    const l = emptyLedger();
    await withCapability("yeni-sey", async () => "n", async () => "e", { ledger: l, turn: 1 });
    expect(l.caps["yeni-sey"].status).toBe("sandbox");
  });
});

/** Yeteneği aday duruma taşı (yalnız 10 temiz sandbox → candidate, canlı henüz yok). */
const makeCandidate = (l: Ledger, id: string) => {
  let c = emptyCap(id);
  for (let i = 0; i < 10; i++) {
    c = recordRun(c, { turn: i, at: 1_000 + i, mode: "sandbox", ok: true, ms: 10 }, 1_000 + i);
  }
  l.caps[id] = c;
  return c;
};

describe("withCapability — canlı-gölge (candidate→autonomous köprüsü)", () => {
  test("candidate + mode:live → next KOŞAR, canlı koşu kaydolur, ÇIKTI ATILIR (gölge)", async () => {
    const l = emptyLedger();
    expect(makeCandidate(l, "x").status).toBe("candidate");
    let ran = false;
    const out = await withCapability("x", async () => { ran = true; return "yeni"; }, async () => "eski",
      { ledger: l, turn: 20, mode: "live" });
    expect(ran).toBe(true);                                            // canlı-gölge KOŞTU
    expect(out).toBe("eski");                                          // ama çıktı güvenilmez → atıldı
    const liveRuns = l.caps.x.runs.filter((r) => r.mode === "live");
    expect(liveRuns.length).toBe(1);                                   // canlı koşu KAYDEDİLDİ (evaluate besler)
  });

  test("candidate + 10 temiz canlı-gölge → autonomous'a terfi", async () => {
    const l = emptyLedger();
    makeCandidate(l, "x");
    for (let i = 0; i < 10; i++) {
      await withCapability("x", async () => "yeni", async () => "eski", { ledger: l, turn: 20 + i, mode: "live" });
    }
    expect(l.caps.x.status).toBe("autonomous");                       // canlı-gölge penceresi geçti
  });

  test("canlı-gölge PATLARSA anında karantina (canlı hata = güvenlik sınırı)", async () => {
    const l = emptyLedger();
    makeCandidate(l, "x");
    const out = await withCapability("x", async () => { throw new Error("gölge-boom"); }, async () => "eski",
      { ledger: l, turn: 20, mode: "live" });
    expect(out).toBe("eski");
    expect(l.caps.x.status).toBe("quarantined");
    expect(l.caps.x.quarantine?.reason).toContain("gölge-boom");
  });

  test("canlı-gölge ALTYAPI hatası (fetch failed) → karantina YOK, koşu KAYDEDİLMEZ", async () => {
    const l = emptyLedger();
    makeCandidate(l, "x");
    const isInfra = (m: string) => /fetch failed|timeout|503/i.test(m);
    const out = await withCapability("x", async () => { throw new Error("fetch failed"); }, async () => "eski",
      { ledger: l, turn: 20, mode: "live", isInfraError: isInfra });
    expect(out).toBe("eski");
    expect(l.caps.x.status).toBe("candidate");                       // altyapı ≠ yetenek kusuru → karantina YOK
    expect(l.caps.x.runs.filter((r) => r.mode === "live").length).toBe(0); // koşu kaydedilmedi (aç turdaki skip gibi)
  });

  test("GERÇEK yetenek hatası (altyapı değil) → hâlâ karantina (güvenlik korundu)", async () => {
    const l = emptyLedger();
    makeCandidate(l, "x");
    const isInfra = (m: string) => /fetch failed|timeout|503/i.test(m);
    const out = await withCapability("x", async () => { throw new Error("NaN skoru üretti"); }, async () => "eski",
      { ledger: l, turn: 20, mode: "live", isInfraError: isInfra });
    expect(out).toBe("eski");
    expect(l.caps.x.status).toBe("quarantined");                     // gerçek kusur → karantina (davranış değişmedi)
  });

  test("SANDBOX yetenek mode:live ile KOŞMAZ — sandbox asla canlıya sızmaz", async () => {
    const l = emptyLedger();
    ensureCap(l, "x");                                                // status=sandbox
    let ran = false;
    const out = await withCapability("x", async () => { ran = true; return "yeni"; }, async () => "eski",
      { ledger: l, turn: 1, mode: "live" });
    expect(ran).toBe(false);                                          // sandbox yetenek canlı-gölge bile koşamaz
    expect(out).toBe("eski");
  });
});

describe("defter kalıcılığı", () => {
  test("yaz-oku turu", () => {
    const l = emptyLedger();
    ensureCap(l, "a");
    expect(saveLedger(l)).toBe(true);
    expect(Object.keys(loadLedger().caps)).toEqual(["a"]);
  });

  test("bozuk defter temiz deftere düşer — yetenekler sandbox'tan başlar (güvenli taraf)", () => {
    const l = loadLedger();  // dosya yok
    expect(l.version).toBe(1);
    expect(l.caps).toEqual({});
  });
});
