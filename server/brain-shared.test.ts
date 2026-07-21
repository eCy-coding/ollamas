// Ortak-brain pipeline: tek retrieval → üç uzman → gate → seçim; degrade-alive.
import { describe, test, expect } from "vitest";
import { askShared, usableGate } from "./brain-shared";

const hit = (id: string, content: string, score = 0.9) =>
  ({ id, tier: "learned", content, distance: 0, score, createdAt: 1, confidence: 0.9 }) as any;

const baseDeps = {
  recall: async () => [hit("m-1", "ollamas brain sqlite-vec ile çalışır")],
  searchFacts: async () => [],
  generate: async () => "",
};

describe("askShared — ortak brain, çok uzman", () => {
  test("tek retrieval tüm uzmanlara aynı bağlamı verir; gate en yüksek ağırlıklıyı seçer", async () => {
    const seen: string[] = [];
    const r = await askShared("brain kodu hangi modülde", {
      ...baseDeps,
      experts: {
        ollamas: async (m) => { seen.push("ollamas:" + m[1].content.slice(0, 20)); return "ollamas cevabı [mem:m-1]"; },
        ecym: async () => "ecym cevabı [mem:m-1]",
        odysseus: async () => "odysseus cevabı [mem:m-1]",
      },
    } as any);
    expect(r.abstained).toBeUndefined();
    expect(seen[0]).toContain("SORU: brain kodu");
    expect(["ollamas", "ecym", "odysseus", "claudecode"]).toContain(r.expert);
    expect(r.expert).toBe("ollamas"); // 'kod/modül' sinyali → heuristik bias ollamas
    expect(Object.values(r.weights).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 3);
    expect(r.sources[0].id).toBe("m-1");
  });

  test("erişilemeyen uzman degrade edilir, ağırlıklar kalanlar üzerinde renormalize olur", async () => {
    const r = await askShared("terminalde disk doluluğu", {
      ...baseDeps,
      experts: {
        ollamas: async () => "ollamas cevabı",
        ecym: async () => { throw new Error("ollama busy"); },
        odysseus: async () => "BİLGİ_YOK", // kaynak yok diyen uzman da degrade sayılır
      },
    } as any);
    expect(r.degraded).toEqual(expect.arrayContaining(["ecym", "odysseus"]));
    expect(r.expert).toBe("ollamas");
    expect(r.weights.ollamas).toBeCloseTo(1, 3);
    expect(r.weights.ecym).toBe(0);
  });

  test("hiçbir uzman cevap veremezse dürüstçe abstain eder", async () => {
    const r = await askShared("x", { ...baseDeps, experts: { ollamas: async () => "BİLGİ_YOK" } } as any);
    expect(r.abstained).toBe(true);
    expect(r.answer).toContain("güvenilir bilgi yok");
  });

  test("kişiselleştirme (q* = q + λ·p_u) profil varsa uygulanır ve işaretlenir", async () => {
    let usedVec: number[] | null = null;
    const r = await askShared("emre neyi tercih eder", {
      ...baseDeps,
      embed: async () => [1, 0, 0],
      profileVectors: async () => [[0, 1, 0], [0, 1, 0]],
      recallVec: async (v: number[]) => { usedVec = v; return []; },
      experts: { ollamas: async () => "cevap [mem:m-1]" },
      saveGate: () => {},
    } as any);
    expect(r.personalized).toBe(true);
    // 2026-07-20 DÜZELTME: bu satır eskiden `toBeNull()` idi ve bir KUSURU doğru
    // davranış diye belgeliyordu — q* hesaplanıyor ama retrieval metinle sürülüyordu,
    // yani formül 3c dekoratifti. Artık q* GERÇEKTEN recallVec'e gider:
    //   p_u = mean([0,1,0],[0,1,0]) = [0,1,0];  λ=0.2  →  q* = [1, 0.2, 0]
    expect(usedVec).not.toBeNull();
    expect(usedVec![0]).toBeCloseTo(1, 6);
    expect(usedVec![1]).toBeCloseTo(0.2, 6);
    expect(r.expert).toBe("ollamas");
  });
});

describe("askShared — bounded experts (kusursuz loop şartı)", () => {
  test("asılı kalan uzman turu kilitlemez; süresi dolan degrade edilir", async () => {
    process.env.BRAIN_EXPERT_TIMEOUT_MS = "150";
    try {
      const started = Date.now();
      const r = await askShared("kod modülü nedir", {
        recall: async () => [hit("m-1", "içerik")],
        searchFacts: async () => [],
        generate: async () => "",
        experts: {
          ollamas: async () => "hızlı cevap [mem:m-1]",
          ecym: () => new Promise<string>(() => {}), // asla dönmez
        },
      } as any);
      expect(Date.now() - started).toBeLessThan(3000);
      expect(r.expert).toBe("ollamas");
      expect(r.degraded).toContain("ecym");
    } finally {
      delete process.env.BRAIN_EXPERT_TIMEOUT_MS;
    }
  });
});

// F3b/F3c CANLANDIRMA (2026-07-20). Bu üç yol canlı kodda ÖLÜYDÜ: hiçbir çağıran
// embed+profileVectors+recallVec üçlüsünü birden vermediği için qVec daima null
// kalıyor, W_g hiç çarpılmıyor, updateGate hiç ateşlenmiyordu (gate.json yoktu).
// Bu blok üçünün de gerçekten çalıştığını kilitler.
describe("askShared — q* ve gate canlı (F3b/F3c)", () => {
  const embed = async (t: string) => (t.includes("kod") ? [1, 0, 0] : [0, 1, 0]);

  test("yalnız embed verilse bile gate GERÇEK vektör alır (qVec artık null değil)", async () => {
    let saved: any = null;
    const r = await askShared("brain kodu hangi modülde", {
      ...baseDeps,
      embed,
      gate: { W: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b: [0, 0, 0] },
      saveGate: (g: any) => { saved = g; },
      experts: { ollamas: async () => "cevap [mem:m-1]" },
    } as any);
    expect(r.expert).toBe("ollamas");
    // 2026-07-20 TERS ÇEVRİLDİ: bu test eskiden `saved` DOLU olmalı diyordu, yani
    // askShared'ın gate'i KENDİ argmax'ıyla güncellemesini SÖZLEŞME olarak kilitliyordu.
    // O öz-doğrulama gate'i tek uzmana çökertti. Artık askShared gate'e YAZMAZ;
    // öğrenme dışsal puanla ve TOPLU yapılır (brain-gate-train.ts).
    expect(saved).toBeNull();
    // Kanıt: qVec üretiliyor ve dışsal puanlar raporlanıyor (öğrenme sinyali AKIYOR).
    expect(r.scores).toBeDefined();
    expect(Object.keys(r.scores!)).toEqual(["ollamas", "ecym", "odysseus", "claudecode"]);
    // profil/recallVec yok → kişiselleştirme dürüstçe false raporlanır.
    expect(r.personalized).toBe(false);
  });

  test("askShared gate'e ASLA yazmaz — öz-doğrulama dışarıda kilitli", async () => {
    let saveGateCalls = 0;
    await askShared("brain kodu hangi modülde", {
      ...baseDeps,
      embed,
      gate: { W: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b: [0, 0, 0] },
      saveGate: () => { saveGateCalls++; },
      experts: {
        ollamas: async () => "cevap [mem:m-1]",
        ecym: async () => "başka cevap [mem:m-1]",
        odysseus: async () => "üçüncü cevap [mem:m-1]",
      },
    } as any);
    expect(saveGateCalls).toBe(0);
  });

  test("onOutcome üç uzmanın DIŞSAL puanıyla ateşlenir (eğitimin ham verisi)", async () => {
    let seen: any = null;
    await askShared("brain kodu hangi modülde", {
      ...baseDeps,
      embed,
      onOutcome: (o: any) => { seen = o; },
      experts: {
        ollamas: async () => "ollamas kaynakli cevap [mem:m-1]",
        ecym: async () => "BİLGİ_YOK",            // abstain → puan 0
        odysseus: async () => "temelsiz cevap",   // atıf yok → düşük puan
      },
    } as any);
    expect(seen).not.toBeNull();
    expect(seen.scores.length).toBe(4);
    expect(seen.q.length).toBeGreaterThan(0);
    expect(seen.scores[1]).toBe(0);                          // abstain sert 0
    expect(seen.scores[0]).toBeGreaterThan(seen.scores[2]);  // atıflı > temelsiz
  });

  test("ε=0 (varsayılan) ⇒ keşif YOK, davranış bit-aynı", async () => {
    const r = await askShared("brain kodu hangi modülde", {
      ...baseDeps,
      embed,
      experts: { ollamas: async () => "cevap [mem:m-1]", odysseus: async () => "diğer [mem:m-1]" },
    } as any);
    expect(r.explored).toBe(false);
  });

  test("ε=1 + sabit rng ⇒ argmax DIŞI uzman seçilir (keşif gerçek)", async () => {
    const { mulberry32 } = await import("./brain-explore");
    const r = await askShared("brain kodu hangi modülde", {   // 'kod' sinyali → ollamas argmax
      ...baseDeps,
      embed,
      epsilon: 1,
      rng: mulberry32(42),
      experts: {
        ollamas: async () => "ollamas cevabı [mem:m-1]",
        odysseus: async () => "odysseus cevabı [mem:m-1]",
      },
    } as any);
    expect(r.explored).toBe(true);
    expect(r.expert).not.toBe("ollamas");
  });

  test("recallVec yoksa kişiselleştirme false raporlanır (rapor kendini kandırmaz)", async () => {
    const r = await askShared("brain kodu hangi modülde", {
      ...baseDeps,
      embed,
      profileVectors: async () => [[0, 0, 1]],
      experts: { ollamas: async () => "cevap [mem:m-1]" },
    } as any);
    expect(r.personalized).toBe(false); // q* hesaplandı ama retrieval'ı sürmedi
  });

  test("boyutu uyuşmayan bayat gate sessizce kullanılmaz, sıfırdan başlanır", () => {
    // Doğrudan saf fonksiyon: eskiden bu davranış yalnız saveGate üzerinden gözlenebiliyordu,
    // ama askShared artık gate'e yazmıyor. Koruma dışa açıldı, gözlem doğrudan.
    const bayat = { W: [[1, 2], [3, 4], [5, 6]], b: [0, 0, 0] };      // 2 boyutlu, 3 satır
    expect(usableGate(bayat, 3).W[0]).toEqual([0, 0, 0]);              // dim uyuşmaz → reddedildi
    // dim uysa bile satır-sayısı (uzman) uyuşmazsa reddedilir → 4-satır soğuk başlangıç
    expect(usableGate(bayat, 2).W.length).toBe(4);
    const iyi = { W: [[1, 1], [2, 2], [3, 3], [4, 4]], b: [0, 0, 0, 0] }; // 2-dim, 4 satır (doğru)
    expect(usableGate(iyi, 2)).toBe(iyi);                             // dim+satır uyar → aynen kullanılır
    expect(usableGate(undefined, 4).W[0].length).toBe(4);              // yoksa soğuk başlangıç
  });

  test("embed patlarsa tur düşmez — düz metin yoluyla devam", async () => {
    const r = await askShared("brain kodu hangi modülde", {
      ...baseDeps,
      embed: async () => { throw new Error("embedder busy"); },
      experts: { ollamas: async () => "cevap [mem:m-1]" },
    } as any);
    expect(r.expert).toBe("ollamas"); // degrade-alive
  });
});
