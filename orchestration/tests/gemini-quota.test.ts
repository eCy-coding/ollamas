import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  rollover, canDispatch, remaining, recordSuccess, recordExhausted, todayKey,
  defaultLimit, loadQuota, saveQuota, guardQuota, noteOutcome, type QuotaState,
} from "../bin/lib/gemini-quota";

const s = (date: string, used: number, limit = 20): QuotaState => ({ date, used, limit });

describe("rollover", () => {
  it("resets used=0 when the day changes", () => {
    expect(rollover(s("2026-07-02", 20), "2026-07-03")).toEqual({ date: "2026-07-03", used: 0, limit: 20 });
  });
  it("keeps state on the same day", () => {
    expect(rollover(s("2026-07-03", 5), "2026-07-03")).toEqual(s("2026-07-03", 5));
  });
});

describe("canDispatch / remaining", () => {
  it("allows while under the limit", () => {
    expect(canDispatch(s("2026-07-03", 19), "2026-07-03")).toBe(true);
    expect(remaining(s("2026-07-03", 19), "2026-07-03")).toBe(1);
  });
  it("blocks at the limit", () => {
    expect(canDispatch(s("2026-07-03", 20), "2026-07-03")).toBe(false);
    expect(remaining(s("2026-07-03", 20), "2026-07-03")).toBe(0);
  });
  it("a stale exhausted day rolls over → allowed again tomorrow", () => {
    expect(canDispatch(s("2026-07-02", 20), "2026-07-03")).toBe(true);
    expect(remaining(s("2026-07-02", 20), "2026-07-03")).toBe(20);
  });
});

describe("recordSuccess", () => {
  it("increments used", () => {
    expect(recordSuccess(s("2026-07-03", 4), "2026-07-03")).toEqual(s("2026-07-03", 5));
  });
  it("resets then counts 1 on a new day", () => {
    expect(recordSuccess(s("2026-07-02", 20), "2026-07-03")).toEqual(s("2026-07-03", 1));
  });
});

describe("recordExhausted (429 latch)", () => {
  it("latches the day to the limit even if the counter under-estimated", () => {
    expect(recordExhausted(s("2026-07-03", 3), "2026-07-03")).toEqual(s("2026-07-03", 20));
    expect(canDispatch(recordExhausted(s("2026-07-03", 3), "2026-07-03"), "2026-07-03")).toBe(false);
  });
  it("never lowers a used count above the limit", () => {
    expect(recordExhausted(s("2026-07-03", 25), "2026-07-03").used).toBe(25);
  });
});

// ── gemini-özel IO katmanı: gerçek temp dosyalarla (mock yok) ─────────────────────────────────────────

const TODAY = "2026-07-04";
const YESTERDAY = "2026-07-03";

describe("gemini-quota IO (defaultLimit / loadQuota / saveQuota / guardQuota / noteOutcome)", () => {
  let dir: string;
  let file: string;
  const savedEnv = process.env.GEMINI_DAILY_LIMIT;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gemini-quota-test-"));
    file = join(dir, "gemini-quota.json");
    delete process.env.GEMINI_DAILY_LIMIT;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (savedEnv === undefined) delete process.env.GEMINI_DAILY_LIMIT;
    else process.env.GEMINI_DAILY_LIMIT = savedEnv;
  });

  describe("defaultLimit", () => {
    it("env yokken free-tier fallback = 20", () => {
      expect(defaultLimit()).toBe(20);
    });
    it("GEMINI_DAILY_LIMIT override — pozitif sayı floor'lanır", () => {
      process.env.GEMINI_DAILY_LIMIT = "7.9";
      expect(defaultLimit()).toBe(7);
    });
    it("geçersiz env (0 / negatif / harf) → fallback", () => {
      process.env.GEMINI_DAILY_LIMIT = "0";
      expect(defaultLimit()).toBe(20);
      process.env.GEMINI_DAILY_LIMIT = "-3";
      expect(defaultLimit()).toBe(20);
      process.env.GEMINI_DAILY_LIMIT = "abc";
      expect(defaultLimit()).toBe(20);
    });
  });

  describe("loadQuota — absent/corrupt → fresh", () => {
    it("dosya yok → bugünün fresh state'i, used=0, verilen limit", () => {
      expect(loadQuota(file, 5)).toEqual({ date: todayKey(), used: 0, limit: 5 });
    });
    it("corrupt JSON → fresh (throw yok)", () => {
      writeFileSync(file, "{not json!!");
      expect(loadQuota(file, 9)).toEqual({ date: todayKey(), used: 0, limit: 9 });
    });
    it("şekli yanlış (used string) → fresh", () => {
      writeFileSync(file, JSON.stringify({ date: TODAY, used: "3", limit: 20 }));
      expect(loadQuota(file, 20).used).toBe(0);
    });
    it("geçerli dosya olduğu gibi yüklenir (parametre limit'i ezmez)", () => {
      writeFileSync(file, JSON.stringify({ date: YESTERDAY, used: 13, limit: 25 }));
      expect(loadQuota(file, 99)).toEqual({ date: YESTERDAY, used: 13, limit: 25 });
    });
    it("dosyada limit eksik → parametre limit'i doldurur", () => {
      writeFileSync(file, JSON.stringify({ date: TODAY, used: 4 }));
      expect(loadQuota(file, 11)).toEqual({ date: TODAY, used: 4, limit: 11 });
    });
  });

  describe("saveQuota ↔ loadQuota roundtrip", () => {
    it("iç içe dizin yoksa oluşturur, newline'lı JSON yazar", () => {
      const nested = join(dir, "a", "b", "quota.json");
      saveQuota(nested, { date: TODAY, used: 2, limit: 20 });
      expect(existsSync(nested)).toBe(true);
      expect(readFileSync(nested, "utf8")).toBe('{"date":"2026-07-04","used":2,"limit":20}\n');
      expect(loadQuota(nested)).toEqual({ date: TODAY, used: 2, limit: 20 });
    });
  });

  describe("guardQuota — pre-flight gate", () => {
    it("dosya yok → allowed, tam bütçe mesajı", () => {
      const g = guardQuota(file, TODAY, 20);
      expect(g.allowed).toBe(true);
      expect(g.state).toEqual({ date: TODAY, used: 0, limit: 20 });
      expect(g.msg).toBe("gemini quota 0/20 today (20 left)");
    });
    it("used=limit → blocked, exhausted mesajı", () => {
      writeFileSync(file, JSON.stringify({ date: TODAY, used: 20, limit: 20 }));
      const g = guardQuota(file, TODAY, 20);
      expect(g.allowed).toBe(false);
      expect(g.msg).toBe("gemini daily quota exhausted (20/20) — resets tomorrow");
    });
    it("dünün exhausted state'i → gün dönümü rollover, tekrar allowed", () => {
      writeFileSync(file, JSON.stringify({ date: YESTERDAY, used: 20, limit: 20 }));
      const g = guardQuota(file, TODAY, 20);
      expect(g.allowed).toBe(true);
      expect(g.state).toEqual({ date: TODAY, used: 0, limit: 20 });
    });
    it("used > limit (latch overshoot) → blocked, remaining negatif olmaz", () => {
      writeFileSync(file, JSON.stringify({ date: TODAY, used: 35, limit: 20 }));
      const g = guardQuota(file, TODAY, 20);
      expect(g.allowed).toBe(false);
      expect(g.msg).toContain("35/20");
    });
    it("son 1 hak → hâlâ allowed (sınır used<limit)", () => {
      writeFileSync(file, JSON.stringify({ date: TODAY, used: 19, limit: 20 }));
      const g = guardQuota(file, TODAY, 20);
      expect(g.allowed).toBe(true);
      expect(g.msg).toBe("gemini quota 19/20 today (1 left)");
    });
    it("guardQuota salt-okur — diske yazmaz (rollover persist edilmez)", () => {
      guardQuota(file, TODAY, 20);
      expect(existsSync(file)).toBe(false);
    });
  });

  describe("noteOutcome — kaydet + persist", () => {
    it("success → +1 ve diske yazılır", () => {
      const st = noteOutcome(file, "success", TODAY, 20);
      expect(st).toEqual({ date: TODAY, used: 1, limit: 20 });
      expect(loadQuota(file)).toEqual({ date: TODAY, used: 1, limit: 20 });
    });
    it("ardışık success'ler birikir (persist zinciri)", () => {
      noteOutcome(file, "success", TODAY, 20);
      noteOutcome(file, "success", TODAY, 20);
      expect(noteOutcome(file, "success", TODAY, 20).used).toBe(3);
    });
    it("exhausted → günü latch'ler (used=limit), sayaç düşükken bile", () => {
      writeFileSync(file, JSON.stringify({ date: TODAY, used: 3, limit: 20 }));
      const st = noteOutcome(file, "exhausted", TODAY, 20);
      expect(st.used).toBe(20);
      expect(guardQuota(file, TODAY, 20).allowed).toBe(false);
    });
    it("exhausted latch, used > limit'i AŞAĞI çekmez (max korunur)", () => {
      writeFileSync(file, JSON.stringify({ date: TODAY, used: 42, limit: 20 }));
      expect(noteOutcome(file, "exhausted", TODAY, 20).used).toBe(42);
    });
    it("dünün state'i + bugün success → rollover sonrası used=1", () => {
      writeFileSync(file, JSON.stringify({ date: YESTERDAY, used: 20, limit: 20 }));
      expect(noteOutcome(file, "success", TODAY, 20)).toEqual({ date: TODAY, used: 1, limit: 20 });
    });
    it("guard → note → guard uçtan uca: bütçe biterse gate kapanır", () => {
      const limit = 2;
      expect(guardQuota(file, TODAY, limit).allowed).toBe(true);
      noteOutcome(file, "success", TODAY, limit);
      expect(guardQuota(file, TODAY, limit).allowed).toBe(true);
      noteOutcome(file, "success", TODAY, limit);
      const g = guardQuota(file, TODAY, limit);
      expect(g.allowed).toBe(false);
      expect(g.state.used).toBe(2);
    });
  });

  describe("todayKey", () => {
    it("YYYY-MM-DD (UTC) üretir", () => {
      expect(todayKey(new Date("2026-07-04T23:59:59Z"))).toBe("2026-07-04");
      expect(todayKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
