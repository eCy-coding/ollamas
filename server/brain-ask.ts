// Brain ASK (E2 — "en gelişmiş seviye"): a question becomes a synthesized,
// source-cited, confidence-scored natural-language answer drawn ONLY from the
// store. Injectable LLM (distill pattern) — the synthesis provider is the $0
// keyless floor, NOT ollama, so answers flow even while the local embedder is
// starved (recall itself degrades to the lexical arm, E1). Honest by design:
// no sources → abstain, never invent.
import type { BrainRecallHit, BrainFact } from "./brain";

export interface AskSource {
  id: string;
  tier: string;
  score: number;
  excerpt: string;
}

export interface AskResult {
  answer: string;
  sources: AskSource[];
  confidence: number;
  mode: "hybrid" | "lexical";
  abstained?: boolean;
}

export interface AskDeps {
  recall: (q: string, o?: { k?: number; graphExpand?: boolean; ns?: string }) => Promise<BrainRecallHit[]>;
  searchFacts: (q: string, o?: { k?: number; ns?: string }) => Promise<(BrainFact & { distance: number })[]>;
  generate: (messages: { role: string; content: string }[]) => Promise<string>;
  ns?: string;
  /** K3: instant machine-state probe — "şu an disk kaç GB?" answers from the LIVE
   *  system, not stale memories. Returns null when the question isn't about state. */
  liveContext?: (q: string) => Promise<string | null>;
  /** Multi-ns fan-out: when the caller pins no ns, recall sweeps the store's live
   *  namespaces (cap 6) and merges by score — knowledge/universe/research answers
   *  no longer hide behind an ns parameter nobody remembers to pass. */
  namespaces?: () => string[];
}

const SYNTH_PROMPT = `Sen bir kişisel hafıza asistanısın. SADECE sana verilen KAYNAK kayıtlardan yararlanarak soruyu Türkçe, kısa ve net yanıtla.
Kurallar:
- Her iddiadan sonra dayandığı kaynağı [mem:ID] biçiminde belirt.
- [mem:live:system] etiketli kaynak CANLI sistem durumudur — "şu an" soruları için birincil ve güvenilir kaynaktır, kullan.
- Kaynaklarda cevap yoksa SADECE şunu yaz: BİLGİ_YOK
- Kaynak dışına çıkma, tahmin etme, süsleme yapma.`;

/** Multi-hop widen (backlog #2): entities named by the first-pass facts seed a
 *  second recall round — connections the question's own words can't reach. */
async function widen(question: string, first: BrainRecallHit[], deps: AskDeps): Promise<BrainRecallHit[]> {
  const seen = new Set(first.map((h) => h.id));
  const out = [...first];
  try {
    const facts = await deps.searchFacts(question, { k: 4, ns: deps.ns });
    const entities = [...new Set(facts.flatMap((f) => [f.subject, f.object]))].slice(0, 4);
    for (const e of entities) {
      const extra = await deps.recall(e, { k: 2, ns: deps.ns });
      for (const h of extra) {
        if (!seen.has(h.id)) {
          seen.add(h.id);
          out.push(h);
        }
      }
    }
  } catch {
    /* widening is best-effort — the first pass already answers */
  }
  return out;
}

export async function askBrain(question: string, deps: AskDeps): Promise<AskResult> {
  const q = (question || "").trim();
  if (!q) return { answer: "", sources: [], confidence: 0, mode: "hybrid", abstained: true };
  // Knowledge-bearing namespaces lead the sweep: fresh episodic noise (git captures)
  // must not shadow taught/curated answers in the lexical arm.
  const NS_PRIORITY = ["knowledge", "universe", "research"];
  const rawNs = deps.ns ? [deps.ns] : (deps.namespaces?.() ?? ["default"]);
  const nsList = [...new Set([...NS_PRIORITY.filter((n) => rawNs.includes(n)), ...rawNs])].slice(0, 6);
  const perNs = await Promise.all(
    nsList.map((n) => deps.recall(q, { k: nsList.length > 1 ? 4 : 8, graphExpand: true, ns: n }).catch(() => [] as BrainRecallHit[])),
  );
  const byId = new Map<string, BrainRecallHit>();
  for (const h of perNs.flat()) {
    const prev = byId.get(h.id);
    if (!prev || h.score > prev.score) byId.set(h.id, h);
  }
  const first = [...byId.values()].sort((a, b) => b.score - a.score).slice(0, 8);
  const hits = (await widen(q, first, deps)).slice(0, 10);
  const mode: AskResult["mode"] = hits.some((h) => h.lexical) ? "lexical" : "hybrid";
  let live: string | null = null;
  if (deps.liveContext) {
    try { live = await deps.liveContext(q); } catch { /* live arm is best-effort */ }
  }
  if (hits.length === 0 && !live) {
    return { answer: "Kayıtlarımda bu konuda güvenilir bilgi yok.", sources: [], confidence: 0, mode, abstained: true };
  }
  const sources: AskSource[] = hits.map((h) => ({
    id: h.id,
    tier: h.tier,
    score: Number(h.score.toFixed(3)),
    excerpt: String(h.content).slice(0, 240),
  }));
  if (live) sources.unshift({ id: "live:system", tier: "live", score: 1, excerpt: live.slice(0, 400) });
  const context =
    (live ? `[mem:live:system] (CANLI sistem durumu, ŞU AN) ${live}\n` : "") +
    sources.filter((s) => s.id !== "live:system").map((s) => `[mem:${s.id}] (${s.tier}) ${s.excerpt}`).join("\n");
  const raw = await deps.generate([
    { role: "system", content: SYNTH_PROMPT },
    { role: "user", content: `SORU: ${q}\n\nKAYNAKLAR:\n${context}` },
  ]);
  const answer = (raw || "").trim();
  // confidence = evidence quality (mean source score, capped), not LLM bravado.
  const confidence = Math.min(1, sources.reduce((a, s) => a + s.score, 0) / sources.length);
  if (!answer || /BİLGİ_YOK|BILGI_YOK/.test(answer)) {
    // The live probe is deterministic truth — if the synthesizer balks, serve it raw
    // rather than abstaining while holding the answer in hand.
    if (live) return { answer: `Canlı sistem durumu [mem:live:system]: ${live}`, sources, confidence: 0.9, mode };
    return { answer: "Kayıtlarımda bu konuda güvenilir bilgi yok.", sources, confidence: 0, mode, abstained: true };
  }
  return { answer, sources, confidence: Number(confidence.toFixed(3)), mode };
}
