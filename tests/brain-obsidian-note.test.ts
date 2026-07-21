// Pure note (de)serialization — round-trip, determinism, hash stability. No disk/DB.
import { describe, test, expect } from "vitest";
import {
  toMarkdown, parseMarkdown, noteFilename, contentHash, isTier, type NoteMemory,
} from "../server/brain-obsidian-note";

const mem = (over: Partial<NoteMemory> = {}): NoteMemory => ({
  id: "loop:a1b2", ns: "loop", tier: "learned", content: "gate persists via W_g store",
  source: "brain-loop", createdAt: 1784586870522, hits: 3, ...over,
});

describe("noteFilename — deterministic, fs-safe, id-derived", () => {
  test("ns delimiter and slashes collapse to hyphen", () => {
    expect(noteFilename("core:emre")).toBe("core-emre.md");
    expect(noteFilename("a/b\\c")).toBe("a-b-c.md");
  });
  test("same id always maps to same file (idempotent upsert, not append)", () => {
    expect(noteFilename("loop:a1b2")).toBe(noteFilename("loop:a1b2"));
  });
  test("reserved chars stripped, never empty", () => {
    expect(noteFilename('bad<>:"|?*name')).toMatch(/^[\w-]+\.md$/);
    expect(noteFilename("///")).toBe("note.md");
  });
});

describe("contentHash — stable, whitespace-normalized", () => {
  test("CRLF/trailing whitespace does not change the hash", () => {
    expect(contentHash("hello\nworld")).toBe(contentHash("hello\r\nworld  \n"));
  });
  test("different content → different hash", () => {
    expect(contentHash("a")).not.toBe(contentHash("b"));
  });
});

describe("toMarkdown / parseMarkdown round-trip", () => {
  test("memory fields survive a full round-trip", () => {
    const md = toMarkdown(mem());
    const p = parseMarkdown(md);
    expect(p.memory).not.toBeNull();
    expect(p.memory).toMatchObject({
      id: "loop:a1b2", ns: "loop", tier: "learned",
      content: "gate persists via W_g store", source: "brain-loop",
      createdAt: 1784586870522, hits: 3,
    });
  });
  test("frontmatter carries content_hash and tags", () => {
    const p = parseMarkdown(toMarkdown(mem()));
    expect(p.frontmatter.content_hash).toBe(contentHash(mem().content));
    expect(p.frontmatter.tags).toContain("tier/learned");
    expect(p.frontmatter.tags).toContain("ns/loop");
  });
  test("Related [[wikilinks]] render but never leak into the parsed body", () => {
    const md = toMarkdown(mem(), ["core-emre", "loop-7d9e"]); // resolved basenames
    expect(md).toContain("## Related");
    expect(md).toContain("[[core-emre]]");
    expect(md).toContain("[[loop-7d9e]]");
    expect(parseMarkdown(md).memory!.content).toBe("gate persists via W_g store");
  });
  test("self-link and duplicates are dropped from Related", () => {
    const md = toMarkdown(mem(), ["loop-a1b2", "core-emre", "core-emre"]); // self basename + dup
    expect(md.match(/\[\[core-emre\]\]/g)).toHaveLength(1);
    expect(md).not.toContain("[[loop-a1b2]]");
  });
  test("multiline + YAML-significant content survives round-trip", () => {
    const tricky = "line: with colon\n- and dash\n  # hash too";
    const p = parseMarkdown(toMarkdown(mem({ content: tricky })));
    expect(p.memory!.content).toBe(tricky);
  });
  test("empty source round-trips as null", () => {
    const p = parseMarkdown(toMarkdown(mem({ source: null })));
    expect(p.memory!.source).toBeNull();
  });
});

describe("parseMarkdown — rejects malformed / bad-tier notes", () => {
  test("no frontmatter → memory null", () => {
    expect(parseMarkdown("just body, no fences").memory).toBeNull();
  });
  test("invalid tier → memory null (never silently mis-tiered)", () => {
    const bad = toMarkdown(mem()).replace("tier: learned", "tier: bogus");
    expect(parseMarkdown(bad).memory).toBeNull();
  });
  test("human edit to body changes bodyHash (drives re-ingest)", () => {
    const original = parseMarkdown(toMarkdown(mem()));
    const edited = toMarkdown(mem()).replaceAll("gate persists via W_g store", "gate persists via learned W_g");
    expect(parseMarkdown(edited).bodyHash).not.toBe(original.bodyHash);
  });
});

describe("rich note: readable identity + typed properties + callout", () => {
  test("frontmatter carries aliases (readable title), cssclasses, confidence, actor", () => {
    const p = parseMarkdown(toMarkdown(mem({ confidence: 0.7, actor: "loop" })));
    expect(p.frontmatter.aliases).toContain("gate persists via W_g store");
    expect(p.frontmatter.cssclasses).toContain("tier-learned");
    expect(p.frontmatter.confidence).toBe("0.7");
    expect(p.frontmatter.actor).toBe("loop");
  });
  test("body opens with an H1 title + a callout banner", () => {
    const md = toMarkdown(mem({ tier: "learned", source: "brain-loop", confidence: 0.7 }));
    expect(md).toMatch(/# gate persists via W_g store/);
    expect(md).toMatch(/> \[!abstract\] learned · brain-loop · conf 0\.70 · 3× recall/);
  });
  test("title H1 + callout are stripped on parse (pure content recovered)", () => {
    const p = parseMarkdown(toMarkdown(mem({ confidence: 0.9, actor: "loop" })));
    expect(p.memory!.content).toBe("gate persists via W_g store"); // no #, no >, no meta
    expect(p.memory!.confidence).toBe(0.9);
    expect(p.memory!.actor).toBe("loop");
  });
  test("long content → title truncated to ≤60 chars with ellipsis", () => {
    const long = "a".repeat(120);
    const p = parseMarkdown(toMarkdown(mem({ content: long })));
    expect(p.frontmatter.aliases.length).toBeLessThanOrEqual(64);
    expect(p.memory!.content).toBe(long); // full content still recovered
  });
  test("no confidence/actor → those keys are omitted (not null strings)", () => {
    const md = toMarkdown(mem());
    expect(md).not.toMatch(/\nconfidence:/);
    expect(md).not.toMatch(/\nactor:/);
  });
});

describe("isTier guard", () => {
  test("accepts the five tiers, rejects others", () => {
    expect(["core", "learned", "procedural", "episodic", "working"].every(isTier)).toBe(true);
    expect(isTier("garbage")).toBe(false);
  });
});
