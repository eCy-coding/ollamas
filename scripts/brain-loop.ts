// SONSUZ LOOP (~/Desktop/formüller.md iş akışı) — ortak-brain'in kendi kendini
// besleyen döngüsü. Her tur: zayıf-nokta sorusu üret → askShared (3 uzman, tek
// retrieval, MoE gate) → kalite kapısı → brain'e yaz → gate kalibre et → bakım.
// MacBook dostu: GPU meşgulse tur ATLANIR, tur-başı süre ve günlük yazım bütçeli,
// tek-örnek pid kilidi. Acil durdurma: BRAIN_LOOP=0. Elle tek tur: make brain-loop.
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  STRATEGIES, pickStrategy, targetsFor, freshTargets, migrateAsked, pushBacklog,
  hashQuestion, questionFromRecord, DEFAULT_TTL_MS,
  type Strategy, type TargetInput, type TargetHit, type TargetFact,
} from "../server/brain-targets";

// Hedef üretimi brain-targets.ts'e taşındı (tükenmezlik sözleşmesi orada testli).
// Geriye dönük uyum: eski çağıranlar bu adı hâlâ buradan alabilsin.
export { questionFromRecord };

const STATE_DIR = process.env.BRAIN_LOOP_DIR || join(homedir(), ".llm-mission-control");
const STATE_FILE = join(STATE_DIR, "loop-state.json");
const LOCK_FILE = join(STATE_DIR, "loop.lock");
const METRICS_FILE = join(STATE_DIR, "loop-metrics.jsonl");
// gate.json artık server/brain-gate-store.ts'in sorumluluğunda (atomik + yedekli).

/** Her turun sonucu ölçülür — ATLANAN tur da bir sonuçtur. Sessiz başarısızlık
 *  ancak ölçülürse görünür (tur 42-53 boşa uyanışı elle log okunana dek fark
 *  edilmemişti). Ölçüm best-effort: asla turu düşürmez. */
async function record(m: Record<string, unknown>): Promise<void> {
  try {
    const { appendMetric } = await import("../server/brain-loop-health");
    appendMetric(METRICS_FILE, { at: Date.now(), ...m } as any);
  } catch { /* ölçüm turu bloklamaz */ }
}

/** Sorulan soru bu süre sonra yeniden hedef olabilir (bilgi bayatlar, yeniden sorulur). */
const ASK_TTL_MS = Number(process.env.BRAIN_LOOP_TTL_MS) || DEFAULT_TTL_MS;
/** Birikmiş hedef kuyruğu tavanı. */
const BACKLOG_CAP = 200;
/** `asked` sözlüğü bu boyutu aşarsa en eski kayıtlar budanır (dosya şişmesin). */
const ASKED_CAP = 2000;

// Tohum ve namespace HER TUR DÖNER — tek sabit sorgu kusur-3'ün köküydü.
// Tur başına yalnız bir recall yapılır (recall = embed = GPU); rotasyon çeşitliliği
// zamana yayar, ısıya değil.
const SEEDS = [
  "ollamas brain kod sistem",
  "loop formül gate retrieval vektör",
  "server route api endpoint istek",
  "test vitest kalite kapısı hata",
  "launchd servis daemon port süreç",
  "embedding sqlite store şema",
  "odysseus ecym uzman model",
  "gotcha kök neden düzeltme",
];
const NS_POOL = ["knowledge", "universe", "loop", "default", "research", "org", "code"];

/** Kayıt içeriklerinden olgu-araması için özne adayları (tırnaklı terimler). */
export function subjectsFrom(hits: { content: string }[]): string[] {
  const out: string[] = [];
  for (const h of hits) {
    const m = String(h.content ?? "").match(/'([^']{2,60})'/);
    if (m) out.push(m[1]);
  }
  return [...new Set(out)];
}

/** Profil vektörü (p_u) bu kadar turda bir tazelenir. Her tur yeniden hesaplamak
 *  3 ekstra embed = 3 ekstra GPU çağrısı demekti; profil yavaş değişen bir şeydir. */
const PROFILE_REFRESH_TURNS = 20;
/** Gate eğitimi bu kadar turda bir koşar — her tur eğitmek gereksiz, veri yavaş birikir. */
const GATE_TRAIN_EVERY = Number(process.env.BRAIN_GATE_TRAIN_EVERY) || 10;

export interface LoopState {
  turn: number;
  day: string;
  writesToday: number;
  /** F3c: önbelleklenmiş p_u kaynağı — geçmiş soruların gömme vektörleri. */
  profile?: { vectors: number[][]; at: number; turn: number };
  /** Son sorulan soruların METNİ (hash değil) — p_u'nun kaynağı budur.
   *  Yalnız hash tutulunca profil mevcut soruya düşüyor ve p_u ≈ q oluyordu:
   *  matematiksel olarak geçerli ama ANLAMSIZ bir profil (kendini işaret eder). */
  recentQuestions?: string[];
  /** hash → sorulma zamanı. TTL dolunca soru yeniden taze olur (kusur-3 panzehiri). */
  asked: Record<string, number>;
  /** Üretilip o tur kullanılmayan hedefler — hiçbir strateji üretmezse buradan drene edilir. */
  backlog: string[];
  lastAt: number;
}

export function loadState(): LoopState {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const raw = JSON.parse(readFileSync(STATE_FILE, "utf8")) as Partial<LoopState> & { askedHashes?: string[] };
    // Göç: eski `askedHashes: string[]` → `asked: Record<hash, ts>` (ts=0 → derhal taze).
    const s: LoopState = {
      turn: raw.turn ?? 0,
      day: raw.day ?? today,
      writesToday: raw.writesToday ?? 0,
      asked: migrateAsked(raw.asked ?? raw.askedHashes),
      backlog: Array.isArray(raw.backlog) ? raw.backlog : [],
      profile: raw.profile,
      recentQuestions: Array.isArray(raw.recentQuestions) ? raw.recentQuestions : [],
      lastAt: raw.lastAt ?? 0,
    };
    return s.day === today ? s : { ...s, day: today, writesToday: 0 };
  } catch {
    return { turn: 0, day: today, writesToday: 0, asked: {}, backlog: [], lastAt: 0 };
  }
}

export function saveState(s: LoopState): void {
  try { mkdirSync(STATE_DIR, { recursive: true }); writeFileSync(STATE_FILE, JSON.stringify(s, null, 1)); } catch { /* best-effort */ }
}

/** Pure: günlük yazım bütçesi. Tekrar-koruması artık freshTargets'ın TTL'inde. */
export function shouldAsk(state: LoopState, maxWrites: number): boolean {
  return state.writesToday < maxWrites;
}

/** Pure: stratejileri turdan başlayarak gez, ilk TAZE hedefi seç, kalanı backlog'a it.
 *  Hiçbir strateji üretmezse backlog drene edilir — bu yüzden loop tükenmez. */
export function selectTarget(
  state: LoopState,
  input: TargetInput,
  now: number,
  ttlMs: number = ASK_TTL_MS,
): { question: string; strategy: Strategy | ""; backlog: string[] } {
  let backlog = state.backlog;
  for (let i = 0; i < STRATEGIES.length; i++) {
    const s = pickStrategy(state.turn + i);
    const cands = targetsFor(s, input);
    if (!cands.length) continue;
    const fresh = freshTargets(cands, state.asked, now, ttlMs);
    if (fresh.length) {
      backlog = pushBacklog(backlog, fresh.slice(1), BACKLOG_CAP);
      return { question: fresh[0], strategy: s, backlog };
    }
    backlog = pushBacklog(backlog, cands, BACKLOG_CAP);
  }
  // Son çare: birikmiş kuyruk.
  const drained = freshTargets(backlog, state.asked, now, ttlMs);
  if (drained.length) {
    return { question: drained[0], strategy: "backlog", backlog: backlog.filter((b) => b !== drained[0]) };
  }
  return { question: "", strategy: "", backlog };
}

const hash = hashQuestion;

const API = process.env.OLLAMAS_URL || "http://127.0.0.1:3000";

/** Loop'un TEK dış yüzeyi. Modül düzeyinde: hem tur akışı hem sandbox egzersizcisi
 *  aynı istemciyi kullanır (iki ayrı tanım = iki ayrı timeout/hata davranışı riski). */
const api = async (path: string, body?: unknown, ms = 30_000): Promise<any> => {
  const r = await fetch(`${API}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(ms),
  });
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return r.json();
};

// G7: llmActive() is in-process module state (server/gpu-coordinator.ts). This loop
// runs as a fresh `tsx` process every launchd tick, so importing it directly always
// reads a blank, always-idle copy — it can never see the live :3000 server's real
// GPU state. The loop is already an HTTP client of :3000 for everything else; ask it
// over HTTP instead. Best-effort: if the check itself fails (server down, network),
// treat as not-busy — the loop already tolerates :3000 being unreachable elsewhere.
const checkGpuActive = () => api("/api/brain/gpu-status").then((r) => !!r?.active).catch(() => false);

/** Sandbox koşusuna ayrılan azami süre. p95 tavanı (30s) ALTINDA tutulur ki
 *  aşım sessizce geçmesin, terfi kapısında hata olarak görünsün. */
const SANDBOX_MS = Number(process.env.BRAIN_SANDBOX_MS) || 20_000;

/**
 * Bir yeteneği sandbox'ta koştur — canlı davranış DEĞİŞMEZ, yalnız ölçülür.
 *
 * Altyapı arızaları (embedder 503, bağlantı) `withCapability`'ye GİRİLMEDEN elenir:
 * `maxErrors: 0` olduğu için tek bir 503 yeteneği 20 tur terfi edemez hâle getirirdi,
 * yani sunucunun geçici meşguliyeti yeteneğin kalitesi hakkında kalıcı yargıya
 * dönüşürdü. Bu en kolay yapılan hata — ölçüm altyapıyı yeteneğe yazmamalı.
 */
async function exerciseSandbox(
  turn: number, t0: number, budgetMs: number, r: any,
): Promise<void> {
  const { loadLedger, withCapability, ensureCap } = await import("../server/brain-capability-runner");
  const { sandboxIdFor } = await import("../server/brain-capabilities");
  const { shouldExercise, alreadyRanThisTurn, isInfraFailure } = await import("../server/brain-sandbox");

  const ledger = loadLedger();
  // gate-ce-train'in KENDİ dalı var (adım 3.5, turn%10). Egzersizci rotasyonuna da
  // girerse sandbox slotlarının 1/3'ü "tanımsız koşu" diye boşa gider — canlı ilk
  // turda görüldü. Egzersizci yalnız kendi koşusu OLMAYAN yetenekleri döndürür.
  const OWN_PATH = new Set(["gate-ce-train"]);
  const eligible = { ...ledger, caps: Object.fromEntries(Object.entries(ledger.caps).filter(([k]) => !OWN_PATH.has(k))) };
  const id = sandboxIdFor(eligible, turn);
  if (!id) return; // terfi bekleyen yetenek yok

  const cap = ensureCap(ledger, id);
  if (alreadyRanThisTurn(cap, turn)) return; // gate-ce-train kendi dalından koşmuş olabilir

  const gate = shouldExercise({ gpuBusy: await checkGpuActive(), elapsedMs: Date.now() - t0, budgetMs });
  if (!gate.ok) {
    console.log(JSON.stringify({ event: "brain.sandbox", id, skipped: gate.why }));
    return;
  }

  const sources = (r?.sources ?? []) as { id: string; excerpt: string; score: number }[];
  if (!sources.length) return;

  // --- Altyapıya dokunan hazırlık: BURADA patlarsa yetenek suçlanmaz. ---
  let prepared: { run: () => Promise<any>; metricOf: (x: any) => number | undefined };
  try {
    prepared = await prepareSandboxRun(id, r, sources);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    console.log(JSON.stringify({
      event: "brain.sandbox", id,
      skipped: isInfraFailure(msg) ? "altyapı" : "hazırlık",
      detail: msg.slice(0, 100),
    }));
    return; // koşu KAYDEDİLMEZ — hata sayılmaz
  }

  const bounded = () => Promise.race([
    prepared.run(),
    new Promise<never>((_, rej) => {
      const t = setTimeout(() => rej(new Error(`sandbox exceeded ${SANDBOX_MS}ms`)), SANDBOX_MS);
      (t as { unref?: () => void }).unref?.();
    }),
  ]);

  try {
    // Durum-farkında mod: candidate ise CANLI-GÖLGE (mode:"live") — canlı-pencereyi
    // biriktir ki candidate→autonomous tıkanmasın; sandbox ise ölçüm (mode:"sandbox").
    // Her iki modda da çıktı ATILIR (withCapability); yalnız otonomlaşınca kullanılır.
    const exerciseMode = cap.status === "candidate" ? "live" : "sandbox";
    await withCapability(id, bounded, async () => ({}), {
      ledger, turn, mode: exerciseMode, metricOf: prepared.metricOf,
      // Altyapı hatası (fetch failed/timeout/503) yeteneği karantinaya almasın —
      // canlı-gölge HTTP :3000'e bağlı; geçici hıçkırık reatt/ragseq'i haksızca gömüyordu.
      isInfraError: isInfraFailure,
    });
    const after = loadLedger().caps[id];
    console.log(JSON.stringify({
      event: "brain.sandbox", id, mode: exerciseMode, status: after?.status,
      runs: after?.runs.length, metric: after?.runs.at(-1)?.metric,
    }));
  } catch { /* withCapability zaten yutar; buraya düşmez */ }
}

/** Yetenek başına sandbox koşusu + METRİĞİ. Metriklerin dürüstlük sınıfı için
 *  her dalın kendi yorumuna bakın — hepsi "kalite" ölçmez. */
async function prepareSandboxRun(
  id: string, r: any, sources: { id: string; excerpt: string; score: number }[],
): Promise<{ run: () => Promise<any>; metricOf: (x: any) => number | undefined }> {
  if (id === "reatt-rerank") {
    // METRİK SINIFI: GERÇEK ama ZAYIF-DENETİMLİ kalite.
    // citedRankGain = cevabın atıf yaptığı kaynakların yeniden sıralamadaki MRR'ı
    // eksi orijinal sıralamadaki MRR'ı. DÜRÜSTLÜK SINIRI: atıflar ORİJİNAL sırayla
    // üretilmiş bir cevaptan geliyor → etiket temele doğru YANLI. Pozitif delta
    // güvenilir, negatif delta belirsizdir.
    const { reattRerank, mrr } = await import("../server/brain-reatt");
    const { openEmbedCache } = await import("../server/brain-embed-cache");
    const { citationIds } = await import("../server/brain-answer-score");
    const qVec: number[] = r?.qVec ?? [];
    if (!qVec.length) throw new Error("qVec yok — ReAtt sorgu parçası kuramaz");
    const cache = openEmbedCache();
    const embed = async (text: string) => {
      const hit = cache.get("pending", text);
      if (hit) return { vector: hit, spaceId: "pending" };
      const res = await api("/api/brain/embed", { text }, 15_000); // 503 burada patlar → altyapı
      cache.set(res.spaceId, text, res.vector);
      return { vector: res.vector, spaceId: res.spaceId };
    };
    const cited = citationIds(String(r?.answer ?? ""));
    return {
      run: async () => {
        const out = await reattRerank(qVec, sources as any, { embed, cache });
        cache.flush();
        return { ...out, citedRankGain: mrr(out.reranked, cited) - mrr(out.original, cited) };
      },
      metricOf: (x) => x?.citedRankGain,
    };
  }

  if (id === "ragseq-weighting") {
    // METRİK SINIFI: YALNIZ GÜVENLİK/YAPI — cevap kalitesi DEĞİL.
    // Gerçek kalite ikinci bir generation isterdi (tur başına iki kat LLM).
    // citedRetention: cevabın atıf yaptığı kaynaklar ağırlıklandırılmış bağlamda
    // hâlâ duruyor mu. Bir ağırlıklandırma cevabın kullandığı kaynağı atıyorsa
    // temellendirmeyi bozar — bunun gerçek dişi var, ama "daha iyi cevap" demez.
    const { sequenceWeights, weightedContext } = await import("../server/brain-formulas");
    const { citationIds } = await import("../server/brain-answer-score");
    const cited = citationIds(String(r?.answer ?? ""));
    const budget = Number(process.env.BRAIN_RAGSEQ_BUDGET) || 4000;
    return {
      run: async () => {
        const p = sequenceWeights(sources.map((s) => s.score ?? 0));
        const ctx = weightedContext(sources as any, p, budget);
        if (ctx.length > budget * 1.5) throw new Error(`bağlam bütçeyi aştı: ${ctx.length}>${budget}`);
        const missing = sources.filter((s) => !ctx.includes(`[mem:${s.id}]`));
        if (missing.length) throw new Error(`MIN_SHARE ihlali: ${missing.length} kaynak düştü`);
        const kept = cited.filter((c) => ctx.includes(`[mem:${c}]`)).length;
        return { citedRetention: cited.length ? kept / cited.length : 1, len: ctx.length };
      },
      metricOf: (x) => x?.citedRetention,
    };
  }

  throw new Error(`sandbox koşusu tanımsız: ${id}`);
}

async function main() {
  if (process.env.BRAIN_LOOP === "0") return;
  // Loop bir İSTEMCİdir: brain.db'yi doğrudan AÇMAZ, canlı :3000 API'sini kullanır.
  // Böylece paylaşımlı checkout'ta başka lane'in WIP'i (embed provider-id fingerprint
  // geçişi) loop'u düşürmez, WAL kilidi ve provider-mismatch yüzeyi sıfırlanır.
  const t0 = Date.now();
  const budgetMs = Number(process.env.BRAIN_LOOP_BUDGET_MS) || 90_000;
  const maxWrites = Number(process.env.BRAIN_LOOP_MAX_WRITES) || 40;

  // Tek örnek: eski kilit (>10dk) bayat sayılır, aksi halde bu tur atlanır.
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    if (existsSync(LOCK_FILE)) {
      const age = Date.now() - Number(readFileSync(LOCK_FILE, "utf8").split("|")[1] || 0);
      if (age < 600_000) { console.log(JSON.stringify({ event: "brain.loop", skipped: "locked" })); await record({ turn: 0, ms: 0, wrote: false, skipped: "locked" }); return; }
    }
    writeFileSync(LOCK_FILE, `${process.pid}|${Date.now()}`);
  } catch { /* kilit yazılamadıysa yine de devam */ }

  try {
    if (await checkGpuActive()) { console.log(JSON.stringify({ event: "brain.loop", skipped: "gpu-busy" })); await record({ turn: 0, ms: Date.now() - t0, wrote: false, skipped: "gpu-busy" }); return; }

    const httpRecall = async (q: string, o: { k?: number; ns?: string } = {}) =>
      (await api("/api/brain/recall", { query: q, k: o.k ?? 5, ns: o.ns })).hits ?? [];
    const { askShared } = await import("../server/brain-shared");
    const { resolveDistillProvider } = await import("../server/brain-active");
    const { ProviderRouter } = await import("../server/providers");
    const { liveSystemContext } = await import("../server/brain-system");
    const { emptyGate } = await import("../server/brain-formulas");

    const state = loadState();
    state.turn++;

    // 1) HEDEF SEÇİMİ — sabit sorgu YOK (kusur-3). Tohum ve namespace her tur döner;
    //    tur başına YALNIZ BİR recall yapılır çünkü recall = embed = GPU (ısı bütçesi).
    const seed = SEEDS[state.turn % SEEDS.length];
    const ns = NS_POOL[state.turn % NS_POOL.length];
    const rawHits = await httpRecall(seed, { k: 12, ns });
    const hits: TargetHit[] = rawHits.map((h: any) => ({
      id: h.id, content: String(h.content ?? ""), conf: h.conf ?? h.confidence,
      usage: h.hits ?? 0, ns,
    }));

    // Olgular ucuz (embed YOK, doğrudan arama) → çelişki avı için ilk birkaç özne.
    const facts: TargetFact[] = [];
    for (const subj of subjectsFrom(hits).slice(0, 3)) {
      try {
        const r = await api(`/api/brain/facts?subject=${encodeURIComponent(subj)}`, undefined, 8_000);
        for (const f of (r.facts ?? []).slice(0, 8)) {
          facts.push({ subject: f.subject, predicate: f.predicate, object: String(f.object), conf: f.conf ?? f.confidence });
        }
      } catch { /* olgu araması best-effort */ }
    }

    // Kapsama: dönen ns bu tur kaç kayıt verdi — ns rotasyonu sayesinde 7 turda hepsi taranır.
    const input: TargetInput = { hits, facts, namespaces: [{ ns, count: hits.length }], backlog: state.backlog };

    const picked = selectTarget(state, input, Date.now());
    state.backlog = picked.backlog;
    const question = picked.question;
    if (!question) {
      console.log(JSON.stringify({ event: "brain.loop", turn: state.turn, skipped: "no-fresh-target", seed, ns }));
      await record({ turn: state.turn, ms: Date.now() - t0, wrote: false, skipped: "no-fresh-target", ns });
      saveState(state); return;
    }
    const qHash = hash(question);
    // Günlük yazma bütçesi YALNIZ brain'e fact-yazmayı kısar — turun yetenek ÖLÇÜMÜNÜ
    // değil. Egzersizci (canlı-gölge) brain'e YAZMAZ; onu yazma kotasına bağlamak
    // candidate→autonomous'u sonsuza dek tıkıyordu (aç kalan ölçüm yolu: kota dolunca
    // tüm tur — egzersiz dahil — atlanıyordu). GPU-kibarlığını yukarıdaki gpu-busy gate
    // korur; burada yalnız fact-yazma durur, tur geri kalanı (askShared + egzersiz) koşar.
    const writeAllowed = shouldAsk(state, maxWrites);

    // 2) Ortak-brain: tek retrieval → üç uzman → gate.
    // Gate artık ATOMİK okunur/yazılır ve bozuksa son-iyi yedeğe düşer.
    const { loadGate, saveGate: persistGate } = await import("../server/brain-gate-store");
    const { mulberry32, fnv1a } = await import("../server/brain-explore");
    const { appendOutcome, readOutcomes } = await import("../server/brain-outcome-ledger");
    // Hangi yetenekler CANLI koşabilir — terfi kapısı karar verir, kod değil.
    const capsAutonomous: string[] = await (async () => {
      try {
        const { loadLedger } = await import("../server/brain-capability-runner");
        const { autonomousIds } = await import("../server/brain-capabilities");
        return autonomousIds(loadLedger());
      } catch { return []; } // defter okunamazsa HİÇBİRİ canlı değil (güvenli yön)
    })();
    const gate = loadGate() ?? emptyGate(768);

    // F3c bağımlılıkları — HTTP üzerinden (loop brain.db'yi AÇMAZ, sözleşme).
    const embed = async (text: string): Promise<number[]> =>
      (await api("/api/brain/embed", { text }, 20_000)).vector;
    const recallVec = async (vec: number[], o: { k?: number; ns?: string; graphExpand?: boolean } = {}) =>
      (await api("/api/brain/recall", { query: question, vector: vec, k: o.k ?? 5, ns: o.ns })).hits ?? [];

    // Profil (p_u): PROFILE_REFRESH_TURNS turda bir tazelenir — her tur 3 embed
    // yakmak yerine. Profil yavaş değişir, sıcaklık bütçesi değişmez.
    let profileVecs = state.profile?.vectors ?? [];
    const prior = (state.recentQuestions ?? []).filter((s) => s && s !== question);
    const profileStale = !state.profile || state.turn - state.profile.turn >= PROFILE_REFRESH_TURNS;
    // p_u YALNIZ geçmiş sorulardan kurulur. Geçmiş yoksa profil KURULMAZ — mevcut
    // soruyu tohum yapmak p_u ≈ q verirdi, yani q* = q(1+λ): yönü değişmeyen, hiçbir
    // şey öğretmeyen sahte bir kişiselleştirme. Yoksa yok demek daha dürüst.
    if (profileStale && prior.length) {
      try {
        profileVecs = await Promise.all(prior.slice(-3).map((s) => embed(s)));
        state.profile = { vectors: profileVecs, at: Date.now(), turn: state.turn };
      } catch { /* profil best-effort — yoksa kişiselleştirme kapalı, tur düşmez */ }
    }
    const gen = (provider: string, model?: string) => async (messages: { role: string; content: string }[]) =>
      (await ProviderRouter.generate({ provider, model: model || "openai", messages, stream: false } as any)).text || "";

    // Recheck right before dispatch (fresher than the top-of-turn gate above — recall/
    // embed/profile-refresh took real time, GPU state may have moved on since).
    const ecymGpuBusy = await checkGpuActive();

    const askPromise = askShared(question, {
      recall: (q: string, o: any) => httpRecall(q, o),
      searchFacts: async () => [], // semantik fact araması HTTP yüzeyinde yok → widen atlanır
      namespaces: () => ["knowledge", "universe", "loop", "default", "research", "org"],
      liveContext: liveSystemContext,
      generate: gen(resolveDistillProvider(process.env)),
      gate,
      // askShared artık gate'e YAZMAZ (öz-doğrulama kaldırıldı — kusur G). Eğitim
      // aşağıda, toplu ve terfi kapısının arkasında yapılır. Sözleşme gereği duruyor.
      saveGate: (g: any) => { persistGate(g); },
      // F3c: gate'i besleyen gömme + q*'ı retrieval'a taşıyan vektör-recall.
      embed,
      recallVec,
      profileVectors: async () => profileVecs,
      // (F3b keşif) YALNIZ loop keşfeder; canlı kullanıcı sorgusu (HTTP yolu) ε=0
      // kalır. Tohum sorudan türetilir → aynı soru aynı kararı verir, tekrarlanabilir.
      // (F3a) Bağlamı p_ret'e göre paylaştırma — YALNIZ yetenek terfi ettiyse.
      ragSeq: capsAutonomous.includes("ragseq-weighting"),
      epsilon: Number(process.env.BRAIN_EXPLORE_EPSILON ?? 0.15),
      rng: mulberry32(fnv1a(question)),
      // Turun DIŞSAL sonucu deftere — gate eğitiminin ham verisi (kendi argmax'ı DEĞİL).
      onOutcome: (o: { q: number[]; scores: number[] }) =>
        appendOutcome({ at: Date.now(), turn: state.turn, q: o.q, scores: o.scores }),
      experts: {
        ollamas: gen(resolveDistillProvider(process.env)),
        // eCym yerel modeldir: GPU'yu chat LLM ile paylaşır → yalnız boştayken katılır.
        ecym: ecymGpuBusy ? undefined : gen("ollama-local", process.env.ECY_MODEL || "ecy"),
        odysseus: async (messages: { role: string; content: string }[]) => {
          const { ToolRegistry } = await import("../server/tool-registry");
          const out = await ToolRegistry.execute("mcp__odysseus__odysseus_chat",
            { prompt: messages[1].content, model: "ollamas-auto" }, { source: "brain-loop" } as any);
          return typeof out === "string" ? out : JSON.stringify(out).slice(0, 4000);
        },
      },
    } as any);
    // Tur bütçesi: askShared'ın kendi uzman-timeout'ları var; bu çit toplam turu bağlar.
    const r: any = await Promise.race([
      askPromise,
      new Promise<never>((_, rej) => {
        const t = setTimeout(() => rej(new Error(`loop turn exceeded ${budgetMs}ms`)), budgetMs);
        (t as { unref?: () => void }).unref?.();
      }),
    ]);

    // 3) Kalite kapısı → öğrenilen bilgi brain'e (ns=loop, conf 0.7).
    let wrote = false;
    if (writeAllowed && !r.abstained && r.sources.length >= 2 && r.answer.length > 40) {
      await api("/api/brain/remember", {
        id: `loop:${qHash}`, tier: "learned", ns: "loop", actor: r.expert || "loop",
        confidence: 0.7, source: "brain-loop",
        content: `S: ${question}\nY(${r.expert}): ${r.answer.slice(0, 1200)}`,
      });
      wrote = true;
      state.writesToday++;
    }
    // Soru sorulmuş olarak damgalanır — TTL dolunca yeniden hedef olabilir.
    state.asked[qHash] = Date.now();
    // Metni de sakla: bir sonraki turun p_u'su GEÇMİŞ sorulardan kurulur.
    state.recentQuestions = [...(state.recentQuestions ?? []), question].slice(-10);
    const askedKeys = Object.keys(state.asked);
    if (askedKeys.length > ASKED_CAP) {
      // En eski damgalar düşer (dosya sınırsız büyümesin).
      const keep = askedKeys.sort((a, b) => (state.asked[b] ?? 0) - (state.asked[a] ?? 0)).slice(0, ASKED_CAP);
      state.asked = Object.fromEntries(keep.map((k) => [k, state.asked[k]]));
    }
    state.lastAt = Date.now();
    saveState(state);

    // 3.6) SANDBOX EGZERSİZCİSİ — kusur S'nin panzehiri.
    // Terfi 10 sandbox koşusu ister; hiçbir şey yetenekleri koşturmadığı için üçü
    // sonsuza dek sandbox'ta kalıyordu (kısır döngü). Burada her tur BİR yetenek,
    // turun GERÇEK verisiyle, canlı davranışı değiştirmeden ölçülür.
    // Yazımdan SONRA çalışır: sandbox çökerse turun asıl işi zaten kaydedilmiştir.
    try {
      await exerciseSandbox(state.turn, t0, budgetMs, r);
    } catch (e: any) {
      console.warn(JSON.stringify({ event: "brain.sandbox", error: String(e?.message ?? e).slice(0, 120) }));
    }

    // 3.5) GATE EĞİTİMİ — kusur G'nin yerine geçen mekanizma.
    // Öz-doğrulayan tur-içi dürtme yerine: biriken DIŞSAL puanlar üzerinde toplu
    // cross-entropy. Terfi kapısının ARKASINDA (withCapability'nin ilk üretim
    // kullanımı): `gate-ce-train` otonom değilken sandbox'ta ölçülür, gate'e
    // DOKUNMAZ; baraj geçilince canlıya alınır.
    if (state.turn % GATE_TRAIN_EVERY === 0) {
      try {
        const { loadLedger } = await import("../server/brain-capability-runner");
        const { withCapability } = await import("../server/brain-capability-runner");
        const { autonomousIds } = await import("../server/brain-capabilities");
        const { trainGate } = await import("../server/brain-gate-train");
        const ledger = loadLedger();
        const mode = autonomousIds(ledger).includes("gate-ce-train") ? "live" : "sandbox";
        const rows = readOutcomes(500);
        const res = await withCapability(
          "gate-ce-train",
          async () => {
            const { gate: trained, losses } = trainGate(gate, rows);
            // İNCELİK: withCapability sandbox SONUCUNU ATAR → kalıcılaştırma
            // sarmalayıcıyla değil, BURADA mode'a bakılarak yapılmalı.
            if (mode === "live" && losses.length) persistGate(trained);
            return { rows: rows.length, drop: losses.length ? losses[0] - losses[losses.length - 1] : 0 };
          },
          async () => ({ rows: rows.length, drop: 0 }),
          { ledger, turn: state.turn, mode, metricOf: (r: any) => r?.drop },
        );
        console.log(JSON.stringify({ event: "brain.gate.train", mode, ...res }));
      } catch (e: any) {
        console.warn(JSON.stringify({ event: "brain.gate.train", error: String(e?.message ?? e).slice(0, 120) }));
      }
    }

    // 4) Bakım: her 4 turda backfill + ekosistem senkronu (üç sistem güncel kalır).
    if (state.turn % 4 === 0 && Date.now() - t0 < budgetMs) {
      // Bakım canlı sürecin işi (store sahibi o) — loop yalnız tetikleyici olabilir;
      // burada sadece ekosistem senkronu koşar.
      try {
        const { execFileSync } = await import("node:child_process");
        execFileSync("npx", ["tsx", "scripts/ecosystem-sync.ts"], { timeout: 30_000, stdio: "ignore" });
      } catch { /* senkron best-effort */ }
    }

    console.log(JSON.stringify({
      event: "brain.loop", turn: state.turn, strategy: picked.strategy, seed, ns,
      question: question.slice(0, 70), expert: r.expert,
      weights: r.weights, sources: r.sources.length, confidence: r.confidence, degraded: r.degraded,
      wrote, writesToday: state.writesToday, backlog: state.backlog.length, ms: Date.now() - t0,
    }));
    await record({
      turn: state.turn, ms: Date.now() - t0, strategy: picked.strategy, ns, expert: r.expert,
      wrote, sources: r.sources.length, confidence: r.confidence, degraded: r.degraded,
    });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    // 503/meşgul geçici bir DURUM, hata değil: tur sessizce atlanır, 15 dk sonra
    // tekrar denenir (canlı ilk otomatik turda yakalandı).
    const kind = /HTTP 503|embedder busy/i.test(msg) ? "embedder-busy"
      : /provider mismatch/i.test(msg) ? "embed-provider-mismatch"
      : /timed out|exceeded/i.test(msg) ? "budget"
      : /HTTP 5\d\d|fetch failed|ECONNREFUSED/i.test(msg) ? "server-unavailable"
      : "error";
    console.warn(JSON.stringify({ event: "brain.loop", [kind === "error" ? "error" : "skipped"]: kind, detail: msg.slice(0, 160) }));
    await record({ turn: 0, ms: Date.now() - t0, wrote: false, skipped: kind });
  } finally {
    try { unlinkSync(LOCK_FILE); } catch { /* zaten yok */ }
    // Kusursuz loop şartı: iş bitince SÜREÇ de biter. Yarıda kalan sağlayıcı
    // fetch'leri (ollama stall-retry gibi) event-loop'u dakikalarca açık tutuyordu —
    // launchd her 15dk yeni süreç açsaydı süreçler birikirdi. İş bitti, çık.
    if (process.env.BRAIN_LOOP_NO_EXIT !== "1") setTimeout(() => process.exit(0), 50).unref?.();
  }
}

if (process.argv[1]?.includes("brain-loop")) void main();
