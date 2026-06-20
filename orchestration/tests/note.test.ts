import { describe, it, expect } from "vitest";
import { parseNotes, validateNote, refDeficit, noteKey } from "../bin/lib/note";

const valid = {
  id: "backend-backend-1", persona: "backend", targetLane: "backend",
  targetPath: "backend/mesh", severity: "med", finding: "orphan dir",
  solution: { summary: "sil", refs: [
    { repo: "a/b", license: "MIT", url: "u", kind: "copy" },
    { repo: "c/d", license: "Apache-2.0", url: "u2", kind: "idea" },
  ] },
};

function fenced(obj: unknown): string {
  return "serbest metin\n\n```note\n" + JSON.stringify(obj, null, 2) + "\n```\n\nbaşka metin";
}

describe("parseNotes", () => {
  it("```note fenced bloklarını çıkarır + JSON parse eder", () => {
    const r = parseNotes(fenced(valid));
    expect(r.notes.length).toBe(1);
    expect(r.notes[0].id).toBe("backend-backend-1");
    expect(r.errors.length).toBe(0);
  });
  it("çoklu blok → çoklu not", () => {
    const md = fenced(valid) + "\n" + fenced({ ...valid, id: "backend-backend-2" });
    expect(parseNotes(md).notes.length).toBe(2);
  });
  it("bozuk JSON bloğu → errors'a yazar, kalanı parse eder", () => {
    const md = "```note\n{bad json\n```\n" + fenced(valid);
    const r = parseNotes(md);
    expect(r.notes.length).toBe(1);
    expect(r.errors.length).toBe(1);
  });
  it("note bloğu yok → boş", () => {
    expect(parseNotes("# başlık\nnormal markdown").notes).toEqual([]);
  });
});

describe("validateNote", () => {
  it("geçerli not → ok + default doldurma (minRefs/status/source)", () => {
    const v = validateNote(valid);
    expect(v.ok).toBe(true);
    expect(v.note!.minRefs).toBe(2);
    expect(v.note!.status).toBe("open");
    expect(v.note!.source).toBe("authored");
    expect(v.note!.confidence).toBe("asserted");
  });
  it("zorunlu alan eksik (id) → ok=false", () => {
    const { id, ...rest } = valid;
    expect(validateNote(rest).ok).toBe(false);
  });
  it("geçersiz severity → ok=false", () => {
    expect(validateNote({ ...valid, severity: "huge" }).ok).toBe(false);
  });
});

describe("refDeficit", () => {
  it("refs < minRefs → true", () => {
    const v = validateNote({ ...valid, solution: { summary: "x", refs: [valid.solution.refs[0]] } }).note!;
    expect(refDeficit(v)).toBe(true);
  });
  it("refs >= minRefs → false", () => {
    expect(refDeficit(validateNote(valid).note!)).toBe(false);
  });
  it("solution yok → true (kaynak yetersiz)", () => {
    const v = validateNote({ ...valid, solution: undefined } as never).note!;
    expect(refDeficit(v)).toBe(true);
  });
});

describe("noteKey — dedup anahtarı", () => {
  it("targetPath + normalize finding ile çakışan notları aynı anahtara map'ler", () => {
    const a = validateNote(valid).note!;
    const b = validateNote({ ...valid, id: "frontend-x-9", persona: "frontend", finding: "Orphan Dir!!" }).note!;
    expect(noteKey(a)).toBe(noteKey(b));
  });
});
