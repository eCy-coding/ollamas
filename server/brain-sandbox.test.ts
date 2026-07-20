// Sandbox egzersizcisinin kapıları — kusur S'nin panzehiri.
//
// KUSUR S: dört yetenekten üçü (reatt-rerank, ragseq-weighting, logprob-pfinal)
// üretimde HİÇ çağrılmıyordu. Terfi 10 sandbox koşusu istiyor, hiçbir şey onları
// koşturmuyordu → kısır döngü, sonsuza dek sandbox'ta. `sandboxIdFor` yazılmış,
// export edilmiş, test edilmiş ama üretimde bir kez bile çağrılmamıştı.
import { describe, test, expect } from "vitest";
import { shouldExercise, alreadyRanThisTurn, isInfraFailure, DEFAULT_RESERVE } from "./brain-sandbox";
import { emptyCap, recordRun, type Cap, type Run } from "./brain-capabilities";

const run = (over: Partial<Run> = {}): Run =>
  ({ turn: 5, at: 1_000, mode: "sandbox", ok: true, ms: 10, ...over });

describe("shouldExercise — turun gerçek işi ÖNCE", () => {
  test("GPU meşgulse koşma (yerel model kullanıcının işini yapıyor olabilir)", () => {
    const r = shouldExercise({ gpuBusy: true, elapsedMs: 0, budgetMs: 90_000 });
    expect(r.ok).toBe(false);
    expect(r.why).toContain("gpu");
  });

  test("bütçenin çoğu harcandıysa koşma", () => {
    // %40 rezerv: 90s bütçede 60s harcanmışsa 30s kalır → yetmez.
    const r = shouldExercise({ gpuBusy: false, elapsedMs: 60_000, budgetMs: 90_000 });
    expect(r.ok).toBe(false);
    expect(r.why).toContain("bütçe");
  });

  test("GPU boş ve bütçe varsa koş", () => {
    const r = shouldExercise({ gpuBusy: false, elapsedMs: 10_000, budgetMs: 90_000 });
    expect(r.ok).toBe(true);
  });

  test("rezerv oranı ayarlanabilir", () => {
    const g = { gpuBusy: false, elapsedMs: 50_000, budgetMs: 90_000 };
    expect(shouldExercise({ ...g, reserveFraction: 0.4 }).ok).toBe(true);  // 40s kaldı ≥ 36s
    expect(shouldExercise({ ...g, reserveFraction: 0.6 }).ok).toBe(false); // 40s < 54s
  });

  test("bozuk bütçe değerleri çökmez", () => {
    expect(shouldExercise({ gpuBusy: false, elapsedMs: 0, budgetMs: 0 }).ok).toBe(false);
    expect(shouldExercise({ gpuBusy: false, elapsedMs: NaN, budgetMs: 90_000 }).ok).toBe(false);
  });

  test("varsayılan rezerv makul", () => {
    expect(DEFAULT_RESERVE).toBeGreaterThan(0);
    expect(DEFAULT_RESERVE).toBeLessThan(1);
  });
});

describe("alreadyRanThisTurn — çift koşum koruması", () => {
  test("gate-ce-train kendi yolundan koştuysa egzersizci tekrar koşturmaz", () => {
    // gate-ce-train turn%10'da kendi dalından koşuyor; sandboxIdFor de onu
    // seçebilir. Aynı turda iki kez koşmak ölçümü çift sayardı.
    const cap = recordRun(emptyCap("gate-ce-train"), run({ turn: 10 }), 1_000);
    expect(alreadyRanThisTurn(cap, 10)).toBe(true);
    expect(alreadyRanThisTurn(cap, 11)).toBe(false);
  });

  test("hiç koşmamış yetenek için false", () => {
    expect(alreadyRanThisTurn(emptyCap("x"), 1)).toBe(false);
  });

  test("yalnız SON koşuya değil, o turdaki HERHANGİ bir koşuya bakar", () => {
    let cap = recordRun(emptyCap("x"), run({ turn: 7 }), 1_000);
    cap = recordRun(cap, run({ turn: 8 }), 1_100);
    expect(alreadyRanThisTurn(cap, 7)).toBe(true);
  });
});

describe("isInfraFailure — EN KOLAY YAPILAN HATA", () => {
  test("altyapı hatası yetenek kusuru SAYILMAZ", () => {
    // maxErrors:0 olduğu için tek bir embedder 503'ü yeteneği 20 tur boyunca
    // terfi edemez hâle getirirdi. Bunlar withCapability'ye GİRİLMEDEN elenmeli.
    for (const m of [
      "HTTP 503",
      "embedder busy — retry shortly",
      "fetch failed",
      "connect ECONNREFUSED 127.0.0.1:3000",
      "socket hang up",
      "The operation was aborted due to timeout",
    ]) expect(isInfraFailure(m), m).toBe(true);
  });

  test("gerçek yetenek kusuru altyapı SAYILMAZ (kaydedilmeli)", () => {
    for (const m of [
      "Cannot read properties of undefined (reading 'length')",
      "dimension mismatch: expected 768 got 384",
      "rerank produced empty ranking",
    ]) expect(isInfraFailure(m), m).toBe(false);
  });

  test("boş/bozuk girdi altyapı sayılmaz (sessizce yutma)", () => {
    expect(isInfraFailure("")).toBe(false);
    expect(isInfraFailure(undefined as any)).toBe(false);
  });
});
