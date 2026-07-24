import { describe, it, expect } from "vitest";
import { parseLine, renderLine, detectLevel, stripAnsi, fold, isNoise, levelFilter, header } from "../lib/logfmt";

// The four shapes actually measured on this machine.
const REAL = {
  vaultGate: "2026-07-24 13:20:57  cc-verify: PASS=24  FAIL=1  SKIP=0",
  python: "2026-07-24 10:32:25,421 INFO gateway.run: Cron ticker started (interval=60s)",
  noStamp: "WARNING gateway.run: No messaging platforms enabled.",
  isoTag: "2026-07-24T10:32:12.122+03:00 [plugins] bonjour: advertised gateway fqdn=Emre MacBook Pro",
};

describe("parseLine — the real formats", () => {
  it("reads `YYYY-MM-DD HH:MM:SS` and keeps the message", () => {
    const l = parseLine(REAL.vaultGate, "cc-health")!;
    expect(l.time).toBe("13:20:57");
    expect(l.source).toBe("cc-verify");
    expect(l.message).toContain("PASS=24");
  });

  it("reads python logging with comma milliseconds and its level", () => {
    const l = parseLine(REAL.python, "hermes")!;
    expect(l.time).toBe("10:32:25");
    expect(l.level).toBe("info");
    expect(l.levelInferred).toBe(false);
    expect(l.source).toBe("gateway.run");
    expect(l.message).toBe("Cron ticker started (interval=60s)");
  });

  it("handles a line with no timestamp at all", () => {
    const l = parseLine(REAL.noStamp, "hermes")!;
    expect(l.time).toBe("");
    expect(l.level).toBe("warn");
    expect(l.message).toBe("No messaging platforms enabled.");
  });

  it("reads ISO-8601 with offset and a [tag] component", () => {
    const l = parseLine(REAL.isoTag, "openclaw")!;
    expect(l.time).toBe("10:32:12");
    expect(l.source).toBe("plugins");
    expect(l.message).toMatch(/^bonjour: advertised/);
  });

  it("reads a bare clock and a syslog stamp", () => {
    expect(parseLine("10:32:25 something", "j")!.time).toBe("10:32:25");
    expect(parseLine("Jul 24 10:32:25 something", "j")!.time).toBe("10:32:25");
  });

  it("returns null for an empty line and keeps the raw text otherwise", () => {
    expect(parseLine("   ", "j")).toBeNull();
    expect(parseLine(REAL.python, "j")!.raw).toBe(REAL.python);
  });
});

describe("detectLevel", () => {
  // The gates in this repo print their score every run; FAIL=0 is a GREEN gate, and reading
  // it as an error would paint the whole stream red.
  it("treats FAIL=0 as info and FAIL=n>0 as an error", () => {
    expect(detectLevel("cc-verify: PASS=24 FAIL=0").level).toBe("info");
    expect(detectLevel("cc-verify: PASS=24 FAIL=1").level).toBe("error");
  });

  it("prefers an explicit level word over a counted failure", () => {
    expect(detectLevel("WARNING gate FAIL=3").level).toBe("warn");
  });

  it("recognises Turkish and English severity words", () => {
    expect(detectLevel("HATA: bağlanamadı").level).toBe("error");
    expect(detectLevel("UYARI: eksik").level).toBe("warn");
    expect(detectLevel("Traceback (most recent call last)").level).toBe("error");
  });

  it("catches failure phrasing without a level word", () => {
    expect(detectLevel("connection refused").level).toBe("error");
    expect(detectLevel("işlem başarısız").level).toBe("error");
  });

  // Never manufacture a severity: default to info AND mark it.
  it("defaults to info and flags that it was inferred", () => {
    const d = detectLevel("just some text");
    expect(d).toEqual({ level: "info", inferred: true });
  });
});

describe("stripAnsi / isNoise", () => {
  it("removes colour codes and carriage returns", () => {
    expect(stripAnsi("[31mred[0m\r")).toBe("red");
  });

  it("treats separators, spinners and bare progress as noise", () => {
    expect(isNoise("--------------------")).toBe(true);
    expect(isNoise("   ")).toBe(true);
    expect(isNoise("42%")).toBe(true);
    expect(isNoise("2026-07-24 real line")).toBe(false);
  });
});

describe("renderLine", () => {
  it("writes the severity as a WORD, not only as colour", () => {
    const plain = renderLine(parseLine(REAL.noStamp, "hermes"), { colour: false });
    expect(plain).toContain("UYARI");
    expect(plain).not.toContain("[");
  });

  it("marks an inferred severity so it is never mistaken for a stated one", () => {
    expect(renderLine(parseLine("plain text", "j"), { colour: false })).toContain("BİLGİ?");
  });

  it("aligns columns at a fixed width", () => {
    const a = renderLine(parseLine(REAL.python, "hermes"), { colour: false });
    const b = renderLine(parseLine(REAL.noStamp, "a-very-long-job-name-here"), { colour: false });
    expect(a.indexOf("│", a.indexOf("│") + 1)).toBe(b.indexOf("│", b.indexOf("│") + 1));
  });

  it("shows a placeholder when the line had no clock", () => {
    expect(renderLine(parseLine(REAL.noStamp, "j"), { colour: false })).toContain("--:--");
  });

  it("emits colour when asked and truncates to the width", () => {
    const c = renderLine(parseLine(REAL.python, "hermes"), { colour: true, width: 60 });
    expect(c).toContain("[");
    expect(stripAnsi(c).length).toBeLessThanOrEqual(60);
  });

  it("renders nothing for a null line", () => {
    expect(renderLine(null)).toBe("");
  });
});

describe("fold", () => {
  // Folded, not dropped: 200 identical errors is information, 199 duplicate lines is not.
  it("counts consecutive duplicates and reports the count when the line changes", () => {
    let st = { lastKey: "", count: 0 };
    const same = parseLine("2026-07-24 10:00:00 boom", "j");
    ({ state: st } = fold(same, st));
    ({ state: st } = fold(same, st));
    ({ state: st } = fold(same, st));
    const out = fold(parseLine("2026-07-24 10:00:01 different", "j"), st);
    expect(out.emit).toBe("  ×3");
  });

  it("emits nothing when there was no repetition", () => {
    let st = { lastKey: "", count: 0 };
    ({ state: st } = fold(parseLine("a", "j"), st));
    expect(fold(parseLine("b", "j"), st).emit).toBeNull();
  });

  it("ignores nulls without disturbing the state", () => {
    const st = { lastKey: "k", count: 2 };
    expect(fold(null, st)).toEqual({ emit: null, state: st });
  });
});

describe("levelFilter", () => {
  it("passes everything when unset or unrecognised", () => {
    expect(levelFilter(undefined)("debug")).toBe(true);
    expect(levelFilter("nonsense")("debug")).toBe(true);
  });

  it("keeps only the requested levels", () => {
    const f = levelFilter("error,warn");
    expect(f("error")).toBe(true);
    expect(f("info")).toBe(false);
  });
});

describe("header", () => {
  it("labels the columns so the stream is self-describing", () => {
    const h = header(12);
    expect(h[0]).toContain("saat");
    expect(h[0]).toContain("seviye");
    expect(h[1]).toMatch(/^─+/);
  });
});
