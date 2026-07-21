// Ajan izin politikası — Emre'nin panelden işaretlediği yetki matrisi.
//
// SÖZLEŞME: izinler KOD DEĞİL VERİDİR. Bu modül yalnız mekanizmayı ve GÜVENLİ
// VARSAYILANI kurar; hangi sınıfın otonom olacağına Emre panelden karar verir.
// Bu yüzden buradaki testlerin çoğu "açık doğmadığını" kanıtlar.
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPolicy, savePolicy, policyPath } from "../server/agent-policy-store";
import {
  RISK_CLASSES, AUTONOMY_LEVELS, defaultPolicy, decide, validatePolicy, toSafeField,
  mergePolicy, safePreset, type AgentPolicy, type RiskClass,
} from "../server/agent-policy";

describe("defaultPolicy — hiçbir şey AÇIK doğmaz", () => {
  test("hiçbir sınıf varsayılanda 'auto' DEĞİL", () => {
    // Otonomiyi Emre açar. Ben açık varsayılan koyarsam onun kararını gasp etmiş olurum.
    const p = defaultPolicy();
    for (const c of RISK_CLASSES) expect(p.classes[c], c).not.toBe("auto");
  });

  test("dışa-ileten ve sistem-değiştiren varsayılanda 'deny'", () => {
    const p = defaultPolicy();
    expect(p.classes["communicate-outward"]).toBe("deny");
    expect(p.classes["system-change"]).toBe("deny");
    expect(p.classes["mutate-local"]).toBe("deny");
  });

  test("zararsız sınıflar 'gated' — kapalı değil ama onaysız da değil", () => {
    const p = defaultPolicy();
    expect(p.classes.inspect).toBe("gated");
    expect(p.classes.launch).toBe("gated");
    expect(p.classes.read).toBe("gated");
  });

  test("her risk sınıfı için bir karar vardır (eksik alan yok)", () => {
    const p = defaultPolicy();
    expect(Object.keys(p.classes).sort()).toEqual([...RISK_CLASSES].sort());
  });
});

describe("decide — FAIL-CLOSED", () => {
  const p = (over: Partial<AgentPolicy> = {}): AgentPolicy => ({ ...defaultPolicy(), ...over });

  test("bilinmeyen risk sınıfı → deny", () => {
    expect(decide(p(), "Chrome", "uydurma-sinif" as RiskClass)).toBe("deny");
  });

  test("bilinmeyen otonomi değeri → deny (bozuk veri yetki vermez)", () => {
    const bozuk = p({ classes: { ...defaultPolicy().classes, read: "SÜPER-YETKİ" as any } });
    expect(decide(bozuk, "Chrome", "read")).toBe("deny");
  });

  test("null/undefined politika → deny", () => {
    expect(decide(null as any, "Chrome", "read")).toBe("deny");
    expect(decide(undefined as any, "Chrome", "read")).toBe("deny");
  });

  test("classes eksikse → deny", () => {
    expect(decide({ version: 1, updatedAt: 0 } as any, "Chrome", "read")).toBe("deny");
  });
});

describe("decide — uygulama istisnası sınıf kuralını EZER", () => {
  test("istisna daha GENİŞ olabilir", () => {
    const pol = { ...defaultPolicy(), apps: { Chrome: { read: "auto" as const } } };
    expect(decide(pol, "Chrome", "read")).toBe("auto");
    expect(decide(pol, "Safari", "read")).toBe("gated"); // diğerleri etkilenmez
  });

  test("istisna daha DAR da olabilir (kısıtlama yönü de çalışır)", () => {
    const pol = {
      ...defaultPolicy(),
      classes: { ...defaultPolicy().classes, launch: "auto" as const },
      apps: { Mail: { launch: "deny" as const } },
    };
    expect(decide(pol, "Chrome", "launch")).toBe("auto");
    expect(decide(pol, "Mail", "launch")).toBe("deny");
  });

  test("bozuk istisna değeri sınıf kuralına DÜŞMEZ, deny olur", () => {
    // Bozuk istisna sessizce yok sayılıp geniş sınıf kuralına düşerse,
    // veri bozulması yetki GENİŞLETİR. Kabul edilemez.
    const pol = {
      ...defaultPolicy(),
      classes: { ...defaultPolicy().classes, read: "auto" as const },
      apps: { Chrome: { read: "çöp" as any } },
    };
    expect(decide(pol, "Chrome", "read")).toBe("deny");
  });

  test("uygulama adı eşleşmesi büyük/küçük harf duyarsız", () => {
    const pol = { ...defaultPolicy(), apps: { "Google Chrome": { read: "auto" as const } } };
    expect(decide(pol, "google chrome", "read")).toBe("auto");
  });
});

describe("toSafeField — eCym kapısına çeviri", () => {
  test("YALNIZ 'auto' doğrudan çalışır", () => {
    // ecym:90 `[ "$SAFE" = "True" ]` string karşılaştırması yapar; başka her şey
    // onay kapısına düşer. gated ve deny ikisi de "False" olmalı.
    expect(toSafeField("auto")).toBe("True");
    expect(toSafeField("gated")).toBe("False");
    expect(toSafeField("deny")).toBe("False");
  });

  test("bilinmeyen değer 'False' (fail-closed)", () => {
    expect(toSafeField("her ne ise" as any)).toBe("False");
  });
});

describe("validatePolicy", () => {
  test("geçerli politika kabul", () => {
    expect(validatePolicy(defaultPolicy()).ok).toBe(true);
  });

  test("eksik sınıf reddedilir (sessiz boşluk = sessiz yetki)", () => {
    const eksik = { version: 1, updatedAt: 0, classes: { inspect: "gated" } };
    const r = validatePolicy(eksik);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/eksik|missing/i);
  });

  test("bilinmeyen otonomi değeri reddedilir", () => {
    const p = defaultPolicy();
    const r = validatePolicy({ ...p, classes: { ...p.classes, read: "sudo" } });
    expect(r.ok).toBe(false);
  });

  test("çöp girdiler reddedilir", () => {
    for (const bad of [null, undefined, 42, "politika", [], {}]) {
      expect(validatePolicy(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  test("ilkeler serbest metindir ama dizi olmalı", () => {
    const p = defaultPolicy();
    expect(validatePolicy({ ...p, principles: ["asla spam atma"] }).ok).toBe(true);
    expect(validatePolicy({ ...p, principles: "tek string" }).ok).toBe(false);
  });
});

describe("mergePolicy — panel kısmi güncelleme gönderir", () => {
  test("verilmeyen alanlar KORUNUR", () => {
    const base = { ...defaultPolicy(), principles: ["ilke bir"] };
    const m = mergePolicy(base, { classes: { read: "auto" } as any });
    expect(m.classes.read).toBe("auto");
    expect(m.classes["communicate-outward"]).toBe("deny"); // dokunulmadı
    expect(m.principles).toEqual(["ilke bir"]);
  });

  test("geçersiz değer içeren güncelleme YOK SAYILIR, taban bozulmaz", () => {
    const base = defaultPolicy();
    const m = mergePolicy(base, { classes: { read: "çöp" } as any });
    expect(m.classes.read).toBe("gated"); // taban korundu
  });

  test("updatedAt tazelenir", () => {
    const m = mergePolicy(defaultPolicy(), { principles: ["x"] }, 12_345);
    expect(m.updatedAt).toBe(12_345);
  });
});

describe("sabitler", () => {
  test("altı risk sınıfı ve üç otonomi seviyesi", () => {
    expect(RISK_CLASSES.length).toBe(6);
    expect([...AUTONOMY_LEVELS].sort()).toEqual(["auto", "deny", "gated"]);
  });
});

// --- Kalıcılık (ince IO kabuğu) ---
describe("agent-policy-store — bozulma YETKİ GENİŞLETMEZ", () => {
  let dir = "";
  const prev = process.env.BRAIN_LOOP_DIR;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pol-")); process.env.BRAIN_LOOP_DIR = dir; });
  afterEach(() => {
    if (prev === undefined) delete process.env.BRAIN_LOOP_DIR; else process.env.BRAIN_LOOP_DIR = prev;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* geçici */ }
  });

  test("yaz-oku turu", () => {
    const p = { ...defaultPolicy(), classes: { ...defaultPolicy().classes, read: "auto" as const } };
    expect(savePolicy(p).ok).toBe(true);
    expect(loadPolicy().classes.read).toBe("auto");
  });

  test("GEÇERSİZ politika diske YAZILMAZ", () => {
    const r = savePolicy({ version: 1, updatedAt: 0, classes: { inspect: "auto" } } as any);
    expect(r.ok).toBe(false);
    expect(existsSync(policyPath())).toBe(false);
  });

  test("dosya yoksa VARSAYILAN — ve varsayılanda hiçbir sınıf auto değil", () => {
    const p = loadPolicy();
    for (const c of RISK_CLASSES) expect(p.classes[c], c).not.toBe("auto");
  });

  test("BOZUK dosya son-iyi yedeğe düşer, geniş yetkiye değil", () => {
    savePolicy(defaultPolicy());                                   // ilk geçerli sürüm
    savePolicy({ ...defaultPolicy(), principles: ["ilke"] });       // ikinci → birincisi yedeğe
    writeFileSync(policyPath(), "{ bozuk json");
    const p = loadPolicy();
    expect(validatePolicy(p).ok).toBe(true);
    for (const c of RISK_CLASSES) expect(p.classes[c], c).not.toBe("auto");
  });

  test("hem dosya hem yedek bozuksa VARSAYILAN (asla açık kalmaz)", () => {
    savePolicy(defaultPolicy());
    writeFileSync(policyPath(), "çöp");
    writeFileSync(join(dir, "agent-policy.last-good.json"), "çöp");
    expect(loadPolicy().classes["communicate-outward"]).toBe("deny");
  });
});

// loadPolicyStrict — safe regresyonunun KÖK FİX'i.
// KUSUR: loadPolicy fail-closed → okunamazsa defaultPolicy (hepsi gated/deny) →
// reconcile 98 True'yu 105 False yapıyordu. "okunamadı" ≠ "kısıtlı". strict null döner.
describe("loadPolicyStrict — okunamadı ≠ kısıtlı", () => {
  let dir = "";
  const prev = process.env.BRAIN_LOOP_DIR;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "polstrict-")); process.env.BRAIN_LOOP_DIR = dir; });
  afterEach(() => {
    if (prev === undefined) delete process.env.BRAIN_LOOP_DIR; else process.env.BRAIN_LOOP_DIR = prev;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* geçici */ }
  });

  test("dosya YOK → null (default DÖNDÜRMEZ — safe'i sıfırlamaz)", async () => {
    const { loadPolicyStrict } = await import("../server/agent-policy-store");
    expect(loadPolicyStrict()).toBeNull();
  });

  test("geçerli dosya → policy", async () => {
    const { loadPolicyStrict, savePolicy } = await import("../server/agent-policy-store");
    const p = { ...defaultPolicy(), classes: { ...defaultPolicy().classes, launch: "auto" as const } };
    savePolicy(p);
    expect(loadPolicyStrict()?.classes.launch).toBe("auto");
  });

  test("BOZUK dosya → null (geçerli yedek yoksa)", async () => {
    const { loadPolicyStrict, policyPath } = await import("../server/agent-policy-store");
    writeFileSync(policyPath(), "{ bozuk");
    expect(loadPolicyStrict()).toBeNull();
  });

  test("bozuk ana + geçerli yedek → yedek (default değil)", async () => {
    const { loadPolicyStrict, savePolicy, policyPath } = await import("../server/agent-policy-store");
    savePolicy(defaultPolicy());                                   // yedek oluşsun
    savePolicy({ ...defaultPolicy(), principles: ["x"] });          // ana → ikinci, yedek → ilk
    writeFileSync(policyPath(), "çöp");                             // ana boz
    expect(loadPolicyStrict()).not.toBeNull();                     // yedekten kurtar
  });
});

describe("safePreset — panelin tek-tık güvenli tabanı", () => {
  test("tam 6 sınıf, geçerli politika olarak validate olur", () => {
    const p = safePreset();
    expect(Object.keys(p).sort()).toEqual([...RISK_CLASSES].sort());
    expect(validatePolicy({ version: 1, updatedAt: 0, classes: p }).ok).toBe(true);
  });
  test("zararsız sınıflar auto, mutate onaylı, dışa-iletim/sistem ASLA auto (güvenlik)", () => {
    const p = safePreset();
    expect(p.inspect).toBe("auto");
    expect(p.launch).toBe("auto");
    expect(p.read).toBe("auto");
    expect(p["mutate-local"]).toBe("gated");
    expect(p["communicate-outward"]).toBe("deny");
    expect(p["system-change"]).toBe("deny");
    // DEĞİŞMEZ: geri-alınamaz sınıflar preset'te otonom OLAMAZ.
    expect(p["communicate-outward"]).not.toBe("auto");
    expect(p["system-change"]).not.toBe("auto");
  });
});
