// eCym eşleşme regresyonu — app kartları mevcut komutları kaçırmasın.
import { describe, test, expect } from "vitest";
import { matchRegressions, newMatches, summarizeMatch, type MatchMap } from "../server/ecym-match";

describe("matchRegressions", () => {
  test("eşleşme KAYARSA regresyon (X'ti, artık Y)", () => {
    const before: MatchMap = { "disk doluluğu": "df", "git durumu": "git_status" };
    const after: MatchMap = { "disk doluluğu": "app-docker-ps", "git durumu": "git_status" };
    const r = matchRegressions(before, after);
    expect(r).toEqual([{ query: "disk doluluğu", was: "df", now: "app-docker-ps" }]);
  });

  test("eşleşme KAYBOLURSA regresyon (X'ti, artık null)", () => {
    const r = matchRegressions({ "not al": "notes" }, { "not al": null });
    expect(r).toEqual([{ query: "not al", was: "notes", now: null }]);
  });

  test("eşleşme KORUNURSA regresyon YOK", () => {
    expect(matchRegressions({ "disk doluluğu": "df" }, { "disk doluluğu": "df" })).toEqual([]);
  });

  test("eskiden eşleşmeyeni saymaz (null→null regresyon değil)", () => {
    expect(matchRegressions({ "boş sorgu": null }, { "boş sorgu": null })).toEqual([]);
  });

  test("eskiden eşleşmeyen artık eşleşirse regresyon DEĞİL (kazanım)", () => {
    // null→"x" bir iyileşmedir, geriye gitme değil.
    expect(matchRegressions({ "resolve ac": null }, { "resolve ac": "app-resolve-open" })).toEqual([]);
  });

  test("after'da hiç anahtar yoksa (ölçüm başarısız) → null sayılır, regresyon", () => {
    expect(matchRegressions({ "disk doluluğu": "df" }, {}).length).toBe(1);
  });

  test("boş girdi çökmez", () => {
    expect(matchRegressions({}, {})).toEqual([]);
  });
});

describe("newMatches", () => {
  test("yalnız yeni kazanılan eşleşmeler", () => {
    const before: MatchMap = { "disk doluluğu": "df", "resolve ac": null };
    const after: MatchMap = { "disk doluluğu": "df", "resolve ac": "app-resolve-open", "chrome sekmeleri": "app-chrome-list-tabs" };
    const n = newMatches(before, after);
    expect(n).toContainEqual({ query: "resolve ac", id: "app-resolve-open" });
    expect(n).toContainEqual({ query: "chrome sekmeleri", id: "app-chrome-list-tabs" });
    expect(n).not.toContainEqual({ query: "disk doluluğu", id: "df" }); // değişmedi
  });
});

describe("summarizeMatch", () => {
  test("sayım doğru", () => {
    const before: MatchMap = { a: "x", b: "y", c: null };
    const after: MatchMap = { a: "x", b: "app-z", c: "app-w" };
    const s = summarizeMatch(before, after);
    expect(s.measured).toBe(3);
    expect(s.regressions).toBe(1);  // b kaydı
    expect(s.gained).toBe(2);       // b→app-z ve c→app-w yeni id
    expect(s.stable).toBe(1);       // a korundu
  });
});
