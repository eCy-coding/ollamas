import { describe, it, expect } from "vitest";
import {
  validateLearnSite, isComplete, lessonCount, wikilinks, verbatimHits, renderLesson, siteTargets,
  type LearnSite, type Lesson,
} from "../lib/learnsite";
import { ALL_CONSTRUCTS } from "../lib/learn/index";
import { CURRICULUM, LEARN_SOURCES, LESSON_SPEC, sourceById, trackById } from "../lib/learnrefs";

const lesson = (id: string, over: Partial<Lesson> = {}): Lesson => ({
  id,
  track: "js-ts",
  title: `${id} başlığı`,
  level: "temel",
  sources: ["https://developer.mozilla.org/docs/Web/JavaScript"],
  body: "## Nedir\n\nBir açıklama.\n\n## Bizde neden böyle yazılmış\n\nGerekçe.\n\n## Alıştırma\n\nÖlç.",
  examples: [{ path: "ollamas:pipeline/lib/x.ts", line: 12, snippet: "const a = 1;" }],
  recipe: { id, lang: "node", code: "console.log('x')", expect: "x", safety: "safe" },
  related: [],
  systems: ["ollamas"],
  ...over,
});

const site = (over: Partial<LearnSite> = {}): LearnSite => ({
  hubTitle: "Kodlama Öğrenme Sistemi",
  references: ["https://developer.mozilla.org/"],
  systems: ["ollamas", "ecym", "obsidian", "claudecode"],
  tracks: [{ id: "js-ts", title: "JS/TS", outcome: "kazanım", lessons: [lesson("a"), lesson("b")] }],
  ...over,
});

describe("validateLearnSite", () => {
  it("geçerli bir tier'da hata üretmez", () => {
    expect(isComplete(validateLearnSite(site()))).toBe(true);
  });

  it("kanıtsız dersi REDDEDER — bu tier'ın ayırt edici iddiası", () => {
    const s = site({ tracks: [{ id: "js-ts", title: "t", outcome: "o", lessons: [lesson("a", { examples: [] })] }] });
    const issues = validateLearnSite(s);
    expect(isComplete(issues)).toBe(false);
    expect(issues.some((i) => /kanıt/.test(i.message))).toBe(true);
  });

  it("beklenen çıktısı olmayan tarifi reddeder — 'çalıştı' doğrulanamaz", () => {
    const s = site({
      tracks: [{ id: "js-ts", title: "t", outcome: "o", lessons: [lesson("a", { recipe: { id: "a", lang: "node", code: "x", expect: "", safety: "safe" } })] }],
    });
    expect(isComplete(validateLearnSite(s))).toBe(false);
  });

  it("boş gövdeyi reddeder — taslak sayfa yayımlanmaz", () => {
    const s = site({ tracks: [{ id: "js-ts", title: "t", outcome: "o", lessons: [lesson("a", { body: "  " })] }] });
    expect(isComplete(validateLearnSite(s))).toBe(false);
  });

  it("çapasız dersi reddeder", () => {
    const s = site({ tracks: [{ id: "js-ts", title: "t", outcome: "o", lessons: [lesson("a", { sources: [] })] }] });
    expect(isComplete(validateLearnSite(s))).toBe(false);
  });

  it("kopuk wikilink'i HATA sayar", () => {
    const s = site({
      tracks: [{ id: "js-ts", title: "t", outcome: "o", lessons: [lesson("a", { body: "gövde [[learn-yok-boyle]] son" })] }],
    });
    expect(validateLearnSite(s).some((i) => /kopuk wikilink/.test(i.message))).toBe(true);
  });

  it("kopuk ilgili-ders bağlantısını da yakalar (renderer onu [[...]] yapar)", () => {
    const s = site({
      tracks: [{ id: "js-ts", title: "t", outcome: "o", lessons: [lesson("a", { related: ["hayalet"] })] }],
    });
    expect(validateLearnSite(s).some((i) => /ilgili-ders/.test(i.message))).toBe(true);
  });

  it("tekrar eden ders id'sini yakalar (disk üstünde sessiz üzerine-yazma olurdu)", () => {
    const s = site({ tracks: [{ id: "js-ts", title: "t", outcome: "o", lessons: [lesson("a"), lesson("a")] }] });
    expect(validateLearnSite(s).some((i) => /tekrar/.test(i.message))).toBe(true);
  });
});

describe("wikilinks", () => {
  it("kod bloğu ve satır-içi kod İÇİNDEKİ linkleri saymaz", () => {
    const body = "gerçek [[learn-a]] · örnek `[[hedef]]` · blok:\n```\n[[b]]\n```";
    expect(wikilinks(body)).toEqual(["learn-a"]);
  });

  it("takma ad ve başlık çapasını hedefe indirger", () => {
    expect(wikilinks("[[learn-a|Ad]] [[learn-b#bölüm]]")).toEqual(["learn-a", "learn-b"]);
  });
});

describe("verbatimHits", () => {
  it("12+ kelimelik ortak diziyi yakalar", () => {
    const up = "bir iki üç dört beş altı yedi sekiz dokuz on onbir oniki onüç";
    expect(verbatimHits(`önce ${up} sonra`, up).length).toBeGreaterThan(0);
  });

  it("sıradan teknik cümleyi yanlış-pozitif yapmaz", () => {
    expect(verbatimHits("bir dizi döndürür ve kaynağı değiştirmez", "başka bir metin tamamen")).toEqual([]);
  });
});

describe("katalog bütünlüğü", () => {
  it("her yapı geçerli bir izleğe ve kaynağa bağlı", () => {
    for (const c of ALL_CONSTRUCTS) {
      expect(() => trackById(c.track)).not.toThrow();
      expect(() => sourceById(c.source)).not.toThrow();
    }
  });

  it("her yapı bir tarif taşır ve tarif id'si ders id'siyle aynı", () => {
    for (const c of ALL_CONSTRUCTS) {
      expect(c.recipe.expect.trim().length).toBeGreaterThan(0);
      expect(c.recipe.id).toBe(c.id);
    }
  });

  it("ilgili-ders id'leri katalogda var (yazım hatası = kopuk grafik)", () => {
    const ids = new Set(ALL_CONSTRUCTS.map((c) => c.id));
    for (const c of ALL_CONSTRUCTS) for (const r of c.related ?? []) expect(ids.has(r)).toBe(true);
  });

  it("kaynak merdiveni MDN ile başlar, W3Schools ile devam eder (operatörün verdiği sıra)", () => {
    expect(LEARN_SOURCES[0].id).toBe("mdn");
    expect(LEARN_SOURCES[1].id).toBe("w3schools");
  });

  it("W3Schools metin politikası taksonomi-ile-sınırlı (telif)", () => {
    expect(sourceById("w3schools").textPolicy).toBe("taxonomy-only");
    expect(sourceById("mdn").textPolicy).toBe("attribute-never-mirror");
  });

  it("ders sözleşmesi kanıt, tarif ve alıştırmayı zorunlu kılar", () => {
    const ids = LESSON_SPEC.map((r) => r.id);
    expect(ids).toContain("real-example");
    expect(ids).toContain("recipe");
    expect(ids).toContain("exercise");
  });

  it("her izlekte en az bir yapı var", () => {
    for (const t of CURRICULUM) {
      expect(ALL_CONSTRUCTS.some((c) => c.track === t.id)).toBe(true);
    }
  });
});

describe("renderLesson", () => {
  it("deterministik — aynı girdi bayt-bayt aynı çıktı", () => {
    const l = lesson("a");
    expect(renderLesson(l)).toBe(renderLesson(l));
  });

  it("kanıtı, tarifi, beklenen çıktıyı ve çapayı basar", () => {
    const out = renderLesson(lesson("a"));
    expect(out).toContain("ollamas:pipeline/lib/x.ts");
    expect(out).toContain("Beklenen çıktı:");
    expect(out).toContain("🔗 Kaynak:");
    expect(out).toContain("[[learn-js-ts]]");
  });

  it("tablo hücresindeki boru işaretini kaçırır (tablo bozulmasın)", () => {
    const out = renderLesson(lesson("a", { examples: [{ path: "x:y.ts", line: 1, snippet: "a || b" }] }));
    expect(out).toContain("a \\|\\| b");
  });
});

describe("siteTargets / lessonCount", () => {
  it("hub, izlek MOC, sistem girişi ve ders adlarını içerir", () => {
    const t = siteTargets(site());
    expect(t.has("learn")).toBe(true);
    expect(t.has("learn-js-ts")).toBe(true);
    expect(t.has("ollamas-learn")).toBe(true);
    expect(t.has("learn-a")).toBe(true);
  });

  it("ders sayısını doğru toplar", () => {
    expect(lessonCount(site())).toBe(2);
  });
});
