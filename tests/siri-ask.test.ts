// Güven testleri — Siri arama yardımcısı: saf çekirdek (ask-core) + yerel shortcut üreteci (recipeSiri).
// OFFLINE/deterministik: ağ/model/say yok. Güven değişmezi: "Doğru/Yanlış" yalnız Oracle'dan.
import { describe, test, expect, beforeAll } from "vitest";
import { recipeSiri, buildWorkflowPlist, askAction, runShellAction, speakAction } from "../cli/lib/shortcuts";

let core: any;
beforeAll(async () => {
  // @ts-ignore — host-bridge .mjs (tip dosyası yok)
  core = await import("../bin/host-bridge/tools/lib/ask-core.mjs");
});

describe("ask-core — Siri yardımcı saf çekirdek (deterministik)", () => {
  test("formatOracleSpeech: TRUE→Doğru, FALSE→Yanlış, UNDECIDABLE→boş (güven değişmezi)", () => {
    expect(core.formatOracleSpeech("TRUE", "SOL = 4, SAĞ = 4 ⇒ true")).toMatch(/^Doğru\. /);
    expect(core.formatOracleSpeech("FALSE", "SOL = 4, SAĞ = 5 ⇒ false")).toMatch(/^Yanlış\. /);
    expect(core.formatOracleSpeech("UNDECIDABLE", "x")).toBe("");
  });

  test("buildSynthPrompt: Türkçe ≤60 kelime + kaynak + verdict-ile-başlama yasağı + sorgu/domain", () => {
    const p = core.buildSynthPrompt("RAG nedir?", [
      { title: "Retrieval-augmented generation", url: "https://en.wikipedia.org/wiki/RAG", text: "RAG, bilgi getirip üretimi zenginleştirir ".repeat(20) },
    ]);
    expect(p).toContain("60");
    expect(p).toContain("kaynak: en.wikipedia.org");
    expect(p).toContain("BAŞLAMA");           // "Doğru/Yanlış diye BAŞLAMA" uyarısı
    expect(p).toContain("RAG nedir?");
    expect(p).toContain("en.wikipedia.org");
  });

  test("guardNoVerdict: sentez 'Doğru/Yanlış' ile BAŞLAYAMAZ (sadece Oracle verdict verir)", () => {
    expect(core.guardNoVerdict("Doğru, çünkü ...")).toBe(false);
    expect(core.guardNoVerdict("Yanlış bir bilgi ...")).toBe(false);
    expect(core.guardNoVerdict('"Doğru" ...')).toBe(false);
    expect(core.guardNoVerdict("RAG, getirimle üretimi zenginleştirir (kaynak: x)")).toBe(true);
  });

  test("looksLikeDemo: provider demo-fallback / boş metni saptar; gerçek yanıtı geçirir", () => {
    expect(core.looksLikeDemo("[LLM Mission Control - Dual-Mode Demo Fallback] Hello!")).toBe(true);
    expect(core.looksLikeDemo("")).toBe(true);
    expect(core.looksLikeDemo("RAG, getirimle üretimi zenginleştirir (kaynak: x)")).toBe(false);
  });

  test("extractiveAnswer: LLM meşgulse kaynak-temelli deterministik yanıt (başlık + alıntı + kaynak)", () => {
    const a = core.extractiveAnswer([
      { title: "Retrieval-augmented generation", url: "https://en.wikipedia.org/wiki/RAG", text: "RAG is a technique that augments generation with retrieved documents ".repeat(6) },
    ]);
    expect(a).toContain("Retrieval-augmented generation");
    expect(a).toContain("(kaynak: en.wikipedia.org)");
    expect(core.guardNoVerdict(a)).toBe(true); // çıkarımsal yanıt da verdict ile başlamaz
    expect(core.extractiveAnswer([])).toMatch(/kaynak bulamadım/);
  });

  test("normalizeForOracle: Türkçe op → sembol (aritmetik-şekilli, kalibrasyon)", () => {
    expect(core.normalizeForOracle("8 kere 9 eşittir 72")).toBe("8 * 9 = 72");
    expect(core.normalizeForOracle("2 üzeri 10 = 1024")).toBe("2 ** 10 = 1024");
    expect(core.normalizeForOracle("100 bölü 4 eşittir 25")).toBe("100 / 4 = 25");
    expect(core.normalizeForOracle("5 büyüktür 3")).toBe("5 > 3");
    expect(core.normalizeForOracle("8 x 9 = 72")).toBe("8 * 9 = 72");
  });

  test("normalizeForOracle: rakamsız düz cümle / zaten sembolik DEĞİŞMEZ (route bozulmaz)", () => {
    expect(core.normalizeForOracle("yapay zeka nedir")).toBe("yapay zeka nedir");
    expect(core.normalizeForOracle("A and not A is always false")).toBe("A and not A is always false");
    expect(core.normalizeForOracle("2+2=4")).toBe("2+2=4");
    expect(core.normalizeForOracle("5 > 3")).toBe("5 > 3");
  });

  test("web helpers: extractUrl / wantsRender / wantsDeepSurf / topFor (tam web yeteneği)", () => {
    expect(core.extractUrl("https://en.wikipedia.org/wiki/X sayfasını özetle")).toBe("https://en.wikipedia.org/wiki/X");
    expect(core.extractUrl("http://a.com/b.")).toBe("http://a.com/b");
    expect(core.extractUrl("URL yok")).toBeNull();
    expect(core.wantsRender("şu JS sayfayı render et")).toBe(true);
    expect(core.wantsRender("dinamik tarayıcı ile aç")).toBe(true);
    expect(core.wantsRender("yapay zeka nedir")).toBe(false);
    expect(core.wantsDeepSurf("RAG'ı derinlemesine araştır")).toBe(true);
    expect(core.wantsDeepSurf("kapsamlı incele")).toBe(true);
    expect(core.wantsDeepSurf("yapay zeka nedir")).toBe(false);
    expect(core.topFor("derinlemesine araştır")).toBe(5);
    expect(core.topFor("yapay zeka nedir")).toBe(3);
  });

  test("sanitizeSynth: baştaki 'Doğru/Yanlış' dolgusunu sıyır (gerçek yanıt kalır; research ≠ oracle)", () => {
    expect(core.sanitizeSynth("Doğru. Yapay zeka öğrenen sistemlerdir.")).toBe("Yapay zeka öğrenen sistemlerdir.");
    expect(core.sanitizeSynth("Yanlış. Bu bilgi eski.")).toBe("Bu bilgi eski.");
    expect(core.sanitizeSynth("Yapay zeka makinelerin yeteneğidir (kaynak: x)")).toBe("Yapay zeka makinelerin yeteneğidir (kaynak: x)");
    expect(core.guardNoVerdict(core.sanitizeSynth("Doğru. RAG getirimle üretimi zenginleştirir"))).toBe(true);
    expect(core.sanitizeSynth("Doğrulama yöntemi şudur")).toBe("Doğrulama yöntemi şudur"); // whole-word: sıyrılmaz
  });

  test("isFollowUp: devam sorusu (çok-turlu) — açık işaret / kısa zamir; standalone değil", () => {
    expect(core.isFollowUp("peki ya Almanya?")).toBe(true);
    expect(core.isFollowUp("ya da İtalya")).toBe(true);
    expect(core.isFollowUp("neden?")).toBe(true);
    expect(core.isFollowUp("daha detay")).toBe(true);
    expect(core.isFollowUp("yapay zeka nedir")).toBe(false);
    expect(core.isFollowUp("neden gökyüzü mavi")).toBe(false);
  });

  test("buildSynthPrompt: grounding (UYDURMA) + opsiyonel çok-turlu bağlam", () => {
    const p0 = core.buildSynthPrompt("X nedir", [{ title: "T", url: "https://a.com/x", text: "içerik metni yeterince uzun olsun" }]);
    expect(p0).toContain("UYDURMA");
    expect(p0).not.toContain("Önceki konuşma");
    const p1 = core.buildSynthPrompt("peki ya Y", [{ title: "T", url: "https://a.com/x", text: "içerik" }], "X nedir");
    expect(p1).toContain("Önceki konuşma");
    expect(p1).toContain("X nedir");
  });

  test("rerankSources: en alakalı + otorite kaynağı başa taşır (RAG reranking)", () => {
    const results = [
      { title: "Alakasız", url: "https://random-blog.com/x", text: "kediler ve kopekler hakkinda" },
      { title: "Yapay zeka", url: "https://en.wikipedia.org/wiki/AI", text: "yapay zeka makine ogrenmesi sinir aglari" },
      { title: "Reklam", url: "https://ads.example.com/y", text: "indirim kampanya" },
    ];
    const ranked = core.rerankSources("yapay zeka makine ogrenmesi", results);
    expect(core.domainOf(ranked[0].url)).toBe("en.wikipedia.org");
  });

  test("rerankSources: eşit skorda orijinal sırayı korur (stable); boş güvenli", () => {
    const a = { title: "A", url: "https://a.com/1", text: "lorem" };
    const b = { title: "B", url: "https://b.com/2", text: "ipsum" };
    const ranked = core.rerankSources("zzzzzz", [a, b]); // hiç token eşleşmez → eşit skor
    expect(ranked[0]).toBe(a);
    expect(ranked[1]).toBe(b);
    expect(core.rerankSources("q", [])).toEqual([]);
  });

  test("dedupSources: aynı host bir kez (kaynak çeşitliliği)", () => {
    const results = [
      { title: "Yapay Zeka", url: "https://en.wikipedia.org/wiki/AI", text: "t1" },
      { title: "AI 2", url: "https://en.wikipedia.org/wiki/AI_2", text: "t2" },
      { title: "Farklı", url: "https://baska.com/z", text: "t3" },
    ];
    const out = core.dedupSources(results);
    expect(out.length).toBe(2);
    expect(out.map((r) => core.domainOf(r.url))).toEqual(["en.wikipedia.org", "baska.com"]);
  });

  test("rerankSources: BM25 alaka + uzunluk-normalizasyonu (kısa-yoğun doc, uzun-seyreltik doc'tan önde)", () => {
    const filler = "lorem ipsum dolor sit amet consectetur ".repeat(40);
    const dense = { title: "Kısa", url: "https://short.com/a", text: "rag rag rag retrieval augmented generation" };
    const sparse = { title: "Uzun", url: "https://long.com/b", text: "rag " + filler };
    const ranked = core.rerankSources("rag", [sparse, dense]); // bilerek sparse'ı başa koy
    expect(core.domainOf(ranked[0].url)).toBe("short.com"); // yoğun/kısa doc BM25'te öne geçer (length-norm)
  });

  test("rerankSources: çarpımsal otorite (wikipedia ×1.5) eşit-alaka beraberliğini kırar; IDF negatif değil", () => {
    const wiki = { title: "T", url: "https://en.wikipedia.org/wiki/AI", text: "yapay zeka modeli" };
    const blog = { title: "T2", url: "https://blog.com/x", text: "yapay zeka modeli" };
    const ranked = core.rerankSources("yapay zeka", [blog, wiki]); // blog önce dursa da
    expect(core.domainOf(ranked[0].url)).toBe("en.wikipedia.org"); // ×1.5 otorite öne taşır
    const same = core.rerankSources("zeka", [blog, wiki]).map((r) => core.domainOf(r.url));
    expect(same).toContain("en.wikipedia.org");
    expect(same.length).toBe(2); // NaN/çökme yok; tüm girdiler korunur
  });

  test("extractiveAnswer: sorgu verilince sorgu-alakalı cümleyi seçer (query-focused extractive)", () => {
    const text = "Kediler bağımsız hayvanlardır. " +
      "Retrieval-augmented generation, getirilen belgelerle üretimi zenginleştiren bir tekniktir. " +
      "Hava bugün güneşli.";
    const a = core.extractiveAnswer([{ title: "RAG", url: "https://en.wikipedia.org/wiki/RAG", text }], "retrieval augmented generation nedir");
    expect(a).toContain("getirilen belgelerle üretimi zenginleştiren"); // ilk cümle değil, sorgu-alakalı cümle
    expect(a).not.toContain("Kediler bağımsız"); // ilk cümle SEÇİLMEDİ
    expect(a).toContain("(kaynak: en.wikipedia.org)");
    expect(core.guardNoVerdict(a)).toBe(true); // başlık önde → verdict ile başlamaz
  });

  test("extractiveAnswer: sorgu yoksa ilk cümle (mevcut davranış) + ondalık/kısaltma bölme güvenli", () => {
    const text = "Pi yaklaşık 3.14 değerindedir ve Dr. Smith bunu açıklar. İkinci cümle buradadır.";
    const a = core.extractiveAnswer([{ title: "Pi", url: "https://en.wikipedia.org/wiki/Pi", text }]); // query yok
    expect(a).toContain("3.14"); // ondalık noktadan BÖLÜNMEDİ
    expect(a).toContain("Dr. Smith"); // "Dr." kısaltması cümle sonu sanılmadı
    expect(a).not.toContain("İkinci cümle"); // ilk cümle seçildi (sorgu yok)
  });

  test("dedupSources: Jaccard cross-host uzun kopyayı eler (≥4-kelime gövde shingle, mirror)", () => {
    const body = "retrieval augmented generation augments a language model with documents fetched at query time to ground answers";
    const results = [
      { title: "RAG explained", url: "https://en.wikipedia.org/wiki/RAG", text: body },
      { title: "RAG aciklamasi", url: "https://mirror-site.com/rag", text: body }, // farklı host+başlık, AYNI gövde
    ];
    const out = core.dedupSources(results);
    expect(out.length).toBe(1); // near-dup elendi
    expect(core.domainOf(out[0].url)).toBe("en.wikipedia.org"); // ilk (en-alakalı) temsilci korunur
  });

  test("dedupSources: kısa metin (<4 kelime) Jaccard'ı tetiklemez (guard: NaN/yanlış-drop yok)", () => {
    const results = [
      { title: "A", url: "https://a.com/1", text: "tek" },
      { title: "B", url: "https://b.com/2", text: "iki kelime" }, // <4 kelime → shingle yok → Jaccard atlanır
    ];
    const out = core.dedupSources(results);
    expect(out.length).toBe(2); // hiçbiri yanlışlıkla düşmedi
    expect(out.map((r) => core.domainOf(r.url))).toEqual(["a.com", "b.com"]);
  });

  test("stemTurkish: çekimli Türkçe sözcükleri aynı köke indirger (recall); kısa kök korunur", () => {
    const k = (w) => core.queryTokens(w)[0];
    expect(k("başkenti")).toBe(k("başkent"));
    expect(k("başkentler")).toBe(k("başkent"));
    expect(k("başkentten")).toBe(k("başkent"));
    expect(core.queryTokens("evi")).toEqual(["evi"]); // kısa kök (≤4) bozulmaz (over-stemming guard)
  });

  test("rerankSources: BM25F — başlıkta geçen terim (W_title=2) sıralamayı yükseltir", () => {
    const a = { title: "turev", url: "https://a.com/x", text: "matematik konusu genel ozet" };
    const b = { title: "matematik", url: "https://b.com/y", text: "turev konusu genel ozet" };
    const ranked = core.rerankSources("turev", [b, a]); // b başta dursa da başlık-eşleşen a öne geçer
    expect(core.domainOf(ranked[0].url)).toBe("a.com");
  });

  test("rerankSources: bigram yakınlık — bitişik sorgu çiftli doc, dağınık doc'tan önde", () => {
    const adj = { title: "x", url: "https://adj.com/1", text: "alpha beta gamma delta epsilon" };
    const far = { title: "x", url: "https://far.com/2", text: "alpha zeta zeta zeta zeta beta" };
    const ranked = core.rerankSources("alpha beta", [far, adj]); // bitişik (alpha beta) → yakınlık bonusu
    expect(core.domainOf(ranked[0].url)).toBe("adj.com");
  });

  test("extractiveAnswer: MMR — çok-olgulu sorgu iki alakalı cümle seçer; alakasız cümle eklenmez", () => {
    const text = "Ankara Türkiye'nin başkentidir. İstanbul en büyük şehirdir. Kediler bağımsızdır.";
    const a = core.extractiveAnswer([{ title: "T", url: "https://x.com/1", text }], "Ankara başkent İstanbul şehir");
    expect(a).toContain("Ankara");
    expect(a).toContain("İstanbul");
    expect(a).not.toContain("Kediler");
  });

  test("computeConfidence: çok-domain uzlaşı yüksek; tek-domain ≤0.65; düşük-grounding düşük", () => {
    const ans = "yapay zeka makine öğrenmesi";
    const multi = [
      { title: "a", url: "https://en.wikipedia.org/x", text: "yapay zeka makine öğrenmesi konusu" },
      { title: "b", url: "https://bbc.com/y", text: "yapay zeka makine öğrenmesi haberi" },
      { title: "c", url: "https://mit.edu/z", text: "yapay zeka makine öğrenmesi dersi" },
    ];
    const cMulti = core.computeConfidence(multi, ans);
    expect(cMulti.domains).toBe(3);
    expect(cMulti.score).toBeGreaterThan(0.65);
    const cSingle = core.computeConfidence([{ title: "a", url: "https://en.wikipedia.org/x", text: ans }], ans);
    expect(cSingle.score).toBeLessThanOrEqual(0.65); // tek-domain tavanı
    const off = [
      { title: "a", url: "https://a.com/x", text: "tamamen alakasız metin burada" },
      { title: "b", url: "https://b.com/y", text: "baska bir konu daha vardir" },
    ];
    expect(core.computeConfidence(off, ans).grounding).toBeLessThan(0.5);
  });

  test("buildSiriRecord: research event dizisinden yapısal kayıt türetir (saf, deterministik)", async () => {
    const log = await import("../bin/host-bridge/lib/siri-log.mjs");
    const events = [
      { step: "oracle", verdict: "UNDECIDABLE", ms: 30 },
      { step: "deep", sources: 3, ms: 1200 },
      { step: "rerank", top: "en.wikipedia.org", top3: ["en.wikipedia.org", "bbc.com", "mit.edu"], kept: 3, from: 5 },
      { step: "synth", backend: "fleet:win", timedOut: false, ms: 800 },
      { step: "final", route: "research", mode: "synth", conf: 78, domains: 3, ms: 2100 },
    ];
    const rec = log.buildSiriRecord({ query: "yapay zeka nedir", events, now: 1735660800000, device: { host: "t", platform: "darwin", arch: "arm64", ncpu: 8 } });
    expect(rec.tool).toBe("siri-ask");
    expect(rec.route).toBe("research");
    expect(rec.duration_ms).toBe(2100);
    expect(rec.cache).toBe("miss");
    expect(rec.attributes.top3).toEqual(["en.wikipedia.org", "bbc.com", "mit.edu"]);
    expect(rec.attributes.synth_backend).toBe("fleet:win");
    expect(rec.attributes.conf).toEqual({ score: 78, domains: 3 });
    expect(rec.attributes.latency.deep_ms).toBe(1200);
    expect(rec.ts).toBe(new Date(1735660800000).toISOString());
  });

  test("buildSiriRecord: oracle/cache dalları doğru route+verdict+cache", async () => {
    const log = await import("../bin/host-bridge/lib/siri-log.mjs");
    const oracle = log.buildSiriRecord({ query: "2+2=4", events: [{ step: "oracle", verdict: "TRUE", ms: 40 }, { step: "final", route: "oracle", verdict: "TRUE", ms: 55 }], now: 1735660800000, device: {} });
    expect(oracle.route).toBe("oracle");
    expect(oracle.attributes.verdict).toBe("TRUE");
    const cached = log.buildSiriRecord({ query: "x", events: [{ step: "final", route: "research", mode: "cache", ms: 3 }], now: 1735660800000, device: {} });
    expect(cached.cache).toBe("hit");
  });

  test("recordSiri: SIRI_LOG_DIR'e NDJSON yazar; SIRI_LOG=0 atlar (best-effort)", async () => {
    const log = await import("../bin/host-bridge/lib/siri-log.mjs");
    const os = await import("node:os"); const fs = await import("node:fs"); const path = await import("node:path");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "siri-log-"));
    const rec = { ts: "x", tool: "siri-ask", route: "research", attributes: { query: "q" } };
    expect(log.recordSiri(rec, { dir: tmp })).toBe(true);
    const content = fs.readFileSync(path.join(tmp, log.SIRI_LOG_FILE), "utf8").trim();
    expect(JSON.parse(content).tool).toBe("siri-ask"); // geçerli NDJSON satırı
    const prev = process.env.SIRI_LOG; process.env.SIRI_LOG = "0";
    const skipped = log.recordSiri(rec, { dir: tmp });
    if (prev === undefined) delete process.env.SIRI_LOG; else process.env.SIRI_LOG = prev;
    expect(skipped).toBe(false); // SIRI_LOG=0 → yazmaz
  });

  test("ndcg3: tek-gold ikili (geriye-uyumlu) — rank0→1.0, rank1→0.63, yok→0", async () => {
    const cal = await import("../bin/host-bridge/tools/lib/ask-calibrate.mjs");
    expect(cal.ndcg3(["wikipedia.org", "bbc.com"], "wikipedia.org")).toBeCloseTo(1.0, 5);
    expect(cal.ndcg3(["bbc.com", "wikipedia.org"], "wikipedia.org")).toBeCloseTo(1 / Math.log2(3), 5);
    expect(cal.ndcg3(["a.com", "b.com"], "wikipedia.org")).toBe(0);
    expect(cal.ndcg3(["a.com"], null)).toBe(null);
  });

  test("ndcg3: graded çok-gold — doğru sıra→1.0, ters sıra→cezalı (<1)", async () => {
    const cal = await import("../bin/host-bridge/tools/lib/ask-calibrate.mjs");
    const gold = [{ domain: "wikipedia.org", rel: 3 }, { domain: "bbc.com", rel: 2 }];
    expect(cal.ndcg3(["wikipedia.org", "bbc.com"], gold)).toBeCloseTo(1.0, 5);
    const rev = cal.ndcg3(["bbc.com", "wikipedia.org"], gold);
    expect(rev).toBeGreaterThan(0);
    expect(rev).toBeLessThan(1.0); // ters sıra cezası
  });

  test("windowHealth: hep-iyi→PASS; recent yüksek-error→WARN; düşük-conf→drift<0", async () => {
    const cal = await import("../bin/host-bridge/tools/lib/ask-calibrate.mjs");
    const rec = (conf, err) => ({ status: err ? "error" : "ok", cache: "miss", attributes: { conf: { score: conf }, latency: { total_ms: 5000 } } });
    const allGood = Array.from({ length: 30 }, () => rec(80, false));
    expect(cal.windowHealth(allGood, { windowN: 10 }).status).toBe("PASS");
    const mixed = [...Array.from({ length: 20 }, () => rec(80, false)), ...Array.from({ length: 10 }, () => rec(80, true))];
    const hw = cal.windowHealth(mixed, { windowN: 10 });
    expect(hw.status).toBe("WARN");
    expect(hw.checks.find((c) => c.name === "error").ok).toBe(false);
    const drift = [...Array.from({ length: 20 }, () => rec(90, false)), ...Array.from({ length: 10 }, () => rec(50, false))];
    expect(cal.windowHealth(drift, { windowN: 10 }).drift.confDelta).toBeLessThan(0);
  });

  test("domainOf / truncate / clampWords / pickSources", () => {
    expect(core.domainOf("https://www.example.com/a")).toBe("example.com");
    expect(core.truncate("a b c d e f g", 5).length).toBeLessThanOrEqual(5);
    expect(core.clampWords("bir iki üç dört beş", 3).split(" ").length).toBeLessThanOrEqual(4); // 3 kelime + "…"
    const s = core.pickSources([{ url: "https://www.a.com/x", title: "T", text: "yeterince uzun içerik metni" }], 3, 50);
    expect(s[0]).toMatchObject({ domain: "a.com", title: "T" });
    expect(s[0].text.length).toBeLessThanOrEqual(50);
  });
});

describe("recipeSiri — yerel Run-Shell Siri shortcut üreteci", () => {
  test("plist: ask + runshellscript(mutlak node + siri-ask.mjs) + speaktext(Yelda)", () => {
    const r = recipeSiri("/Users/x/Desktop/ollamas", "Yelda");
    expect(r.slug).toBe("siri");
    expect(r.actions.length).toBeGreaterThanOrEqual(3);
    const plist = buildWorkflowPlist(r.actions);
    expect(plist).toContain("is.workflow.actions.ask");
    expect(plist).toContain("is.workflow.actions.runshellscript");
    expect(plist).toContain("/opt/homebrew/bin/node");
    expect(plist).toContain("/bin/siri-ask.mjs");
    expect(plist).toContain("is.workflow.actions.showresult"); // METİN sonuç (ses yok)
    expect(plist).not.toContain("is.workflow.actions.speaktext"); // ses YOK
    expect(plist).toContain("ORACLE_SOCK"); // sabit socket → hızlı oracle yolu
    expect(plist).toContain("/tmp/ollamas-oracle.sock");
    expect(plist).toContain("oracle-serve.ts"); // daemon self-ensure
  });

  test("action yardımcıları doğru WFWorkflow kimliklerini üretir", () => {
    expect(askAction("q").WFWorkflowActionIdentifier).toBe("is.workflow.actions.ask");
    expect(runShellAction("echo hi").WFWorkflowActionIdentifier).toBe("is.workflow.actions.runshellscript");
    expect(speakAction("Yelda").WFWorkflowActionParameters.WFSpeakTextVoice).toBe("Yelda");
  });
});
