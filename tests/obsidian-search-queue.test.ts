// L29 — asking the brain a question from inside Obsidian. The queue contract must be
// idempotent (a question answered once stays answered) and the lexical channel must be a
// pure bonus: with Obsidian closed the semantic answer still lands.
import { describe, test, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processSearchQueue, type RecallHit } from "../server/brain-obsidian";

let vault: string;
const qPath = () => join(vault, "orchestra", "search.md");
const answers = () => {
  const d = join(vault, "orchestra", "answers");
  return existsSync(d) ? readdirSync(d).filter((f) => f.startsWith("search-")) : [];
};

const hits = (n: number): RecallHit[] =>
  Array.from({ length: n }, (_, i) => ({ id: `learned:h${i}`, tier: "learned", score: 0.9 - i * 0.1, excerpt: `gövde ${i}` }));

function writeQueue(lines: string[]): void {
  mkdirSync(join(vault, "orchestra"), { recursive: true });
  writeFileSync(qPath(), `---\ntags: [orchestra]\n---\n\n# 🔎 Hafızada ara\n\n${lines.join("\n")}\n`);
}

beforeEach(() => { vault = mkdtempSync(join(tmpdir(), "obs-search-")); });

describe("queue contract", () => {
  test("an unchecked query is answered, cited and marked done", async () => {
    writeQueue(["- [ ] obsidian drift kökü"]);
    const n = await processSearchQueue(vault, { recall: async () => hits(2) });
    expect(n).toBe(1);
    expect(readFileSync(qPath(), "utf8")).toContain("- [x] obsidian drift kökü");

    const [file] = answers();
    const body = readFileSync(join(vault, "orchestra", "answers", file), "utf8");
    expect(body).toContain("# 🔎 obsidian drift kökü");
    expect(body).toContain("[[learned-h0|learned:h0]]"); // wikilink back to the memory note
    expect(body).toContain("gövde 0");
  });

  test("re-running answers nothing — a question is never answered twice", async () => {
    writeQueue(["- [ ] tek soru"]);
    expect(await processSearchQueue(vault, { recall: async () => hits(1) })).toBe(1);
    expect(await processSearchQueue(vault, { recall: async () => hits(1) })).toBe(0);
    expect(answers()).toHaveLength(1);
  });

  test("the template placeholder is not a question", async () => {
    writeQueue(["- [ ] <aramanı buraya yaz>"]);
    expect(await processSearchQueue(vault, { recall: async () => hits(1) })).toBe(0);
  });

  test("an already-checked line is left alone", async () => {
    writeQueue(["- [x] eski soru"]);
    expect(await processSearchQueue(vault, { recall: async () => hits(1) })).toBe(0);
  });

  test("a missing queue file is not an error", async () => {
    expect(await processSearchQueue(vault, { recall: async () => hits(1) })).toBe(0);
  });
});

describe("the two channels", () => {
  test("semantic and lexical results are labelled separately, not merged into one ranking", async () => {
    // The whole reason this lives here and not in askShared: a lexical score is not a cosine
    // similarity, so the note shows both lists rather than interleaving them.
    writeQueue(["- [ ] orkestra"]);
    await processSearchQueue(vault, {
      recall: async () => hits(1),
      lexical: async () => [{ path: "orchestra/ask.md", score: -0.13, context: "Orkestra'ya sor" }],
    });
    const body = readFileSync(join(vault, "orchestra", "answers", answers()[0]), "utf8");
    expect(body).toContain("## 🧠 Anlamsal (brain)");
    expect(body).toContain("## 🔤 Sözcüksel (Obsidian)");
    expect(body).toContain("[[orchestra/ask]]");
    expect(body).toContain("1 anlamsal · 1 sözcüksel");
    // Semantic block must come first — the brain is the authoritative channel.
    expect(body.indexOf("Anlamsal")).toBeLessThan(body.indexOf("Sözcüksel"));
  });

  test("a closed Obsidian still yields the semantic answer", async () => {
    writeQueue(["- [ ] soru"]);
    const n = await processSearchQueue(vault, {
      recall: async () => hits(3),
      lexical: async () => { throw new Error("vault offline"); },
    });
    expect(n).toBe(1);
    const body = readFileSync(join(vault, "orchestra", "answers", answers()[0]), "utf8");
    expect(body).toContain("learned:h0");
    expect(body).toContain("Obsidian kapalı olabilir");
  });

  test("no lexical channel at all is fine — it is strictly optional", async () => {
    writeQueue(["- [ ] soru"]);
    expect(await processSearchQueue(vault, { recall: async () => hits(1) })).toBe(1);
  });

  test("a failing recall is reported in the note, not swallowed, and still marked done", async () => {
    writeQueue(["- [ ] patlayan soru"]);
    const n = await processSearchQueue(vault, { recall: async () => { throw new Error("brain down"); } });
    expect(n).toBe(1);
    const body = readFileSync(join(vault, "orchestra", "answers", answers()[0]), "utf8");
    expect(body).toContain("[!warning]");
    expect(body).toContain("brain down");
  });

  test("zero hits is stated plainly rather than dressed up", async () => {
    writeQueue(["- [ ] hiçbir şey"]);
    await processSearchQueue(vault, { recall: async () => [] });
    expect(readFileSync(join(vault, "orchestra", "answers", answers()[0]), "utf8"))
      .toContain("_(anlamsal isabet yok)_");
  });
});
