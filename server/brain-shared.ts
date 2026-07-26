// Ortak-brain çok-uzman pipeline (~/Desktop/formüller.md §3b): TEK retrieval
// (R_k(x)) → aynı bağlam üç uzmana (ollamas · eCym · odysseus) → MoE gate w_j(x)
// → p_final seçimi. Kişiselleştirme (q* = q + λ·p_u) retrieval'dan ÖNCE uygulanır.
// Erişilemeyen uzman degrade edilir ve ağırlıklar kalanlar üzerinde renormalize olur —
// hiçbir uzman zorunlu değildir (degrade-alive sözleşmesi).
import { readFileSync, statSync } from "node:fs";
import { gatherContext, type AskDeps, type AskSource } from "./brain-ask";
import {
  EXPERTS, emptyGate, gateLogits, gateWeights, heuristicBias, mixtureSelect,
  personalizeQuery, profileVector, l2normalize, sequenceWeights, weightedContext, qualityVeto,
  type Candidate, type Expert, type MixtureResult, type Veto,
} from "./brain-formulas";
import { scoreAll, isFailurePayload, failureReason } from "./brain-answer-score";
import { exploreSelect } from "./brain-explore";

/** Boyut koruması: `gateLogits` eksik boyutu `?? 0` ile doldurur, yani 8-boyutlu bayat
 *  bir gate 768-boyutlu q ile SESSİZCE yalnız ilk 8 boyutu kullanırdı. Uyuşmazlıkta
 *  öğrenilmiş gate'i kullanmaktansa sıfırdan başlarız — sessiz bozulmaktansa görünür
 *  soğuk başlangıç. Saf ve dışa açık: davranış doğrudan test edilebilsin. */
export function usableGate(supplied: Gate | undefined, dim: number): Gate {
  // Reject on dim mismatch AND on expert-count (row) mismatch: after a new expert is added
  // the persisted gate has too few rows, which would silently zero-weight the newcomer.
  // Falling back to emptyGate cold-starts a correctly-sized gate that re-calibrates.
  const ok = supplied && supplied.W[0]?.length === dim && supplied.W.length === EXPERTS.length;
  return ok ? supplied : emptyGate(dim);
}

/** Keşif seçimi: ağırlıklar yine renormalize edilir ama KAZANAN zorlanır.
 *  mixtureSelect argmax'ı seçer; keşifte bilinçli olarak argmax DIŞINI istiyoruz. */
function forcePick(candidates: Candidate[], w: number[], index: number): MixtureResult {
  const base = mixtureSelect(candidates, w);
  const c = candidates[index];
  if (!c || !c.available || !c.answer?.trim()) return base;
  return { ...base, expert: String(c.expert), answer: c.answer };
}

// L1 (kalibrasyon turu 2): kapsül katmanı (`cc-capsules.py` → TL;DR ≤200B) Claude Code'un
// kendi araçlarında (terminal.ts `cckb`) ve eCym'de ÖLÇÜLMÜŞ bir kazanç (terminal.ts yorumu:
// ham `recall k=4` ~26.6 KB → `cckb ask` ~1 KB, 25,6×; bkz. `_index/cc-token.md`). ollamas'ın
// KENDİ claudecode uzmanı bu kazancın dışındaydı: tek retrieval SHARED_PROMPT'la birlikte
// üç uzmanla (ollamas/ecym/odysseus) BİREBİR aynı KAYNAKLAR bloğunu alıyordu. Aşağıdaki iki
// fonksiyon YALNIZ claudecode'a giden `claude-code:<slug>` kaynaklarının gövdesini aynı
// kapsül dosyasından okunan TL;DR'a küçültür — diğer üç uzman ve retrieval'ın kendisi
// (ctx.sources, pRet, gate) DEĞİŞMEZ.
const CC_ID_PREFIX = "claude-code:";
let capsuleCache: { mtimeMs: number; bySlug: Map<string, string> } | null = null;

/** `_index/cc-capsules.json`'u oku + mtime'a göre önbelleğe al (her turda diskten okumamak
 *  için). Dosya yoksa/bozuksa ASLA fırlatmaz — boş Map döner, çağıran orijinal gövdeye düşer. */
function capsuleTldrs(): Map<string, string> {
  const file = `${process.env.OBSIDIAN_VAULT || `${process.env.HOME}/ollamas-vault`}/_index/cc-capsules.json`;
  try {
    const mtimeMs = statSync(file).mtimeMs;
    if (capsuleCache && capsuleCache.mtimeMs === mtimeMs) return capsuleCache.bySlug;
    const data = JSON.parse(readFileSync(file, "utf8")) as { capsules?: { slug?: string; tldr?: string }[] };
    const bySlug = new Map<string, string>();
    for (const c of data.capsules ?? []) {
      if (c?.slug && typeof c.tldr === "string" && c.tldr) bySlug.set(c.slug, c.tldr);
    }
    capsuleCache = { mtimeMs, bySlug };
    return bySlug;
  } catch {
    // Kapsül dosyası yok / bozuk / okunamıyor: son iyi önbelleğe (varsa) düş, yoksa boş Map —
    // her iki durumda da çağıran orijinal (kırpılmamış) gövdeye zarifçe düşer.
    return capsuleCache?.bySlug ?? new Map();
  }
}

/** claudecode'a giden KAYNAKLAR bloğu: `claude-code:<slug>` kaynaklarının `excerpt`'i (zaten
 *  ≤240B'ye kırpılmış, bkz. brain-ask.ts) varsa kapsül TL;DR'ı ile değiştirilir; kapsül
 *  yoksa/slug eşleşmezse mevcut gövdeye (zaten ≤240B — spesin istediği "~400B'ye düş" burada
 *  fiilen no-op'tur, güvenlik ağı) düşülür. Diğer kaynaklar OLDUĞU GİBİ kalır. brain-ask.ts'nin
 *  `context` birleştirme biçimiyle (live-önek + `[mem:id] (tier) gövde` satırları) BİREBİR aynı
 *  format — yalnız gövde değişir, format sapması riski yok. ASLA fırlatmaz (try/catch dışta). */
function claudecodeContext(
  sources: AskSource[],
  live: string | null,
  ragSeq: boolean,
  pRet: number[],
  budget: number,
): string {
  const tldrs = capsuleTldrs();
  const shrunk: AskSource[] = sources.map((s) => {
    if (!s.id.startsWith(CC_ID_PREFIX)) return s;
    const slug = s.id.slice(CC_ID_PREFIX.length);
    const tldr = tldrs.get(slug);
    return tldr ? { ...s, excerpt: tldr } : { ...s, excerpt: s.excerpt.slice(0, 400) };
  });
  if (ragSeq && shrunk.length) return weightedContext(shrunk, pRet, budget);
  return (live ? `[mem:live:system] (CANLI sistem durumu, ŞU AN) ${live}\n` : "")
    + shrunk.filter((s) => s.id !== "live:system").map((s) => `[mem:${s.id}] (${s.tier}) ${s.excerpt}`).join("\n");
}

export interface SharedAskResult {
  answer: string;
  expert: string;
  weights: Record<string, number>;
  sources: AskSource[];
  confidence: number;
  mode: "hybrid" | "lexical";
  hops: number;
  degraded: string[];
  personalized: boolean;
  abstained?: boolean;
  /** Uzman başına DIŞSAL kalite puanı (EXPERTS sırasında) — gate'in öğrenme etiketi. */
  scores?: Record<string, number>;
  /** L14 şeffaflık: her uzmanın (boş-olmayan) cevabı — kazanan seçilmeden önce. */
  expertAnswers?: Record<string, string>;
  /** Bu tur keşif amaçlı argmax DIŞI bir uzman mı seçildi. */
  explored?: boolean;
  /** L33: NEDEN her düşen uzman düştü — `degraded[]` sadece kim olduğunu söylüyordu. */
  degradedReasons?: Record<string, string>;
  /** L34: ölçülen kalite gate'in seçimini ezdiyse ne olduğu (yoksa gate kazandı). */
  veto?: Veto | null;
  /** Formül 3a: kaynak başına p_ret(z|x) — bağlam payının dayanağı. */
  pRet?: number[];
  /** Sandbox egzersizcisinin ReAtt kolu için sorgu vektörü — yeniden gömme YOK.
   *  ASLA loglanmaz/metriğe yazılmaz: 768 float, log'u da metriği de şişirir. */
  qVec?: number[];
  /** KİŞİSELLEŞTİRME ÖNCESİ ham sorgu gömmesi (q, q* DEĞİL). HTTP route bunu profile
   *  yazar; q* yazmak profili kendi çıktısıyla besleyip λ'yı büyütürdü (drift). */
  baseQVec?: number[];
  /** Ağırlıklandırılmamış KAYNAKLAR bloğu — ragseq sandbox'ının karşılaştırma tabanı. */
  context?: string;
}

export interface Gate { W: number[][]; b: number[] }

export interface SharedDeps extends AskDeps {
  /** Uzman üreticileri; her biri aynı (system,user) mesajlarını alır. Eksik olan
   *  uzman "erişilemez" sayılır (weights renormalize). */
  experts: Partial<Record<Expert, (messages: { role: string; content: string }[]) => Promise<string>>>;
  /** Kişiselleştirme için kullanıcı geçmişi gömme vektörleri (p_u kaynağı). */
  profileVectors?: () => Promise<number[][]>;
  /** Sorgu gömme — q* hesaplamak için (yoksa kişiselleştirme atlanır). */
  embed?: (text: string) => Promise<number[]>;
  /** Öğrenilen gate; yoksa boş (uniform + heuristik bias). */
  gate?: Gate;
  /** Gate güncellemesini kalıcılaştırma. askShared BUNU ARTIK ÇAĞIRMAZ (öz-doğrulama
   *  kaldırıldı); eğitim toplu ve ayrıdır (brain-gate-train.ts). Arayüzde kalıyor
   *  çünkü eğitim adımını koşturan çağıran (loop) hâlâ gate'i yazar. */
  saveGate?: (g: Gate) => void;
  /** ε-greedy keşif oranı. 0 (varsayılan) ⇒ daima argmax, bit-aynı davranış. */
  epsilon?: number;
  /** Keşif için enjekte edilen rastgelelik (Math.random YOK — tekrarlanabilirlik). */
  rng?: () => number;
  /** Her turun DIŞSAL sonucu — gate eğitiminin ham verisi. */
  onOutcome?: (o: { q: number[]; scores: number[]; picked: number; explored: boolean }) => void;
  /** Formül 3a: bağlamı p_ret'e göre yeniden paylaştır. Varsayılan kapalı —
   *  `ragseq-weighting` yeteneği terfi edene dek canlıya inmez. */
  ragSeq?: boolean;
  /** L35: uzman-başı durum notu (ör. eCym hafif modele düştü / GPU meşgul). Katılan uzman
   *  için bilgi, katılmayan için degradedReasons'a düşen SEBEP. Çağıran seat'i çözerken
   *  öğrendiğini panele taşır — yoksa "neden yoktu" bilgisi çağıranda hapsolur. */
  expertNotes?: Partial<Record<Expert, string>>;
  // `recallVec` artık AskDeps'ten miras alınır. Buradaki yinelenen bildirim
  // `Promise<unknown>` dönüyordu; hiç çağrılmadığı için uyuşmazlık yıllarca
  // görünmedi. Tek tanım = tek doğruluk kaynağı.
}

/** Uzman başına sert zaman sınırı (bounded-race deseni): yerel model / uzak halka
 *  asılırsa TÜM tur takılmasın — süresi dolan uzman "erişilemez" sayılır. */
const expertTimeoutMs = (): number => Number(process.env.BRAIN_EXPERT_TIMEOUT_MS) || 25_000;

/** RAG-Seq bağlam bütçesi (karakter). Prompt'un kaynak bloğunun üst sınırı. */
const ragSeqBudget = (): number => Number(process.env.BRAIN_RAGSEQ_BUDGET) || 4000;

function bounded<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`expert timed out after ${ms}ms`)), ms);
    (t as { unref?: () => void }).unref?.();
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

const SHARED_PROMPT_BASE = `Sen ollamas ortak-brain uzmanısın. SADECE verilen KAYNAK kayıtlardan yararlanarak Türkçe, kısa ve net yanıtla.
Kurallar:
- Her iddiadan sonra [mem:ID] biçiminde kaynak belirt.
- Düşük-güven (conf≤0.5) kaynakları ihtiyatla kullan; çelişkide yüksek-güveni seç.
- Kaynaklarda cevap yoksa SADECE: BİLGİ_YOK
- Tahmin etme, süsleme yapma.`;

/**
 * Kod politikası bloğu — learn tier'ının ollamas'a GİRDİĞİ yer.
 *
 * NEDEN BURADA
 * Learn tier'ı önce yalnız SORULABİLİR bir bilgi yığınıydı: uzman isterse `learnkb ask` diye
 * arayabilirdi, ama davranışı değişmiyordu. Bir sistem, kuralı KARAR ANINDA görmedikçe öğrenmiş
 * sayılmaz. Bu blok, `_index/learn-policy.json` içindeki `hata` ağırlıklı kuralları her turda
 * sistem mesajına ekler; uzman kod önerirken kuralı ve GEREKÇESİNİ birlikte görür.
 *
 * Kalıp yeni değil: `capsuleTldrs()` zaten `cc-capsules.json`'u aynı biçimde (mtime önbellekli,
 * hata durumunda sessizce boş) okuyor. Aynı disiplin: dosya yoksa/bozuksa ASLA fırlatmaz —
 * politika bloğu boş kalır ve tur bozulmadan devam eder.
 *
 * Bütçe: yalnız `hata` kuralları, kural başına tek satır (~90 B). 14 kural ≈ 1.3 KB — bir
 * `recall` yanıtının yirmide biri, ve her turda ödenmesi kabul edilen tek sabit maliyet.
 */
let policyCache: { mtimeMs: number; text: string } | null = null;

function policyBlock(): string {
  const file = `${process.env.OBSIDIAN_VAULT || `${process.env.HOME}/ollamas-vault`}/_index/learn-policy.json`;
  try {
    const mtimeMs = statSync(file).mtimeMs;
    if (policyCache && policyCache.mtimeMs === mtimeMs) return policyCache.text;
    const data = JSON.parse(readFileSync(file, "utf8")) as {
      rules?: { id?: string; severity?: string; fix?: string; why?: string }[];
    };
    // Yalnız DÜZELTME satırı gömülür, gerekçe gömülmez. Ölçüldü: kural başına gerekçeyle
    // birlikte blok 3.176 B, gerekçesiz 1.4 KB. Gerekçe tek `learnkb get <id>` uzakta ve blok
    // bunu söylüyor — tier'ın kendi dersi (`agents-progressive-context`) tam olarak bunu
    // dayatıyor: oturum bağlamı ÖZET değil İŞARET olmalı, çünkü her istekte yeniden ödenir.
    const lines = (data.rules ?? [])
      .filter((r) => r?.severity === "hata" && r.fix)
      .map((r) => `- [${r.id}] ${r.fix}`);
    const text = lines.length
      ? `\nKOD KURALLARI (learn tier · ihlal = hata):\n${lines.join("\n")}\n` +
        `Kod önerirken bu kurallara uy. Gerekçesi gerekiyorsa \`learnkb get <id>\`; uymayan bir şey ` +
        `istenirse kuralın id'sini söyleyerek reddet.`
      : "";
    policyCache = { mtimeMs, text };
    return text;
  } catch {
    return ""; // best-effort: politika dosyası yoksa uzman eskisi gibi çalışır
  }
}

/** Ortak sistem mesajı + (varsa) kod politikası. Her çağrıda tazelenir, dosya mtime'ıyla önbellekli. */
function sharedPrompt(): string {
  return SHARED_PROMPT_BASE + policyBlock();
}

/** λ — kullanıcı profilinin retrieval'a etkisi (formül 3c). 0 = kapalı. */
export const personalizeLambda = (env: { BRAIN_PERSONALIZE_LAMBDA?: string } = process.env): number => {
  const n = Number(env.BRAIN_PERSONALIZE_LAMBDA);
  return Number.isFinite(n) && n >= 0 ? n : 0.2;
};

export async function askShared(question: string, deps: SharedDeps): Promise<SharedAskResult> {
  const q = (question || "").trim();
  if (!q) return { answer: "", expert: "", weights: {}, sources: [], confidence: 0, mode: "hybrid", hops: 0, degraded: [], personalized: false, abstained: true };

  // (3c) Kişiselleştirme: q* = q + λ·p_u.
  //
  // ÖNEMLİ (2026-07-20 kök-düzeltme): burası eskiden `embed && profileVectors &&
  // recallVec` ÜÇÜNÜ birden şart koşuyordu. Hiçbir çağıran üçünü de vermediği için
  // qVec DAİMA null kalıyordu → gateLogits boş vektör alıyor → W_g hiç çarpılmıyor →
  // gate kalıcı olarak yalnız heuristicBias regex'iydi ve updateGate hiç çalışmadı
  // (gate.json dosyası hiç oluşmamıştı). Artık koşullar AYRIŞTI:
  //   • embed varsa           → qVec üretilir, gate GERÇEKTEN öğrenir.
  //   • profil de varsa       → q* = q + λ·p_u (kişiselleştirme).
  //   • recallVec de varsa    → q* retrieval'ı GERÇEKTEN sürer (yoksa yalnız gate'i besler).
  // Böylece eksik bağımlılık tüm zinciri öldürmez, sadece kendi katkısını düşürür.
  let personalized = false;
  let qVec: number[] | null = null;
  let baseQVec: number[] | null = null;
  const lambda = personalizeLambda();
  if (deps.embed) {
    try {
      qVec = await deps.embed(q);
      baseQVec = qVec; // kişiselleştirmeden ÖNCE — profile bunu yazılır (q, q* değil)
      if (lambda > 0 && deps.profileVectors) {
        const history = await deps.profileVectors();
        if (history.length) {
          qVec = personalizeQuery(qVec, profileVector(history), lambda);
          // "personalized" YALNIZ q* gerçekten retrieval'ı sürdüyse doğrudur —
          // aksi halde rapor kendini kandırır.
          personalized = !!deps.recallVec;
        }
      }
    } catch { /* gömme best-effort — qVec null kalır, düz metin yoluyla devam */ }
  }

  // (2) TEK retrieval: R_k(x) tüm uzmanlara AYNI gider. q* varsa vektörle sürülür.
  const ctx = await gatherContext(q, deps, qVec);

  // (3a RAG-Sequence) p_ret dağılımı HER ZAMAN hesaplanır (bedava, raporlanır).
  // Bağlamın p_ret'e göre yeniden paylaştırılması ise yetenek bayrağına bağlı:
  // canlıya ancak terfi kapısından geçerek iner.
  const pRet = sequenceWeights(ctx.sources.map((s) => s.score ?? 0));
  const contextText = deps.ragSeq && ctx.sources.length
    ? weightedContext(ctx.sources, pRet, ragSeqBudget())
    : ctx.context;

  const userMsg = `SORU: ${q}\n\nKAYNAKLAR:\n${contextText}`;
  const messages = [
    { role: "system", content: sharedPrompt() },
    { role: "user", content: userMsg },
  ];

  // L1: claudecode'a giden KAYNAKLAR'ı kapsül boyutuna indir (bkz. claudecodeContext üstteki
  // yorum). Best-effort — herhangi bir hata paylaşılan `messages`'a (diğer üç uzmanın aldığı
  // BİREBİR aynı bağlam) zarifçe düşer, tur ASLA bundan dolayı bozulmaz.
  let claudecodeContextText = contextText;
  try {
    claudecodeContextText = claudecodeContext(ctx.sources, ctx.live, !!deps.ragSeq, pRet, ragSeqBudget());
  } catch { /* kapsül katmanı best-effort — paylaşılan bağlama düş */ }
  const claudecodeMessages = claudecodeContextText === contextText ? messages : [
    { role: "system", content: sharedPrompt() },
    { role: "user", content: `SORU: ${q}\n\nKAYNAKLAR:\n${claudecodeContextText}` },
  ];

  // (3b) Uzman çıktıları — paralel, her biri best-effort.
  // L33: a seat that FAILED is recorded with its reason rather than being passed off as an
  // opinion. Previously a tool-error envelope was non-empty text, so it counted as a usable
  // candidate, `degraded` came back empty, and the raw error JSON was rendered in the vault
  // as that expert's view. Silence and failure now look different, and both are named.
  const degradedReasons: Record<string, string> = {};
  // Seat notes the caller already knows (L35). A note for an expert that DOES answer stays
  // informational; for one that does not, it becomes the reason it is missing.
  const seatNotes: Record<string, string> = { ...(deps.expertNotes ?? {}) } as Record<string, string>;
  const answers = await Promise.all(
    EXPERTS.map(async (e) => {
      const fn = deps.experts[e];
      if (!fn) { degradedReasons[e] = seatNotes[e] ?? "erişilemez (uzman bağlı değil)"; return { expert: e, answer: "", available: false }; }
      // L1: yalnız claudecode kapsül-küçültülmüş bağlamı alır; diğer üçü (ollamas/ecym/
      // odysseus) BİREBİR aynı `messages`'ı almaya devam eder — davranışları değişmez.
      const m = e === "claudecode" ? claudecodeMessages : messages;
      try {
        const raw = (await bounded(fn(m), expertTimeoutMs()))?.trim() ?? "";
        if (isFailurePayload(raw)) { degradedReasons[e] = failureReason(raw); return { expert: e, answer: "", available: false }; }
        if (/BİLGİ_YOK|BILGI_YOK/.test(raw)) { degradedReasons[e] = "kaynaklarda cevap bulamadı"; return { expert: e, answer: "", available: false }; }
        return { expert: e, answer: raw, available: true };
      } catch (err: any) {
        degradedReasons[e] = `hata: ${String(err?.message ?? err).slice(0, 120)}`;
        return { expert: e, answer: "", available: false };
      }
    }),
  );

  // (3b) w_j(x) = softmax(W_g q + b_g) + soğuk-başlangıç heuristik biası.
  // Boyut koruması: gateLogits eksik boyutu `?? 0` ile doldurur, yani 8-boyutlu bayat
  // bir gate 768-boyutlu q ile SESSİZCE ilk 8 boyutu kullanırdı. Uyuşmazlıkta öğrenilmiş
  // gate'i kullanmak yerine sıfırdan başlarız — sessiz bozulmaktansa görünür soğuk başlangıç.
  const dim = qVec?.length ?? 8;
  const gate = usableGate(deps.gate, dim);
  const bias = heuristicBias(q);
  // Gate YÖNE bakar, büyüklüğe değil: ham nomic vektörü |q|≈20 ve logitleri o oranda
  // şişirip heuristik biası ezerdi; ayrıca eğitim tarafı da normalize ediyor
  // (brain-gate-train.ts) — eğitim ve çıkarım AYNI temsilde olmalı.
  // Retrieval ham vektörü kullanmaya devam eder (normalize etmek recall'ı bozuyordu).
  const gateVec = qVec ? l2normalize(qVec) : [];
  const logits = gateLogits(gateVec, gate.W, gate.b).map((l, j) => l + (bias[j] ?? 0));
  const w = gateWeights(logits);

  // DIŞSAL etiket: üç uzmanın cevabı ZATEN hesaplandı → üçünü de puanlamak bedava.
  // Gate'in öğrenmesi gereken sinyal budur, kendi argmax'ı değil.
  const scores = scoreAll(answers, ctx.sources);
  const scoreMap = Object.fromEntries(EXPERTS.map((x, j) => [x, scores[j] ?? 0]));
  // L14: every expert's non-empty answer, for transparency (the Obsidian answer note shows
  // all four, not just the winner). Trimmed so a note stays readable.
  const expertAnswers = Object.fromEntries(answers.filter((a) => a.answer).map((a) => [a.expert, a.answer.slice(0, 1200)]));

  // (F3b keşif) ε olasılıkla argmax DIŞI bir uzman seçilir. Gerekçe: gate hep
  // argmax'ı seçerse kaybeden uzmanların cevabı hiç değerlendirilmez ve eğitim
  // verisi tek uzmandan gelir — doğru etiketle bile öz-doğrulama sürerdi.
  // ε=0 (varsayılan, canlı HTTP yolu) ⇒ davranış bit-aynı, sıfır gerileme.
  const epsilon = deps.epsilon ?? 0;
  const explore = epsilon > 0 && deps.rng
    ? exploreSelect(w, EXPERTS.map((e) => answers.find((a) => a.expert === e)?.available ?? false), { epsilon, rng: deps.rng })
    : { index: -1, explored: false };
  const gatePicked = explore.explored && explore.index >= 0
    ? forcePick(answers, w, explore.index)
    : mixtureSelect(answers, w);

  // L34: measured quality may overrule the gate's argmax. Exploration is left alone — when a
  // turn is deliberately off-policy, second-guessing it would defeat the point.
  const usableExperts = answers.filter((a) => a.available && a.answer.trim()).map((a) => String(a.expert));
  const veto = explore.explored ? null : qualityVeto(scoreMap, gatePicked.expert, usableExperts);
  const picked = veto
    ? { ...gatePicked, expert: veto.to, answer: answers.find((a) => a.expert === veto.to)?.answer ?? gatePicked.answer }
    : gatePicked;

  const confidence = ctx.sources.length
    ? Number((ctx.sources.reduce((a, s) => a + (s.conf ?? s.score ?? 0), 0) / ctx.sources.length).toFixed(3))
    : 0;

  if (!picked.answer) {
    return {
      answer: "Kayıtlarımda bu konuda güvenilir bilgi yok.",
      expert: "", weights: picked.weights, sources: ctx.sources, confidence: 0,
      mode: ctx.mode, hops: ctx.hops, degraded: picked.degraded, degradedReasons, personalized, abstained: true,
      scores: scoreMap, explored: explore.explored, pRet,
      qVec: qVec ?? undefined, baseQVec: baseQVec ?? undefined, context: ctx.context,
    };
  }

  // (F3b öğrenme) KALDIRILDI: burada eskiden `updateGate(..., indexOf(picked.expert))`
  // vardı — yani gate KENDİ argmax'ıyla eğitiliyordu. Etiketi kendi tahmini olan bir
  // öğrenici yetkinlik öğrenemez, yalnız başlangıç eğilimini büyütür. Ölçülen sonuç:
  // W satır L2 [0.358, 0.304, 0.660] ve son 11 yazımın 11'i tek uzman (üstelik 11 turun
  // 9'unda üç uzman da MEVCUTTU → erişilebilirlik artefaktı değil, öz-doğrulama).
  //
  // Yerine: üç uzmanın da cevabı DIŞSAL olarak puanlanır (brain-answer-score.ts) ve
  // ham sonuç deftere yazılır; eğitim ayrı ve toplu yapılır (brain-gate-train.ts,
  // cross-entropy + L2 tavanı). Bu fonksiyon artık gate'e YAZMAZ.
  if (deps.onOutcome && qVec) {
    try {
      deps.onOutcome({ q: qVec, scores, picked: EXPERTS.indexOf(picked.expert as Expert), explored: explore.explored });
    } catch { /* defter best-effort — turu bloklamaz */ }
  }

  return {
    answer: picked.answer,
    expert: picked.expert,
    weights: picked.weights,
    expertAnswers,
    sources: ctx.sources,
    confidence,
    mode: ctx.mode,
    hops: ctx.hops,
    degraded: picked.degraded,
    degradedReasons,
    veto,
    personalized,
    scores: scoreMap,
    explored: explore.explored,
    pRet,
    qVec: qVec ?? undefined,
    baseQVec: baseQVec ?? undefined,
    context: ctx.context,
  };
}
