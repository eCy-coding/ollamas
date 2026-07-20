// Uygulama okuryazarlığı kartları — kimlik kararlılığı, çakışma, güvenlik tutarlılığı.
import { describe, test, expect } from "vitest";
import {
  buildAppLiteracyRecords, buildAppEcymCommands, validateCards, triggerCollision,
  type AppCard,
} from "../server/app-literacy";
import { defaultPolicy } from "../server/agent-policy";

const card = (over: Partial<AppCard> = {}): AppCard => ({
  rank: 1, app: "Google Chrome", scriptable: true, category: "tarayıcı",
  purpose: "Varsayılan tarayıcı.", capabilities: ["sekme yönetimi"], drive: ["AppleScript"],
  ops: [{
    opId: "chrome.list-tabs", riskClass: "read", triggers: ["chrome sekmeleri"],
    cmd: `osascript -e 'tell application "Google Chrome" to get URL of tabs of windows'`,
    arg: "yok", desc: "açık sekmeleri listeler", level: "baslangic",
    requiresTcc: "automation", verify: "compile",
  }],
  ...over,
});

describe("buildAppLiteracyRecords", () => {
  test("kart + op başına kayıt, KARARLI kimlikler", () => {
    const r = buildAppLiteracyRecords([card()]);
    expect(r.map((x) => x.id)).toEqual(["teach:app:google-chrome", "teach:app:google-chrome:op:list-tabs"]);
  });

  test("kimlik dizi indisinden TÜRETİLMEZ — sıra değişince aynı kalır", () => {
    const a = buildAppLiteracyRecords([card({ rank: 1 }), card({ rank: 2, app: "Safari", ops: [
      { opId: "safari.list-tabs", riskClass: "read", triggers: ["safari sekmeleri"], cmd: "osascript -e 'x'", arg: "yok", desc: "d", level: "baslangic" },
    ] })]);
    const b = buildAppLiteracyRecords([card({ rank: 2, app: "Safari", ops: [
      { opId: "safari.list-tabs", riskClass: "read", triggers: ["safari sekmeleri"], cmd: "osascript -e 'x'", arg: "yok", desc: "d", level: "baslangic" },
    ] }), card({ rank: 1 })]);
    expect(new Set(a.map((x) => x.id))).toEqual(new Set(b.map((x) => x.id)));
  });

  test("TCC istemi kayıtta AÇIKLANIR (etrafından dolanılmaz)", () => {
    const r = buildAppLiteracyRecords([card()]);
    expect(r[1].content).toContain("izni soracak");
    expect(r[1].content).toContain("operatöre aittir");
  });

  test("AppleScript sözlüğünün varlığı kaydedilir", () => {
    expect(buildAppLiteracyRecords([card({ scriptable: false })])[0].content).toContain("YOK");
  });
});

describe("buildAppEcymCommands — İKİ kapının kesişimi", () => {
  test("politika 'auto' olsa BİLE GUI-riskli komut safe:False", () => {
    // Operatör ecym yamasını henüz uygulamamış olabilir; bir kart o boşluğu doldurmamalı.
    const pol = { ...defaultPolicy(), classes: { ...defaultPolicy().classes, read: "auto" as const } };
    const [cmd] = buildAppEcymCommands([card()], pol);
    expect(cmd.safe).toBe("False");
  });

  test("GUI-risksiz komut + politika 'auto' ⇒ safe:True", () => {
    const pol = { ...defaultPolicy(), classes: { ...defaultPolicy().classes, launch: "auto" as const } };
    const c = card({ ops: [{
      opId: "resolve.open", riskClass: "launch", triggers: ["resolve ac"],
      cmd: `open -a "DaVinci Resolve"`, arg: "yok", desc: "açar", level: "baslangic",
    }] });
    expect(buildAppEcymCommands([c], pol)[0].safe).toBe("True");
  });

  test("varsayılan politikada hiçbir komut safe:True DEĞİL", () => {
    const c = card({ ops: [{
      opId: "resolve.open", riskClass: "launch", triggers: ["resolve ac"],
      cmd: `open -a "DaVinci Resolve"`, arg: "yok", desc: "açar", level: "baslangic",
    }] });
    expect(buildAppEcymCommands([c], defaultPolicy())[0].safe).toBe("False");
  });

  test("eCym şeması korunur (id noktasız, source işaretli)", () => {
    const [cmd] = buildAppEcymCommands([card()], defaultPolicy());
    expect(cmd.id).toBe("app-chrome-list-tabs");
    expect(cmd.source).toBe("app-literacy");
    expect(cmd.triggers).toEqual(["chrome sekmeleri"]);
  });
});

describe("validateCards", () => {
  test("geçerli kart kabul", () => {
    expect(validateCards([card()]).ok).toBe(true);
  });

  test("YİNELENEN opId reddedilir (brain kaydını çalkalar)", () => {
    const r = validateCards([card(), card({ app: "Başka" })]);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("yinelenen");
  });

  test("biçimsiz opId reddedilir", () => {
    const r = validateCards([card({ ops: [{ ...card().ops[0], opId: "ChromeTabs" }] })]);
    expect(r.ok).toBe(false);
  });

  test("tetikleyicisiz op reddedilir (eCym asla eşleştiremez)", () => {
    const r = validateCards([card({ ops: [{ ...card().ops[0], triggers: [] }] })]);
    expect(r.errors.join(" ")).toContain("tetikleyici yok");
  });

  test("GÜVENLİK TUTARLILIĞI: zararsız ilan edilip GUI sürmek HATA", () => {
    // "inspect" deyip osascript çalıştırmak, sınıf bazlı politikayı delerdi.
    const r = validateCards([card({ ops: [{ ...card().ops[0], riskClass: "inspect" }] })]);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("GUI-riskli");
  });

  test("bilinmeyen risk sınıfı reddedilir", () => {
    const r = validateCards([card({ ops: [{ ...card().ops[0], riskClass: "uydurma" as any }] })]);
    expect(r.ok).toBe(false);
  });
});

describe("triggerCollision — eCym 0.70 kosinüs, 115 mevcut komut", () => {
  const existing = [{ id: "not-al", triggers: ["not al", "nota kaydet"] }];

  test("MEVCUT komutla çakışma HATA (sessizce kaçırılma riski)", () => {
    const c = card({ ops: [{ ...card().ops[0], opId: "notes.new", triggers: ["Not Al"] }] });
    const errs = triggerCollision([c], existing);
    expect(errs.join(" ")).toContain("MEVCUT komutla çakışıyor");
  });

  test("normalize edilir: büyük harf/noktalama/boşluk farkı çakışmayı gizlemez", () => {
    const c = card({ ops: [{ ...card().ops[0], opId: "notes.new", triggers: ["  NOT,  AL!  "] }] });
    expect(triggerCollision([c], existing).length).toBeGreaterThan(0);
  });

  test("kart İÇİ çakışma da yakalanır", () => {
    const c = card({ ops: [
      { ...card().ops[0], opId: "a.one", triggers: ["ayni ifade"] },
      { ...card().ops[0], opId: "a.two", triggers: ["ayni ifade"] },
    ] });
    expect(triggerCollision([c], []).join(" ")).toContain("kart içi çakışma");
  });

  test("boş tetikleyici hata", () => {
    const c = card({ ops: [{ ...card().ops[0], triggers: ["  "] }] });
    expect(triggerCollision([c], []).join(" ")).toContain("boş tetikleyici");
  });

  test("çakışma yoksa temiz", () => {
    expect(triggerCollision([card()], existing)).toEqual([]);
  });
});
