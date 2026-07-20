// Ortak-brain pipeline: tek retrieval → üç uzman → gate → seçim; degrade-alive.
import { describe, test, expect } from "vitest";
import { askShared } from "./brain-shared";

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
    expect(["ollamas", "ecym", "odysseus"]).toContain(r.expert);
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
    expect(usedVec).toBeNull(); // recallVec şu an bağlam katmanında kullanılmıyor — q* gate'e gider
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
