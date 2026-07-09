// @ts-check
// bin/host-bridge/tools/lib/ask-core.mjs — Siri arama yardımcısı SAF çekirdeği (ağ yok; deterministik; test edilir).
// siri-ask.mjs bunları kullanır; testler aynı fonksiyonları birim doğrular (web-extract paterni).

/** Doğal Türkçe matematik/mantık operatörlerini Truth-Oracle'ın DESTEKLEDİĞİ sembollere çevir
 *  (kalibrasyon: "8 kere 9 eşittir 72" → "8 * 9 = 72" → oracle Doğru der). Oracle çekirdeği DEĞİŞMEZ;
 *  yalnız Siri-tarafı girdi normalize edilir. Muhafazakâr: yalnız RAKAM içeren (aritmetik-şekilli) sorguda
 *  ve harf-sınırında çalışır → düz cümleyi bozmaz. Oracle destekli: + - * / % ** = != < > <= >= */
export function normalizeForOracle(query) {
  const orig = (query || "").trim();
  if (!/\d/.test(orig)) return orig; // aritmetik-şekilli değil → dokunma
  let q = " " + orig + " ";
  // Unicode harf-sınırı (JS \b ş/ç/ü ile güvenilmez) → lookbehind/ahead [\p{L}].
  const sub = (pat, sym) => { q = q.replace(new RegExp(`(?<![\\p{L}])(?:${pat})(?![\\p{L}])`, "giu"), ` ${sym} `); };
  // SIRA: bileşik/uzun önce (eşit değil > eşit; büyük eşit > büyük).
  sub("eşit\\s*değil(?:dir)?|esit\\s*degil(?:dir)?|farklı|farkli", "!=");
  sub("büyük\\s*eşit(?:tir)?|buyuk\\s*esit(?:tir)?", ">=");
  sub("küçük\\s*eşit(?:tir)?|kucuk\\s*esit(?:tir)?", "<=");
  sub("büyüktür|buyuktur|büyük|buyuk", ">");
  sub("küçüktür|kucuktur|küçük|kucuk", "<");
  sub("eşittir|esittir|eşit|esit", "=");
  sub("üzeri|uzeri|üssü|ussu", "**");
  sub("kere|çarpı|carpi", "*");
  sub("bölü|bolu", "/");
  sub("artı|arti", "+");
  sub("eksi", "-");
  sub("modu|mod", "%");
  q = q.replace(/(?<=\d)\s*[xX]\s*(?=\d)/g, " * "); // 8 x 9 → 8 * 9 (yalnız rakamlar arası)
  return q.replace(/\s+/g, " ").trim();
}

/** Oracle verdict + proof → kısa Türkçe sözlü cümle. SADECE TRUE/FALSE için çağrılır (güven değişmezi:
 *  "Doğru/Yanlış" yargısı YALNIZ Truth-Oracle'dan gelir). UNDECIDABLE → boş döner (araştırma yoluna düş). */
export function formatOracleSpeech(verdict, proof) {
  const p = (proof || "").replace(/\s+/g, " ").trim();
  if (verdict === "TRUE") return "Doğru." + (p ? " " + p : "");
  if (verdict === "FALSE") return "Yanlış." + (p ? " " + p : "");
  return "";
}

/** URL → kısa domain (www. atılır). */
export function domainOf(url) {
  try { return new URL(url).host.replace(/^www\./, ""); } catch { return ""; }
}

/** Metni maxLen'e kes (kelime sınırında, boşlukları sadeleştirerek). */
export function truncate(s, maxLen) {
  s = (s || "").replace(/\s+/g, " ").trim();
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen);
  const sp = cut.lastIndexOf(" ");
  return (sp > maxLen * 0.6 ? cut.slice(0, sp) : cut).trim();
}

/** deep web_search sonuçlarından ilk N kaynağı bağlam olarak seç (domain + başlık + kısaltılmış metin). */
export function pickSources(results, n = 3, perChars = null) {
  // rerank en-alakalıyı başa koyduğu için GRADUATED token-min: baş kaynak zengin, alttakiler kısa.
  // Geriye-uyumlu: perChars AÇIKÇA verilirse düz cap (test); verilmezse pozisyona göre caps[i] ?? 500.
  const caps = [1000, 700, 500];
  return (results || []).slice(0, n).map((r, i) => ({
    domain: domainOf(r.url),
    title: (r.title || "").replace(/\s+/g, " ").trim(),
    text: truncate(r.text || r.snippet || "", perChars != null ? perChars : (caps[i] != null ? caps[i] : 500)),
  })).filter((r) => r.text);
}

/** Follow-up (devam) sorusu mu? Çok-turlu bağlam için: açık devam işareti ya da çok kısa zamir/soru-eki.
 *  Muhafazakâr — standalone soruyu yanlışlıkla follow-up sanmaz (RAG multi-turn best-practice). */
export function isFollowUp(query) {
  const q = (query || "").trim();
  if (!q) return false;
  if (/^(peki|ayrıca|bir de|ya da|ya |daha |devam|onun|bunun|şunun|o da|ya o)\b/iu.test(q)) return true;
  const words = q.split(/\s+/).filter(Boolean);
  return words.length <= 2 && /^(o|bu|şu|onu|bunu|neden|niçin|nasıl|kim|nerede|peki)\b/iu.test(q);
}

/** Sentez prompt'u: Türkçe, ≤60 kelime, tek paragraf, sonunda "(kaynak: <domain>)"; verdict ile başlama YASAK.
 *  GROUNDING (RAG best-practice arXiv 2407.01219): yalnız kaynaklara dayan, kaynakta olmayanı UYDURMA.
 *  context (ops.): önceki konuşma → follow-up'ları çöz (çok-turlu). */
export function buildSynthPrompt(query, results, context) {
  const src = pickSources(results);
  const ctx = src.map((s, i) => `[${i + 1}] ${s.title} (${s.domain})\n${s.text}`).join("\n\n");
  const firstDomain = src[0]?.domain || "web";
  const lines = [];
  if (context) lines.push(`Önceki konuşma (bağlam — follow-up'ı buna göre çöz): ${context}`, ``);
  lines.push(
    `Soru: ${query}`,
    ``,
    `Kaynaklar:`,
    ctx || "(kaynak bulunamadı)",
    ``,
    `Görev: YALNIZ yukarıdaki kaynaklara dayan; kaynakta olmayanı UYDURMA. Soruyu Türkçe, en fazla 60 kelime, tek paragraf yanıtla; sonuna "(kaynak: ${firstDomain})" ekle.`,
    `"Doğru"/"Yanlış" ile BAŞLAMA (bu yargı yalnız matematiksel kesinlik içindir). Yalnız yanıtı yaz.`,
  );
  return lines.join("\n");
}

/** Research synth'i oracle-verdict gibi GÖRÜNMEKTEN kurtar: model çoğu kez yanıta "Doğru."/"Yanlış." dolgu
 *  onayıyla başlar (normal kelime, oracle yargısı DEĞİL). Bunu DISCARD etmek yerine baştaki verdict-kelimesi +
 *  noktalamayı SIYIR → gerçek yanıt korunur, güven değişmezi (research asla oracle gibi başlamaz) bozulmaz. */
export function sanitizeSynth(text) {
  const t = (text || "").trim();
  return t.replace(/^\s*["'(]?\s*(doğru|yanlış|true|false)(?![\p{L}])[\s.,:;!?…—–-]*/iu, "").trim();
}

/** Güven değişmezi: sentez metni deterministik verdict iddiası ("Doğru/Yanlış/true/false") ile BAŞLAYAMAZ. */
export function guardNoVerdict(text) {
  // Unicode-duyarlı: "ş/ğ" gibi harflerde ASCII \b çalışmaz → harf-olmayan lookahead kullan.
  return !/^\s*["'(]?\s*(doğru|yanlış|true|false)(?![\p{L}])/iu.test(text || "");
}

// ───────── web yetenekleri (araştırma / surf / dışa-bağlanma yönlendirmesi) — saf, test'li ─────────
/** Metindeki ilk http(s) URL (yoksa null) — Siri'nin "şu sayfayı oku" (--fetch) yolu için. */
export function extractUrl(query) {
  const m = (query || "").match(/https?:\/\/[^\s"'<>)\]]+/i);
  return m ? m[0].replace(/[.,;:!?]+$/, "") : null;
}

/** JS-ağır / tarayıcı-render isteği → web_search --render. */
export function wantsRender(query) {
  const q = query || "";
  return /\b(js|javascript|spa|chrome|render)\b/i.test(q) || /(dinamik|tarayıc|tarayic)/iu.test(q);
}

/** Derinlemesine araştırma / surf isteği → top↑ + one-hop link izleme. */
export function wantsDeepSurf(query) {
  return /(derinlemesine|\bderin\b|detaylı|detayli|incele|\bgez\b|surf|kapsamlı|kapsamli|araştır|arastir)/iu.test(query || "");
}

/** Çekilecek üst-N kaynak sayısı: derin istek → 5, değilse 3. */
export function topFor(query) {
  return wantsDeepSurf(query) ? 5 : 3;
}

/** ProviderRouter demo-fallback / router-hata metnini sapta (yerel model meşgulse generateText bunu döndürür). */
export function looksLikeDemo(text) {
  const t = text || "";
  return t.trim().length === 0 || /Dual-Mode Demo Fallback|LLM Mission Control|DEMO Mode|^\s*\[Router\]/i.test(t);
}

/** Türkçe-güvenli cümle bölme: ". "/"! "/"? " sonrası böl; kısaltma (Dr./Prof./vb./vs./Doç./No.) korur
 *  (ondalık 3.14 zaten ayrılmaz — noktadan sonra boşluk yok). Ayraç yoksa TÜM metni tek "cümle" döndür. Saf. */
function splitSentences(text) {
  const t = (text || "").replace(/\s+/g, " ").trim();
  if (!t) return [];
  const ABBR = /^(?:dr|prof|doç|doc|vb|vs|sn|no|av|bkz|mah|cad|sok|mr|mrs|ms|st|inc|ltd)$/i;
  const raw = t.split(/(?<=[.!?])\s+/u);
  const out = [];
  let buf = "";
  for (const seg of raw) {
    buf = buf ? buf + " " + seg : seg;
    const lastWord = (buf.replace(/[.!?]+$/, "").match(/[\p{L}\p{N}]+$/u) || [""])[0];
    if (ABBR.test(lastWord)) continue; // kısaltma → cümle sonu değil, birleştir
    out.push(buf.trim());
    buf = "";
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}

/** LLM meşgul/erişilemez → deterministik SORGU-ODAKLI çıkarımsal yanıt: üst kaynağın EN ALAKALI cümlesi
 *  (IDF-ağırlıklı sorgu-token örtüşmesi; cümle-kümesi üzerinde Lucene-smoothed) + başlık + kaynak.
 *  Sorgu yok / örtüşme yok → ilk cümle (eski davranış). Başlık DAİMA önce → verdict ile başlamaz. Saf. */
export function extractiveAnswer(results, query = "", maxWords = 45) {
  const top = (results || [])[0];
  if (!top) return "Bu konuda yeterli kaynak bulamadım.";
  const title = (top.title || "").replace(/\s+/g, " ").trim();
  const body = top.text || top.snippet || "";
  const sentences = splitSentences(body);
  let picked = sentences[0] || body;
  const qToks = queryTokens(query);
  if (qToks.length && sentences.length) {
    const sTok = sentences.map(tokenizeDoc);
    const Ns = sentences.length;
    const sdf = (t) => { let c = 0; for (const tk of sTok) if (tk.includes(t)) c += 1; return c; };
    const idf = new Map(qToks.map((t) => [t, Math.log(1 + (Ns - sdf(t) + 0.5) / (sdf(t) + 0.5))]));
    const rel = sTok.map((tk) => { let s = 0; for (const t of qToks) if (tk.includes(t)) s += idf.get(t); return s; });
    let bestS = 0, bestI = -1;
    rel.forEach((s, i) => { if (s > bestS) { bestS = s; bestI = i; } });
    if (bestI >= 0) {
      // MMR (Carbonell&Goldstein, λ=0.7): 2. cümleyi YALNIZ alaka>0 VE düşük-benzerlik ise ekle (çok-olgu).
      const LAMBDA = 0.7;
      const simJ = (a, c) => { const A = new Set(sTok[a]), B = new Set(sTok[c]); let inter = 0; for (const x of A) if (B.has(x)) inter += 1; const uni = A.size + B.size - inter; return uni ? inter / uni : 0; };
      let mmrI = -1, mmrBest = 0;
      rel.forEach((s, i) => {
        if (i === bestI || s <= 0) return;
        const m = LAMBDA * s - (1 - LAMBDA) * simJ(i, bestI) * bestS;
        if (m > mmrBest) { mmrBest = m; mmrI = i; }
      });
      const order = mmrI >= 0 ? [bestI, mmrI].sort((a, c) => a - c) : [bestI]; // doğal okuma sırasında birleştir
      picked = order.map((i) => sentences[i]).join(" ");
    }
  }
  const excerpt = clampWords(truncate(picked, 400), maxWords);
  const head = title ? title + ". " : "";
  return `${head}${excerpt} (kaynak: ${domainOf(top.url) || "web"})`.replace(/\s+/g, " ").trim();
}

/** Kaynak-uzlaşı GÜVEN skoru (deterministik, ağ yok): yanıt-token'larının kaynaklarca DESTEKLENME oranı +
 *  domain ÇEŞİTLİLİĞİ. score = 0.5·grounding + 0.5·(0.5·agreement + 0.5·diversity). Pitfall guard:
 *  tek-domain → score ≤ 0.65 (tek kaynaktan yüksek güven İDDİA ETME). Döner: { score, domains, grounding }. */
export function computeConfidence(results, answer) {
  const rs = (results || []).filter((r) => r && (r.text || r.snippet || r.title));
  const K = rs.length;
  const aToks = queryTokens(answer); // yanıt içerik token'ları (stem'li, ≥3)
  const domainsAll = [...new Set(rs.map((r) => domainOf(r.url)).filter(Boolean))];
  if (!K || !aToks.length) return { score: 0.5, domains: domainsAll.length, grounding: 0 };
  const docTok = rs.map((r) => new Set(tokenizeDoc((r.title || "") + " " + (r.text || r.snippet || ""))));
  const docDom = rs.map((r) => domainOf(r.url));
  let grounded = 0, multi = 0;
  for (const t of aToks) {
    const hit = new Set();
    docTok.forEach((set, i) => { if (set.has(t)) hit.add(docDom[i]); });
    if (hit.size >= 1) grounded += 1;
    if (hit.size >= 2) multi += 1;
  }
  const grounding = grounded / aToks.length;
  const agreement = multi / aToks.length;
  const diversity = Math.min(1, domainsAll.length / Math.min(K, 3));
  let score = 0.5 * grounding + 0.5 * (0.5 * agreement + 0.5 * diversity);
  if (domainsAll.length < 2) score = Math.min(score, 0.65); // tek-domain tavanı
  return { score: Math.max(0, Math.min(1, score)), domains: domainsAll.length, grounding };
}

// ── Hafif Türkçe STEMMER (Can et al. Türkçe IR + Snowball): muhafazakâr ek-soyma, ünlü uyumu, min-stem≥4.
//    Türev ekleri (-lik/-mak/-dik) ve -dir SOYULMAZ (anlam korunur). query+doc'a SİMETRİK uygulanır.
const _VOW = "aeıioöuü";
const _FRONT = new Set(["e", "i", "ö", "ü"]);
function _lastVowel(s) { for (let i = s.length - 1; i >= 0; i -= 1) if (_VOW.includes(s[i])) return s[i]; return ""; }
/** Ek ünlüsü stem'in son ünlüsüyle ön/art uyumlu mu? (uyum yoksa yanlış ek-sınırı → soyma). */
function _harmony(stem, suf) {
  const lv = _lastVowel(stem); let sv = ""; for (const c of suf) if (_VOW.includes(c)) { sv = c; break; }
  if (!lv || !sv) return true;
  return _FRONT.has(lv) === _FRONT.has(sv);
}
const _MIN_STEM = 4;
const _PLURAL = ["lar", "ler"];
// iyelik + hâl ekleri, UZUN→KISA (greedy). Tek ek soyulur.
const _CASE = [
  "imiz", "ımız", "ümüz", "umuz", "iniz", "ınız", "ünüz", "unuz", "leri", "ları",
  "nin", "nın", "nün", "nun", "ten", "tan", "den", "dan", "yle", "yla",
  "im", "ım", "üm", "um", "in", "ın", "ün", "un", "si", "sı", "sü", "su", "yi", "yı", "yü", "yu",
  "le", "la", "te", "ta", "de", "da", "ye", "ya",
  "i", "ı", "ü", "u", "e", "a", "n", "m",
];
function stemTurkish(word) {
  let s = word || "";
  if (s.length <= _MIN_STEM) return s; // kısa kök → dokunma (over-stemming guard)
  for (const suf of _PLURAL) {
    if (s.length - suf.length >= _MIN_STEM && s.endsWith(suf) && _harmony(s.slice(0, -suf.length), suf)) { s = s.slice(0, -suf.length); break; }
  }
  for (const suf of _CASE) {
    if (s.length - suf.length >= _MIN_STEM && s.endsWith(suf) && _harmony(s.slice(0, -suf.length), suf)) { s = s.slice(0, -suf.length); break; }
  }
  return s;
}

/** Sorgu token'ları: küçük harf, ≥3 harf/rakam, STEM'li, tekil (alaka skoru için; Unicode-güvenli ayraç). */
export function queryTokens(query) {
  const raw = (query || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
  return [...new Set(raw.map(stemTurkish))];
}

/** Doc metnini token DİZİSİNE ayır (BM25 tf/df için; queryTokens ile AYNI ayraç + AYNI stem → simetrik eşleşme).
 *  DİZİ kalmalı → df/tf TAM eleman-eşleşmesi (substring DEĞİL; aksi halde alaka bozulur). */
function tokenizeDoc(text) {
  return (text || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(stemTurkish);
}

/** Domain otorite ÇARPANI (multiplicative — additive değil; düşük-alaka kaynağı domine ettirmez). */
function authorityFactor(dom) {
  if (/(^|\.)wikipedia\.org$/.test(dom)) return 1.5;
  if (/\.gov($|\.)|\.edu($|\.)/.test(dom)) return 1.3;
  if (/(^|\.)docs?\./.test(dom)) return 1.2;
  return 1.0;
}

/** RAG kaynak RERANKING — Okapi BM25 (Robertson/Zaragoza), k1=1.2, b=0.75 + ÇARPIMSAL domain-otorite.
 *  Skor = Σ_q IDF(q)·tf·(k1+1)/(tf + k1·(1−b+b·|D|/avgdl)) · otorite. Lucene IDF smoothing
 *  idf=ln(1+(N−df+0.5)/(df+0.5)) → her zaman ≥0 (küçük-korpus negatif-IDF yok). KARARLI (eşit skor →
 *  orijinal sıra) + KİMLİK-koruyan (aynı obje referansları). Saf, ağ yok. */
export function rerankSources(query, results) {
  const docs = results || [];
  const N = docs.length;
  if (!N) return [];
  const qToks = queryTokens(query);
  // BM25F: başlık ve gövdeyi AYRI tokenize et → başlıkta geçen sorgu terimi W_TITLE kat değerli.
  const W_TITLE = 2, k1 = 1.2, b = 0.75, PROX = 0.25;
  const tTitle = docs.map((r) => tokenizeDoc(r.title || ""));
  const tBody = docs.map((r) => tokenizeDoc(r.text || r.snippet || ""));
  const dlOf = (i) => tTitle[i].length + tBody[i].length;
  const avgdl = (docs.reduce((s, _r, i) => s + dlOf(i), 0) / N) || 1;
  const df = new Map();
  for (const t of qToks) { let c = 0; for (let i = 0; i < N; i += 1) if (tTitle[i].includes(t) || tBody[i].includes(t)) c += 1; df.set(t, c); }
  const idf = (t) => Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5)); // Lucene smoothing → ≥0
  const count = (arr, t) => { let c = 0; for (const w of arr) if (w === t) c += 1; return c; };
  const score = (i) => {
    const dl = dlOf(i); if (!dl) return 0;
    let s = 0;
    for (const t of qToks) {
      const d = df.get(t); if (!d) continue;
      const tf = W_TITLE * count(tTitle[i], t) + count(tBody[i], t); // BM25F ağırlıklı tf
      if (!tf) continue;
      s += idf(t) * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (dl / avgdl)));
    }
    // Bigram YAKINLIK bonusu: ardışık sorgu-token çifti gövdede BİTİŞİK geçiyorsa (phrase eşleşmesi).
    if (qToks.length >= 2) {
      const body = tBody[i]; let adj = 0;
      for (let j = 0; j + 1 < qToks.length; j += 1) {
        const a = qToks[j], c2 = qToks[j + 1];
        for (let p = 0; p + 1 < body.length; p += 1) if (body[p] === a && body[p + 1] === c2) { adj += 1; break; }
      }
      s += PROX * adj;
    }
    return s;
  };
  return docs
    .map((r, i) => ({ r, i, s: score(i) * authorityFactor(domainOf(r.url)) }))
    .sort((a, b2) => b2.s - a.s || a.i - b2.i) // skor ↓, eşitlikte orijinal index ↑ (stable, kimlik korunur)
    .map((x) => x.r);
}

/** Metni k-KELİME shingle KÜMESİNE çevir (near-dup için; <k kelime → boş küme → Jaccard atlanır). */
function shingles(text, k = 4) {
  const w = (text || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const set = new Set();
  for (let i = 0; i + k <= w.length; i += 1) set.add(w.slice(i, i + k).join(" "));
  return set;
}

/** Jaccard benzerliği |A∩B|/|A∪B|. Küme(ler) boşsa 0 (guard: 0/0 NaN yok). */
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0; for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/** Yakın-tekrar kaynakları ele (KAYNAK ÇEŞİTLİLİĞİ): aynı host VEYA çok-benzer normalize başlık → ilkini tut;
 *  ek olarak cross-host AYNALAR için Jaccard near-dup (gövde, k=4 kelime shingle, eşik 0.9) — yalnız KALANLARLA
 *  (out) karşılaştırır. rerank'tan SONRA en-alakalı temsilci korunur. Saf; yalnız DROP eder, sıra bozmaz. */
export function dedupSources(results) {
  const seenHost = new Set();
  const seenTitle = new Set();
  const norm = (t) => (t || "").toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
  const out = [];
  const sigs = []; // out ile hizalı gövde-shingle imzaları
  for (const r of results || []) {
    const host = domainOf(r.url);
    const title = norm(r.title);
    if (host && seenHost.has(host)) continue;
    if (title && seenTitle.has(title)) continue;
    const sig = shingles(r.text || r.snippet || "", 4);
    let dup = false;
    if (sig.size) { for (const prev of sigs) if (jaccard(sig, prev) >= 0.9) { dup = true; break; } }
    if (dup) continue; // cross-host ayna → ele
    if (host) seenHost.add(host);
    if (title) seenTitle.add(title);
    out.push(r); sigs.push(sig);
  }
  return out;
}

/** En çok maxWords kelimeye indir (güvenlik kemeri — model uzun yazarsa). */
export function clampWords(text, maxWords = 60) {
  const t = (text || "").replace(/\s+/g, " ").trim();
  const words = t ? t.split(" ") : [];
  if (words.length <= maxWords) return t;
  return words.slice(0, maxWords).join(" ").replace(/[.,;:]+$/, "") + " …";
}
