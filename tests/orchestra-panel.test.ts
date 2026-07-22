// L33 + L34 — the two defects that made the "orchestra" a fiction.
//
// L33: a seat that FAILED was counted as an opinion. Measured live, the odysseus seat returned
// a tool envelope reporting its own failure, `degraded` came back EMPTY, and the raw error JSON
// was carried into the vault as that expert's view.
//
// L34: measured quality was computed and then discarded. Measured live, eCym scored 0.881 and
// ollamas 0.694 — ollamas won, because selection read the gate, not the score. Every recorded
// run in the ledger had the same winner.
import { describe, test, expect } from "vitest";
import { isFailurePayload, failureReason } from "../server/brain-answer-score";
import { qualityVeto, vetoDelta, mixtureSelect } from "../server/brain-formulas";
import { askShared } from "../server/brain-shared";

// The exact string the odysseus seat returned on 2026-07-22.
const REAL_ODYSSEUS_FAILURE = '{"ok":false,"output":{"error":"fetch failed"},"diff":"","applied":false,"halt":false}';

describe("L33 — a failed seat is not an opinion", () => {
  test("recognises the real observed failure envelope", () => {
    expect(isFailurePayload(REAL_ODYSSEUS_FAILURE)).toBe(true);
    expect(failureReason(REAL_ODYSSEUS_FAILURE)).toContain("fetch failed");
  });

  test("recognises other envelope shapes and bare transport errors", () => {
    expect(isFailurePayload("")).toBe(true);
    expect(isFailurePayload("   ")).toBe(true);
    expect(isFailurePayload('{"success":false}')).toBe(true);
    expect(isFailurePayload('{"error":"upstream down"}')).toBe(true);
    expect(isFailurePayload("fetch failed")).toBe(true);
    expect(isFailurePayload("ECONNREFUSED")).toBe(true);
  });

  test("prose ABOUT an error is a real answer — explaining a failure is doing the job", () => {
    expect(isFailurePayload("Sync başarısız çünkü fetch failed hatası alınıyor [mem:x]")).toBe(false);
    expect(isFailurePayload("Komut ok:false döndürdüğünde şunu yaparsın: …")).toBe(false);
  });

  test("an envelope that carries an answer is not a failure", () => {
    expect(isFailurePayload('{"ok":true,"answer":"cevap"}')).toBe(false);
    expect(isFailurePayload('{"error":"warn","answer":"yine de cevap"}')).toBe(false);
  });

  test("a failed expert is degraded with a reason and never quoted", async () => {
    const r = await askShared("soru", {
      namespaces: () => ["default"],
      recall: async () => [{ id: "m1", tier: "learned", score: 0.9, excerpt: "kaynak metni burada" }],
      searchFacts: async () => [],
      generate: async () => "",
      experts: {
        ollamas: async () => "ollamas cevabı [mem:m1]",
        odysseus: async () => REAL_ODYSSEUS_FAILURE,
      },
    } as any);
    expect(r.degraded).toContain("odysseus");
    expect(r.degradedReasons?.odysseus).toContain("fetch failed");
    // The whole point: the error string must not reach the vault as an expert's view.
    expect(r.expertAnswers).not.toHaveProperty("odysseus");
    expect(JSON.stringify(r.expertAnswers)).not.toContain("fetch failed");
    expect(r.expert).toBe("ollamas");
  });

  test("every non-participating seat gets a distinct, human-readable reason", async () => {
    const r = await askShared("soru", {
      namespaces: () => ["default"],
      recall: async () => [{ id: "m1", tier: "learned", score: 0.9, excerpt: "kaynak" }],
      searchFacts: async () => [],
      generate: async () => "",
      experts: {
        ollamas: async () => "gerçek cevap [mem:m1]",
        ecym: async () => "BİLGİ_YOK",
        odysseus: async () => { throw new Error("boom"); },
      },
    } as any);
    expect(r.degradedReasons?.ecym).toContain("bulamadı");
    expect(r.degradedReasons?.odysseus).toContain("boom");
    expect(r.degradedReasons?.claudecode).toContain("bağlı değil"); // never wired in this call
  });
});

describe("L34 — measured quality can overrule the gate", () => {
  const usable = ["ollamas", "ecym", "odysseus"];

  test("the live case: eCym 0.881 beats ollamas 0.694, so eCym wins", () => {
    const v = qualityVeto({ ollamas: 0.694, ecym: 0.881, odysseus: 0.084 }, "ollamas", usable, 0.15);
    expect(v).toMatchObject({ from: "ollamas", to: "ecym" });
    expect(v!.delta).toBeCloseTo(0.187, 3);
  });

  test("a narrow lead leaves the gate alone — the gate is the prior, not the enemy", () => {
    expect(qualityVeto({ ollamas: 0.70, ecym: 0.80 }, "ollamas", usable, 0.15)).toBeNull();
  });

  test("ties resolve to the gate — a veto must be an improvement, not a coin flip", () => {
    expect(qualityVeto({ ollamas: 0.8, ecym: 0.8 }, "ollamas", usable, 0)).toBeNull();
  });

  test("a degraded seat can never win a veto, however it scored", () => {
    // odysseus is not in `usable` (L33 excluded it), so it is not eligible.
    expect(qualityVeto({ ollamas: 0.1, odysseus: 0.99 }, "ollamas", ["ollamas", "ecym"], 0.15)).toBeNull();
  });

  test("no gate pick, or no other candidate, means nothing to veto", () => {
    expect(qualityVeto({ ollamas: 0.9 }, "", usable, 0.15)).toBeNull();
    expect(qualityVeto({ ollamas: 0.1, ecym: 0.9 }, "ollamas", ["ollamas"], 0.15)).toBeNull();
  });

  test("BRAIN_VETO_DELTA is a kill switch — the old behaviour is one env var away", () => {
    expect(vetoDelta({ BRAIN_VETO_DELTA: "999" })).toBe(999);
    expect(qualityVeto({ ollamas: 0.0, ecym: 1.0 }, "ollamas", usable, 999)).toBeNull();
    expect(vetoDelta({})).toBe(0.15);          // default
    expect(vetoDelta({ BRAIN_VETO_DELTA: "abc" })).toBe(0.15); // garbage → default, not 0
  });

  test("end to end: the better-grounded answer is returned and the swap is reported", async () => {
    const r = await askShared("soru", {
      namespaces: () => ["default"],
      recall: async () => [
        { id: "m1", tier: "learned", score: 0.9, excerpt: "obsidian vault brain sync launchd" },
        { id: "m2", tier: "learned", score: 0.8, excerpt: "beş dakikada bir tick atar" },
      ],
      searchFacts: async () => [],
      generate: async () => "",
      experts: {
        // Ungrounded: no citations at all.
        ollamas: async () => "Bilmiyorum ama sanırım öyle bir şey vardı.",
        // Grounded: real citations to real sources.
        ecym: async () => "Sync launchd ile beş dakikada bir çalışır [mem:m1] ve tick atar [mem:m2].",
      },
    } as any);
    expect(r.expert).toBe("ecym");
    expect(r.answer).toContain("[mem:m1]");
    expect(r.veto).toMatchObject({ from: "ollamas", to: "ecym" });
    expect(r.veto!.toScore).toBeGreaterThan(r.veto!.fromScore);
  });

  test("mixtureSelect itself is untouched — the gate path still behaves exactly as before", () => {
    const cands = [
      { expert: "ollamas", answer: "a", available: true },
      { expert: "ecym", answer: "b", available: true },
    ] as any;
    expect(mixtureSelect(cands, [0.9, 0.1]).expert).toBe("ollamas");
    expect(mixtureSelect(cands, [0.1, 0.9]).expert).toBe("ecym");
  });
});
