import { describe, it, expect } from "vitest";
import { buildInventory, inventoryJson, inventoryMd } from "../bin/learn-inventory";
import { ALL_CONSTRUCTS, constructById } from "../lib/learn/index";
import { isTaught, MAX_EXAMPLES } from "../lib/learn/types";
import { CURRICULUM_UNITS, curriculumStats, validateCurriculum, orphanLessons, crossListed } from "../lib/learn/curriculum";

// The scan touches ~1 500 files; run it once and assert against the result.
const inv = buildInventory();
const taught = new Set(inv.entries.filter(isTaught).map((e) => e.construct.id));

describe("detector engine", () => {
  it("çok satırlı dedektör bulgu üretir (satır-satır tarama bunu SESSİZCE kaçırıyordu)", () => {
    // Regression: the scanner tested each LINE, so `^---\n[a-z_]+:` could never match and every
    // frontmatter detector reported zero across a vault full of frontmatter. It shipped and was
    // caught by eye, not by a test. This is that test.
    const e = inv.entries.find((x) => x.construct.id === "md-frontmatter");
    expect(e).toBeDefined();
    expect(e!.hits).toBeGreaterThan(0);
    expect(e!.examples[0].line).toBeGreaterThan(0);
  });

  it("katalog kendi kendini taramaz (dedektör metni sahte bulgu üretirdi)", () => {
    // `pipeline/lib/learn/**` holds the regex sources themselves; scanning them would make every
    // construct "found" in the catalogue and coverage meaningless.
    const selfScan = inv.entries.flatMap((e) => e.examples).filter((o) => o.path.includes("pipeline/lib/learn/"));
    expect(selfScan).toEqual([]);
  });

  it("yedek dosyalar (.bak-*) taranmaz", () => {
    const baks = inv.entries.flatMap((e) => e.examples).filter((o) => /\.bak-/.test(o.path));
    expect(baks).toEqual([]);
  });

  it("her kanıt gerçek bir sistem etiketiyle gelir", () => {
    const systems = new Set(inv.entries.flatMap((e) => e.systems));
    for (const s of systems) expect(["ollamas", "ecym", "obsidian", "claudecode"]).toContain(s);
  });

  it("örnek sayısı sınırlı ve dosya başına tek", () => {
    for (const e of inv.entries) {
      expect(e.examples.length).toBeLessThanOrEqual(MAX_EXAMPLES);
      expect(new Set(e.examples.map((x) => x.path)).size).toBe(e.examples.length);
    }
  });

  it("sıralama yorum satırını örnek olarak seçmez (mümkünse)", () => {
    // Ranking penalises comment lines; with 175 constructs a handful may only occur in comments,
    // so the assertion is on the RATIO, not on every single entry.
    const comments = inv.entries.filter((e) => /^\s*(\/\/|#|\*)/.test(e.examples[0].snippet)).length;
    expect(comments / inv.entries.length).toBeLessThan(0.15);
  });

  it("kullanılmayan dedektör kalmadı — ders = kanıtlanmış yapı", () => {
    expect(inv.unused).toEqual([]);
    expect(inv.entries.length).toBe(ALL_CONSTRUCTS.length);
  });

  it("envanter JSON'u iki kapsama sayısını da taşır", () => {
    const doc = JSON.parse(inventoryJson(inv, "2026-01-01 00:00:00", { ...curriculumStats() }));
    expect(doc.coverage).toBe(1);
    expect(doc.curriculumCoverage).toBe(1);
    expect(doc.constructs.length).toBe(inv.entries.length);
  });

  it("envanter markdown'ı deterministik", () => {
    expect(inventoryMd(inv, "SABIT")).toBe(inventoryMd(inv, "SABIT"));
  });
});

describe("curriculum map", () => {
  it("her bölüm bir hüküm taşır — boş yok", () => {
    const s = curriculumStats();
    expect(s.unaccounted).toEqual([]);
    expect(s.coverage).toBe(1);
    expect(s.total).toBe(s.covered + s["not-used-here"] + s.external);
  });

  it("'covered' bölümler var olan derse işaret eder", () => {
    expect(validateCurriculum(taught)).toEqual([]);
  });

  it("'not-used-here' bölümlerin gerekçesi yazılı", () => {
    for (const u of CURRICULUM_UNITS) {
      for (const ch of u.chapters) {
        if (ch.status !== "covered") expect((ch.why ?? "").length).toBeGreaterThan(10);
      }
    }
  });

  it("MDN önce, W3Schools sonra (operatörün verdiği sıra)", () => {
    const order = CURRICULUM_UNITS.map((u) => u.source);
    expect(order[0]).toBe("mdn");
    expect(order.indexOf("w3schools")).toBeGreaterThan(order.lastIndexOf("mdn") - order.length);
    expect(order.indexOf("mdn")).toBeLessThan(order.indexOf("w3schools"));
  });

  it("her ünite gerçek bir izleğe bağlı", () => {
    const tracks = new Set(inv.entries.map((e) => e.construct.track));
    for (const u of CURRICULUM_UNITS) expect(tracks.has(u.track)).toBe(true);
  });

  it("çapraz listelenen dersler kopyalanmaz, tek nota bağlanır", () => {
    for (const cl of crossListed()) {
      expect(constructById(cl.lesson)).toBeDefined();
      expect(cl.units.length).toBeGreaterThan(1);
    }
  });

  it("haritasız dersler açıkça listelenebilir (gizlenmez)", () => {
    const orph = orphanLessons(taught);
    for (const id of orph) expect(taught.has(id)).toBe(true);
    // Bu sisteme özgü dersler olabilir; sayı makul kalmalı, yoksa harita bayatlamış demektir.
    expect(orph.length / taught.size).toBeLessThan(0.1);
  });
});
