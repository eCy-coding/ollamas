// brain-loop saf yüzeyi. Hedef üretiminin kendisi server/brain-targets.test.ts'te;
// burada loop'a özgü sözleşme test edilir: bütçe, özne çıkarımı ve — en kritik —
// selectTarget'ın havuzu kalıcı tüketememesi (kusur-3: tur 42-53 ölü uyanış).
import { describe, it, expect } from "vitest";
import { shouldAsk, selectTarget, subjectsFrom, type LoopState } from "../brain-loop";
import { hashQuestion, DEFAULT_TTL_MS, type TargetInput } from "../../server/brain-targets";

const state = (over: Partial<LoopState> = {}): LoopState =>
  ({ turn: 1, day: "2026-07-20", writesToday: 0, asked: {}, backlog: [], lastAt: 0, ...over });

const input: TargetInput = {
  hits: [
    { id: "m1", content: "ollamas kod-deseni 'guarded-alter': şema evrimi.", conf: 0.9, usage: 0 },
    { id: "m2", content: "Brain 'recall-hybrid' vektör+BM25 birleştirir.", conf: 0.4, usage: 3 },
  ],
};

describe("brain-loop (saf)", () => {
  it("günlük yazım bütçesi", () => {
    expect(shouldAsk(state(), 40)).toBe(true);
    expect(shouldAsk(state({ writesToday: 40 }), 40)).toBe(false);
  });

  it("tırnaklı terimlerden olgu-araması özneleri çıkarır", () => {
    expect(subjectsFrom(input.hits!)).toEqual(["guarded-alter", "recall-hybrid"]);
    expect(subjectsFrom([{ content: "tırnaksız içerik" }])).toEqual([]);
  });

  it("taze hedef bulur", () => {
    const r = selectTarget(state(), input, 1_000);
    expect(r.question).toBeTruthy();
    expect(r.strategy).toBeTruthy();
  });

  it("KUSUR-3 KİLİDİ: her aday sorulmuş olsa bile TTL sonrası hedef YENİDEN doğar", () => {
    // Bu turda üretilebilecek her hedefi "sorulmuş" damgala — eski davranışta
    // burası kalıcı ölümdü (askedHashes hiç boşalmıyordu).
    const asked: Record<string, number> = {};
    for (let t = 0; t < 12; t++) {
      const r = selectTarget(state({ turn: t }), input, 1_000);
      if (r.question) asked[hashQuestion(r.question)] = 1_000;
    }
    // TTL dolduktan sonra havuz yeniden açılır.
    const later = selectTarget(state({ asked }), input, 1_000 + DEFAULT_TTL_MS + 1);
    expect(later.question).toBeTruthy();
  });

  it("hiç girdi yoksa boş hedef döner (çökmeden, temiz atlama)", () => {
    const r = selectTarget(state(), {}, 1_000);
    expect(r.question).toBe("");
    expect(r.strategy).toBe("");
  });

  it("hiçbir strateji üretmezse backlog drene edilir", () => {
    const r = selectTarget(state({ backlog: ["birikmiş hedef"] }), {}, 1_000);
    expect(r.question).toBe("birikmiş hedef");
    expect(r.strategy).toBe("backlog");
    expect(r.backlog).not.toContain("birikmiş hedef"); // tüketilen kuyruktan düşer
  });
});
