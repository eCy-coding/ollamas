import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultLimitFor, rollover, canDispatch, remaining, recordSuccess, recordExhausted,
  pickVendor, isVendorExhausted, loadBudget, saveBudget, guardVendor, noteVendorOutcome, todayKey,
  type VendorState, type BudgetFile,
} from "../bin/lib/vendor-budget";

const TODAY = "2026-07-04";
const YESTERDAY = "2026-07-03";
const st = (used: number, limit = 20, date = TODAY): VendorState => ({ date, used, limit });

// env manipülasyonu her testte geri alınır (defaultLimitFor process.env okur)
const ENV_KEYS = ["GEMINI_DAILY_LIMIT", "GROQ_DAILY_LIMIT", "ZAI_DAILY_LIMIT", "MYVENDOR_DAILY_LIMIT"];
const savedEnv: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("defaultLimitFor", () => {
  it("bilinen vendor → tablo değeri (20), lookup case-insensitive", () => {
    delete process.env.GEMINI_DAILY_LIMIT;
    expect(defaultLimitFor("gemini")).toBe(20);
    expect(defaultLimitFor("GEMINI")).toBe(20);
  });
  it("bilinmeyen vendor → DEFAULT_LIMIT 20", () => {
    expect(defaultLimitFor("totally-unknown")).toBe(20);
  });
  it("env override → floor'lanır", () => {
    process.env.GROQ_DAILY_LIMIT = "7.9";
    expect(defaultLimitFor("groq")).toBe(7);
  });
  it("env 0 / negatif / NaN → yok sayılır, fallback", () => {
    process.env.GEMINI_DAILY_LIMIT = "0";
    expect(defaultLimitFor("gemini")).toBe(20);
    process.env.GEMINI_DAILY_LIMIT = "-5";
    expect(defaultLimitFor("gemini")).toBe(20);
    process.env.GEMINI_DAILY_LIMIT = "abc";
    expect(defaultLimitFor("gemini")).toBe(20);
  });
  it("env anahtarı vendor adından UPPERCASE türetilir", () => {
    process.env.MYVENDOR_DAILY_LIMIT = "5";
    expect(defaultLimitFor("myvendor")).toBe(5);
  });
});

describe("rollover", () => {
  it("aynı gün → state aynen döner (referans dahi korunur)", () => {
    const s = st(3);
    expect(rollover(s, TODAY)).toBe(s);
  });
  it("gün değişti → used=0, limit korunur, tarih güncellenir", () => {
    expect(rollover(st(19, 25, YESTERDAY), TODAY)).toEqual({ date: TODAY, used: 0, limit: 25 });
  });
});

describe("canDispatch", () => {
  it("used < limit → true; used == limit → false (sınır)", () => {
    expect(canDispatch(st(19, 20), TODAY)).toBe(true);
    expect(canDispatch(st(20, 20), TODAY)).toBe(false);
  });
  it("used > limit (latch aşımı) → false", () => {
    expect(canDispatch(st(25, 20), TODAY)).toBe(false);
  });
  it("dünden tükenmiş state bugün → rollover sonrası true", () => {
    expect(canDispatch(st(20, 20, YESTERDAY), TODAY)).toBe(true);
  });
});

describe("remaining", () => {
  it("limit - used", () => {
    expect(remaining(st(3, 20), TODAY)).toBe(17);
  });
  it("asla negatif değil", () => {
    expect(remaining(st(30, 20), TODAY)).toBe(0);
  });
  it("rollover uygulanır → tam limit döner", () => {
    expect(remaining(st(20, 20, YESTERDAY), TODAY)).toBe(20);
  });
});

describe("recordSuccess", () => {
  it("used +1, girdi mutate edilmez", () => {
    const s = st(4);
    const next = recordSuccess(s, TODAY);
    expect(next).toEqual({ date: TODAY, used: 5, limit: 20 });
    expect(s.used).toBe(4);
  });
  it("dünden kalan sayaç → rollover sonrası 1", () => {
    expect(recordSuccess(st(15, 20, YESTERDAY), TODAY)).toEqual({ date: TODAY, used: 1, limit: 20 });
  });
});

describe("recordExhausted", () => {
  it("used → limit'e latch'lenir, sonrasında dispatch kapalı", () => {
    const next = recordExhausted(st(5, 20), TODAY);
    expect(next).toEqual({ date: TODAY, used: 20, limit: 20 });
    expect(canDispatch(next, TODAY)).toBe(false);
  });
  it("used zaten limit üstünde → düşürülmez (Math.max)", () => {
    expect(recordExhausted(st(25, 20), TODAY).used).toBe(25);
  });
  it("dün latch'lendi → bugün rollover latch'i sıfırlar, yeniden latch gerekir", () => {
    expect(recordExhausted(st(20, 20, YESTERDAY), TODAY)).toEqual({ date: TODAY, used: 20, limit: 20 });
  });
});

describe("pickVendor", () => {
  it("en çok remaining'i olan seçilir", () => {
    const b: BudgetFile = { a: st(15, 20), b: st(2, 20), c: st(10, 20) };
    expect(pickVendor(["a", "b", "c"], b, TODAY)).toBe("b");
  });
  it("tükenmiş vendor atlanır", () => {
    const b: BudgetFile = { gemini: st(20, 20), groq: st(19, 20) };
    expect(pickVendor(["gemini", "groq"], b, TODAY)).toBe("groq");
  });
  it("hepsi tükenmiş → null", () => {
    const b: BudgetFile = { a: st(20, 20), b: st(20, 20) };
    expect(pickVendor(["a", "b"], b, TODAY)).toBeNull();
  });
  it("boş candidates → null", () => {
    expect(pickVendor([], {}, TODAY)).toBeNull();
  });
  it("eşitlikte pref sırası kazanır", () => {
    const b: BudgetFile = { groq: st(5, 20), cerebras: st(5, 20) };
    expect(pickVendor(["groq", "cerebras"], b, TODAY, ["cerebras", "groq"])).toBe("cerebras");
    expect(pickVendor(["groq", "cerebras"], b, TODAY, ["groq", "cerebras"])).toBe("groq");
  });
  it("eşitlik + pref yok → candidate sırası (ilk gelen tutulur)", () => {
    const b: BudgetFile = { x: st(5, 20), y: st(5, 20) };
    expect(pickVendor(["x", "y"], b, TODAY)).toBe("x");
  });
  it("map'te olmayan vendor default bütçesiyle skorlanır (taze → tam bütçe)", () => {
    delete process.env.GEMINI_DAILY_LIMIT;
    const b: BudgetFile = { gemini: st(19, 20) }; // 1 kaldı
    expect(pickVendor(["gemini", "unknown"], b, TODAY)).toBe("unknown"); // 20 kaldı
  });
  it("dünden tükenen vendor bugün rollover ile yeniden seçilebilir", () => {
    const b: BudgetFile = { a: st(20, 20, YESTERDAY), b: st(19, 20) };
    expect(pickVendor(["a", "b"], b, TODAY)).toBe("a");
  });
});

describe("isVendorExhausted", () => {
  it.each([
    '{"code":429,"message":"Too Many Requests"}',
    "groq API error 429",
    "Rate limit reached for model llama-3.3-70b",
    "ratelimit hit",
    "rate-limit exceeded",
    "RESOURCE_EXHAUSTED",
    "insufficient_quota",
    "You exceeded your current quota",
    "Daily limit reached for free tier",
  ])("pozitif: %s", (t) => {
    expect(isVendorExhausted(t)).toBe(true);
  });
  it.each([
    "maximum context length exceeded", // 400-sınıfı istek hatası — vendor'u latch'lememeli
    "prompt size limit exceeded",
    "500 internal error",
    "502 Bad Gateway",
    "503 Service Unavailable — model is overloaded",
    "ECONNREFUSED",
    "invalid model name",
    "request id 4290 failed", // \b429\b tam-kelime — 4290 eşleşmemeli
    "",
  ])("negatif: %s", (t) => {
    expect(isVendorExhausted(t)).toBe(false);
  });
  it("string-dışı girdi → false (runtime guard)", () => {
    expect(isVendorExhausted(undefined as unknown as string)).toBe(false);
    expect(isVendorExhausted(429 as unknown as string)).toBe(false);
  });
});

describe("IO katmanı (temp dir)", () => {
  let dir = "";
  const tmp = () => { dir = mkdtempSync(join(tmpdir(), "vendor-budget-")); return dir; };
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ""; });

  describe("loadBudget", () => {
    it("dosya yok → {}", () => {
      expect(loadBudget(join(tmp(), "missing.json"))).toEqual({});
    });
    it("bozuk JSON → {}", () => {
      const p = join(tmp(), "b.json");
      writeFileSync(p, "{not json");
      expect(loadBudget(p)).toEqual({});
    });
    it("JSON array → {} (obje değil)", () => {
      const p = join(tmp(), "b.json");
      writeFileSync(p, "[1,2]");
      expect(loadBudget(p)).toEqual({});
    });
    it("geçersiz entry atılır, limit'siz entry default limit alır", () => {
      delete process.env.GEMINI_DAILY_LIMIT;
      const p = join(tmp(), "b.json");
      writeFileSync(p, JSON.stringify({
        gemini: { date: TODAY, used: 3 },          // limit yok → default 20
        groq: { date: TODAY, used: 1, limit: 50 }, // tam geçerli
        bad1: { date: 5, used: 1 },                // date string değil → drop
        bad2: { date: TODAY },                     // used yok → drop
        bad3: null,                                // → drop
      }));
      expect(loadBudget(p)).toEqual({
        gemini: { date: TODAY, used: 3, limit: 20 },
        groq: { date: TODAY, used: 1, limit: 50 },
      });
    });
  });

  describe("saveBudget", () => {
    it("eksik dizini oluşturur + newline'lı roundtrip", () => {
      const p = join(tmp(), "deep", "nested", "b.json");
      const b: BudgetFile = { gemini: st(4, 20) };
      saveBudget(p, b);
      expect(existsSync(p)).toBe(true);
      expect(readFileSync(p, "utf8").endsWith("\n")).toBe(true);
      expect(loadBudget(p)).toEqual(b);
    });
    it("yazılamayan path → sessiz best-effort (throw yok)", () => {
      expect(() => saveBudget("/dev/null/impossible/b.json", {})).not.toThrow();
    });
  });

  describe("guardVendor", () => {
    it("dosya yok → allowed, taze state, mesajda bütçe", () => {
      const g = guardVendor(join(tmp(), "b.json"), "gemini", TODAY, 20);
      expect(g.allowed).toBe(true);
      expect(g.state).toEqual({ date: TODAY, used: 0, limit: 20 });
      expect(g.msg).toContain("gemini budget 0/20");
      expect(g.msg).toContain("20 left");
    });
    it("tükenmiş vendor → allowed=false + exhausted mesajı", () => {
      const p = join(tmp(), "b.json");
      saveBudget(p, { gemini: st(20, 20) });
      const g = guardVendor(p, "gemini", TODAY);
      expect(g.allowed).toBe(false);
      expect(g.msg).toContain("exhausted");
      expect(g.msg).toContain("20/20");
    });
    it("dünkü tükenmişlik bugün rollover ile açılır", () => {
      const p = join(tmp(), "b.json");
      saveBudget(p, { gemini: st(20, 20, YESTERDAY) });
      const g = guardVendor(p, "gemini", TODAY);
      expect(g.allowed).toBe(true);
      expect(g.state.used).toBe(0);
    });
    it("guard salt-okur — dosyayı değiştirmez", () => {
      const p = join(tmp(), "b.json");
      saveBudget(p, { gemini: st(3, 20, YESTERDAY) });
      const before = readFileSync(p, "utf8");
      guardVendor(p, "gemini", TODAY);
      expect(readFileSync(p, "utf8")).toBe(before);
    });
  });

  describe("noteVendorOutcome", () => {
    it("success → used+1 persist edilir", () => {
      const p = join(tmp(), "b.json");
      const next = noteVendorOutcome(p, "gemini", "success", TODAY, 20);
      expect(next).toEqual({ date: TODAY, used: 1, limit: 20 });
      expect(loadBudget(p).gemini.used).toBe(1);
    });
    it("exhausted → used=limit latch persist edilir", () => {
      const p = join(tmp(), "b.json");
      saveBudget(p, { gemini: st(5, 20) });
      const next = noteVendorOutcome(p, "gemini", "exhausted", TODAY);
      expect(next.used).toBe(20);
      const persisted = loadBudget(p).gemini;
      expect(persisted.used).toBe(persisted.limit);
      expect(canDispatch(persisted, TODAY)).toBe(false);
    });
    it("diğer vendorların slice'ı clobber edilmez", () => {
      const p = join(tmp(), "b.json");
      saveBudget(p, { groq: st(7, 30), cerebras: st(2, 20) });
      noteVendorOutcome(p, "gemini", "success", TODAY, 20);
      const b = loadBudget(p);
      expect(b.groq).toEqual({ date: TODAY, used: 7, limit: 30 });
      expect(b.cerebras).toEqual({ date: TODAY, used: 2, limit: 20 });
      expect(b.gemini.used).toBe(1);
    });
    it("ardışık success'ler birikir → guard ile tutarlı şekilde tükenir", () => {
      const p = join(tmp(), "b.json");
      noteVendorOutcome(p, "zai", "success", TODAY, 2);
      noteVendorOutcome(p, "zai", "success", TODAY, 2);
      expect(guardVendor(p, "zai", TODAY, 2).allowed).toBe(false);
    });
  });
});

describe("todayKey", () => {
  it("YYYY-MM-DD (UTC) üretir", () => {
    expect(todayKey(new Date("2026-07-04T12:34:56Z"))).toBe("2026-07-04");
  });
  it("UTC gün sınırı: 23:59Z aynı gün, 00:00Z ertesi gün", () => {
    expect(todayKey(new Date("2026-07-04T23:59:59Z"))).toBe("2026-07-04");
    expect(todayKey(new Date("2026-07-05T00:00:00Z"))).toBe("2026-07-05");
  });
  it("argümansız → geçerli tarih formatı", () => {
    expect(todayKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
