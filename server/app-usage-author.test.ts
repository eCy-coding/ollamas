// Loop self-authoring saf çekirdeği — doğrulanmayan komut brain'e YAZILMAZ, metrik dürüst.
import { describe, test, expect } from "vitest";
import {
  cardsNeedingUsage, extractCommandCandidates, verifiedExampleRate, buildAuthoredUsageRecord,
} from "./app-usage-author";
import type { AppCard } from "./app-literacy";

const card = (app: string, usage?: AppCard["usage"]): AppCard => ({
  rank: 1, app, scriptable: true, category: "x", purpose: "p", capabilities: ["c"], drive: ["CLI"],
  ops: [{ opId: `${app.toLowerCase()}.open`, riskClass: "launch", triggers: ["aç"], cmd: `open -a "${app}"`, arg: "yok", desc: "açar", level: "baslangic" }],
  usage,
});

describe("cardsNeedingUsage", () => {
  test("usage'ı olmayan kartlar seçilir; top-20 (usage'lı) hariç", () => {
    const cards = [
      card("iTerm", { guide: "g", canDo: ["a"] }),   // zengin → hariç
      card("CapCut"),                                  // usage yok → dahil
      card("Empty", { guide: "", canDo: [] }),         // boş usage → dahil
    ];
    expect(cardsNeedingUsage(cards).map((c) => c.app)).toEqual(["CapCut", "Empty"]);
  });
});

describe("extractCommandCandidates — yalnız YAPI-doğrulanabilir biçimler", () => {
  test("open -a ve osascript çıkarılır, serbest metin ATILIR", () => {
    const text = `iTerm'i açmak için: open -a "iTerm". Sonra osascript -e 'tell app "iTerm" to activate' çalıştır. Bu çok kullanışlıdır.`;
    const c = extractCommandCandidates(text);
    expect(c).toContain('open -a "iTerm"');
    expect(c.some((x) => x.startsWith("osascript -e"))).toBe(true);
    expect(c.some((x) => x.includes("kullanışlıdır"))).toBe(false); // serbest cümle değil
  });
  test("tekilleştirir; komut yoksa boş", () => {
    expect(extractCommandCandidates('open -a "X" open -a "X"')).toHaveLength(1);
    expect(extractCommandCandidates("hiç komut yok, sadece anlatı")).toEqual([]);
  });
});

describe("verifiedExampleRate — küme-içi dürüstlük", () => {
  const verifyReal = (c: string) => c.includes("iTerm");     // "iTerm" geçen doğru say
  test("hepsi doğrulanır → 1.0", () => {
    expect(verifiedExampleRate(['open -a "iTerm"'], verifyReal).rate).toBe(1);
  });
  test("yarısı doğrulanır → 0.5", () => {
    const r = verifiedExampleRate(['open -a "iTerm"', 'open -a "Fake"'], verifyReal);
    expect(r).toEqual({ verified: 1, total: 2, rate: 0.5 });
  });
  test("aday YOK → undefined (vacuous değer YOK, ortalama kirlenmez)", () => {
    expect(verifiedExampleRate([], verifyReal).rate).toBeUndefined();
  });
  test("verify FIRLATIRSA o aday doğrulanmamış sayılır (çökmez)", () => {
    const boom = () => { throw new Error("boom"); };
    expect(verifiedExampleRate(['open -a "X"'], boom).rate).toBe(0);
  });
});

describe("buildAuthoredUsageRecord — doğrulanmayan örnek İÇERİĞE GİRMEZ", () => {
  test("id loop-namespace'te (elle teach'i ezmez), yalnız doğrulanmış örnekler", () => {
    const r = buildAuthoredUsageRecord("CapCut", "capcut", "video düzenle", ['open -a "CapCut"']);
    expect(r.id).toBe("loop:app-usage:capcut");        // teach:app:capcut DEĞİL
    expect(r.ns).toBe("knowledge");
    expect(r.content).toContain("video düzenle");
    expect(r.content).toContain('open -a "CapCut"');
  });
  test("doğrulanmış örnek yoksa komut bloğu eklenmez (uydurma sızmaz)", () => {
    const r = buildAuthoredUsageRecord("X", "x", "kılavuz", []);
    expect(r.content).not.toContain("örnek komut");
    expect(r.content).toContain("kılavuz");
  });
});
