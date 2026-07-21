// Uygulama okuryazarlığı kartları — kimlik kararlılığı, çakışma, güvenlik tutarlılığı.
import { describe, test, expect } from "vitest";
import {
  buildAppLiteracyRecords, buildAppEcymCommands, validateCards, triggerCollision, reconcileAppSafety,
  filterCards,
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

  // DERİNLİK: kartlarda usage (kullanım kılavuzu + "ne yaparım") ve op'larda examples
  // (çoklu örnek komut) → sistemler app'i KULLANMAYI öğrenir, tek satır desc değil.
  test("usage VARSA kart kaydına kılavuz + canDo ('app X ile ne yaparım') girer", () => {
    const r = buildAppLiteracyRecords([card({
      usage: { guide: "iTerm'i geliştirme için böyle kullan", canDo: ["çoklu sekme", "ssh oturumu"] },
    })]);
    expect(r[0].content).toContain("iTerm'i geliştirme için böyle kullan");
    expect(r[0].content).toContain("çoklu sekme");
    expect(r[0].content).toContain("ssh oturumu");
  });

  test("op examples VARSA kullanım kaydına örnek komutlar girer", () => {
    const r = buildAppLiteracyRecords([card({
      ops: [{
        opId: "chrome.list-tabs", riskClass: "read", triggers: ["chrome sekmeleri"],
        cmd: "osascript -e 'x'", arg: "yok", desc: "listeler", level: "baslangic",
        examples: ["chrome sekmelerini say", "aktif sekme URL'sini al"],
      }],
    })]);
    const opRec = r.find((x) => x.id.includes(":op:"))!;
    expect(opRec.content).toContain("chrome sekmelerini say");
    expect(opRec.content).toContain("aktif sekme URL'sini al");
  });

  test("usage/examples YOKSA sığ içerik (geriye uyum — mevcut kartlar bozulmaz)", () => {
    const r = buildAppLiteracyRecords([card()]);
    // Yeni alanların hiçbiri yoksa eski davranış: kart + op kaydı, ekstra kılavuz yok.
    expect(r).toHaveLength(2);
    expect(r[0].content).not.toContain("Kullanım:");
    expect(r[0].content).toContain("Varsayılan tarayıcı"); // eski içerik korunur
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

// Politika → eCym senkronu: Emre panelden izin verince app komutlarının safe alanı
// tazelenmeli. KUSUR: safe teach ANINDA hesaplanıyor, politika sonradan değişince
// dataset bayat kalıyor (Emre auto verdi, eCym hâlâ onay kapısında).
describe("reconcileAppSafety — politika değişikliği eCym'e yansısın", () => {
  const appCmd = (id: string, safe: string) =>
    ({ id, level: "baslangic", triggers: [id], cmd: `open -a "X"`, arg: "yok", desc: "d", safe, source: "app-literacy" });
  const otherCmd = (id: string) =>
    ({ id, level: "orta", triggers: [id], cmd: "df -h", arg: "yok", desc: "d", safe: "True", source: "native" });

  const cards = [card({ ops: [{
    opId: "resolve.open", riskClass: "launch", triggers: ["resolve ac"],
    cmd: `open -a "DaVinci Resolve"`, arg: "yok", desc: "açar", level: "baslangic",
  }] })];

  test("politika genişleyince BAYAT safe:False → True olur", () => {
    const wide = { ...defaultPolicy(), classes: { ...defaultPolicy().classes, launch: "auto" as const } };
    // dataset'te app komutu bayat "False" (teach anında kısıtlıydı)
    const ds = [appCmd("app-resolve-open", "False"), otherCmd("df")];
    const { commands, changed } = reconcileAppSafety(ds as any, cards, wide);
    expect(changed).toEqual(["app-resolve-open"]);
    expect(commands.find((c: any) => c.id === "app-resolve-open").safe).toBe("True");
  });

  test("app-DIŞI komutlara ASLA dokunulmaz", () => {
    const ds = [appCmd("app-resolve-open", "False"), otherCmd("df")];
    const { commands } = reconcileAppSafety(ds as any, cards, { ...defaultPolicy(), classes: { ...defaultPolicy().classes, launch: "auto" } });
    const df = commands.find((c: any) => c.id === "df");
    expect(df.safe).toBe("True"); // native komut değişmedi
    expect(df.source).toBe("native");
  });

  test("değişiklik yoksa changed BOŞ (idempotent, yazma tetiklenmez)", () => {
    // varsayılan politikada launch=gated → safe zaten False, değişmez
    const ds = [appCmd("app-resolve-open", "False")];
    const { changed } = reconcileAppSafety(ds as any, cards, defaultPolicy());
    expect(changed).toEqual([]);
  });

  test("triggers/cmd/desc KORUNUR (vektör indeksi geçerli kalır)", () => {
    const ds = [{ ...appCmd("app-resolve-open", "False"), triggers: ["resolve ac", "davinci"], desc: "orijinal" }];
    const { commands } = reconcileAppSafety(ds as any, cards, { ...defaultPolicy(), classes: { ...defaultPolicy().classes, launch: "auto" } });
    const c = commands.find((x: any) => x.id === "app-resolve-open");
    expect(c.triggers).toEqual(["resolve ac", "davinci"]); // dokunulmadı
    expect(c.desc).toBe("orijinal");
  });

  test("haritada olmayan app komutu (silinmiş kart) dokunulmadan geçer", () => {
    const ds = [appCmd("app-silinmis-op", "False")];
    const { commands, changed } = reconcileAppSafety(ds as any, cards, defaultPolicy());
    expect(changed).toEqual([]);
    expect(commands[0].safe).toBe("False"); // olduğu gibi
  });
});

describe("filterCards — odysseus/eCym/ollamas ortak salt-okunur erişim (Faz 4)", () => {
  const cards: AppCard[] = [
    { rank: 1, app: "iTerm", scriptable: true, category: "terminal", purpose: "komut çalıştırma", capabilities: ["sekme"], drive: ["CLI"], ops: [], usage: { guide: "terminali böyle kullan", canDo: ["ssh oturumu"] } },
    { rank: 2, app: "Google Chrome", scriptable: true, category: "tarayıcı", purpose: "web gezinme", capabilities: ["sekme"], drive: ["AppleScript"], ops: [] },
    { rank: 3, app: "DaVinci Resolve", scriptable: false, category: "video", purpose: "montaj ve renk", capabilities: ["kurgu"], drive: ["GUI"], ops: [] },
  ];
  test("app filtresi (harf duyarsız alt-dize)", () => {
    expect(filterCards(cards, { app: "chrome" }).map((c) => c.app)).toEqual(["Google Chrome"]);
    expect(filterCards(cards, { app: "iterm" }).map((c) => c.app)).toEqual(["iTerm"]);
  });
  test("q lexical arama app/purpose/capability/usage üzerinde", () => {
    expect(filterCards(cards, { q: "montaj" }).map((c) => c.app)).toEqual(["DaVinci Resolve"]);
    expect(filterCards(cards, { q: "ssh" }).map((c) => c.app)).toEqual(["iTerm"]); // usage.canDo'dan
  });
  test("filtre yoksa rank sırasında hepsi; limit uygulanır", () => {
    expect(filterCards(cards, {}).map((c) => c.rank)).toEqual([1, 2, 3]);
    expect(filterCards(cards, { limit: 2 })).toHaveLength(2);
  });
  test("eşleşme yok → boş (çökmez)", () => {
    expect(filterCards(cards, { app: "yokboyle" })).toEqual([]);
  });
});
