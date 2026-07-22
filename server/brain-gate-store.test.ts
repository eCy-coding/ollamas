// Gate kalıcılığı — bozuk gate loop'u DÜŞÜRMEMELİ.
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isValidGate, loadGate, saveGate, gatePath } from "./brain-gate-store";

let dir = "";
const prev = process.env.BRAIN_LOOP_DIR;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gate-store-"));
  process.env.BRAIN_LOOP_DIR = dir;
});
afterEach(() => {
  if (prev === undefined) delete process.env.BRAIN_LOOP_DIR;
  else process.env.BRAIN_LOOP_DIR = prev;
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* geçici dizin */ }
});

// 4 rows to match EXPERTS.length (loadGate rejects a wrong-expert-count gate → cold-start).
const gate = (dim = 3) => ({ W: [Array(dim).fill(0.1), Array(dim).fill(0.2), Array(dim).fill(0.3), Array(dim).fill(0.4)], b: [0, 0, 0, 0] });

describe("isValidGate", () => {
  test("sağlam gate kabul", () => expect(isValidGate(gate())).toBe(true));
  test("NaN reddedilir — softmax'i zehirler", () => {
    expect(isValidGate({ W: [[NaN, 1, 1], [1, 1, 1], [1, 1, 1]], b: [0, 0, 0] })).toBe(false);
  });
  test("düzensiz satır boyu reddedilir", () => {
    expect(isValidGate({ W: [[1, 2], [1, 2, 3], [1, 2]], b: [0, 0, 0] })).toBe(false);
  });
  test("W/b uzunluk uyuşmazlığı reddedilir", () => {
    expect(isValidGate({ W: [[1], [1]], b: [0, 0, 0] })).toBe(false);
  });
  test("çöp girdiler reddedilir", () => {
    for (const bad of [null, undefined, {}, [], "gate", { W: [], b: [] }]) expect(isValidGate(bad)).toBe(false);
  });
});

describe("saveGate / loadGate", () => {
  test("yaz-oku turu", () => {
    expect(saveGate(gate())).toBe(true);
    expect(loadGate()).toEqual(gate());
  });

  test("geçersiz gate diske YAZILMAZ", () => {
    expect(saveGate({ W: [[NaN]], b: [0] } as any)).toBe(false);
    expect(existsSync(gatePath())).toBe(false);
  });

  test("bozuk gate.json son-iyi yedeğe düşer (loop düşmez)", () => {
    saveGate(gate(3));            // sağlam sürüm
    saveGate({ ...gate(3), b: [1, 1, 1, 1] }); // ikinci yazım → birincisi yedeğe geçer
    writeFileSync(gatePath(), "{ bozuk json");  // dosya bozuldu
    const g = loadGate();
    expect(g).not.toBeNull();     // yedekten kurtarıldı
    expect(isValidGate(g)).toBe(true);
  });

  test("hiç dosya yoksa null (soğuk başlangıç, hata değil)", () => {
    expect(loadGate()).toBeNull();
  });
});
