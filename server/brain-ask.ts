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
  /** Provenance confidence (#10/#12) when the row carries one. */
  conf?: number;
}

export interface AskResult {
  answer: string;
  sources: AskSource[];
  confidence: number;
  mode: "hybrid" | "lexical";
  abstained?: boolean;
  /** Retrieval rounds actually run (1 = single pass, 2 = deepen fired). */
  hops?: number;
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
- Düşük-güven işaretli (conf≤0.5, LLM-üretimi) kaynakları ihtiyatla kullan; çelişkide yüksek-güvenli kaynağı seç.
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

/** Retrieval katmanı — askBrain ve askShared (ortak-brain, çok-uzman) AYNI bağlamı
 *  kullansın diye ayrıldı: tek retrieval, R_k(x) tüm uzmanlara aynı gider (formüller.md
 *  3b: her model aynı p_ret üzerinden aynı k belgeyi çeker). */
export async function gatherContext(question: string, deps: AskDeps): Promise<{
  sources: AskSource[]; context: string; mode: AskResult["mode"]; hops: number; live: string | null;
}> {
  const q = (question || "").trim();
  const r = await askInternal(q, deps, true);
  return { sources: r.sources, context: r.context!, mode: r.mode, hops: r.hops ?? 1, live: r.live ?? null };
}

export async function askBrain(question: string, deps: AskDeps): Promise<AskResult> {
  const r = await askInternal((question || "").trim(), deps, false);
  delete (r as { context?: string }).context;
  delete (r as { live?: string | null }).live;
  return r;
}

async function askInternal(
  q: string,
  deps: AskDeps,
  contextOnly: boolean,
): Promise<AskResult & { context?: string; live?: string | null }> {
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
  let hops = 1;
  let widened = await widen(q, first, deps);
  // İleri-düzey: true iterative deepening (gap #2). When evidence is thin (few
  // sources or weak top score), question tokens NOT yet covered by any source
  // become a second retrieval wave — deterministic, zero-LLM, one extra hop max.
  if (widened.length < 4 || (widened[0]?.score ?? 0) < 0.5) {
    const covered = widened.map((h) => String(h.content).toLowerCase()).join(" ");
    const missing = [...new Set((q.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []))]
      .filter((t) => !covered.includes(t))
      .slice(0, 3);
    if (missing.length) {
      hops = 2;
      const seen = new Set(widened.map((h) => h.id));
      for (const term of missing) {
        const extra = await deps.recall(term, { k: 3, ns: deps.ns }).catch(() => [] as BrainRecallHit[]);
        for (const h of extra) if (!seen.has(h.id)) { seen.add(h.id); widened.push(h); }
      }
      widened.sort((a, b) => b.score - a.score);
    }
  }
  const hits = widened.slice(0, 10);
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
    ...((h as { confidence?: number | null }).confidence != null ? { conf: (h as any).confidence } : {}),
  }));
  if (live) sources.unshift({ id: "live:system", tier: "live", score: 1, excerpt: live.slice(0, 400) });
  const context =
    (live ? `[mem:live:system] (CANLI sistem durumu, ŞU AN) ${live}\n` : "") +
    sources.filter((s) => s.id !== "live:system").map((s) => `[mem:${s.id}] (${s.tier}) ${s.excerpt}`).join("\n");
  if (contextOnly) {
    return { answer: "", sources, confidence: 0, mode, hops, context, live };
  }
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
  return { answer, sources, confidence: Number(confidence.toFixed(3)), mode, hops };
}
