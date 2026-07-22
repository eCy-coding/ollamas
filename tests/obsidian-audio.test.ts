// L28 — voice memos become memories. The interesting behaviour is not the happy path but the
// failure discipline: Emre's actual recording is a 757-byte MP4 container with no audio, and
// whisper returns 500 on it every time. A 5-minute sync tick must learn that, not re-pay for
// it forever.
import { describe, test, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  syncAudio, findAudio, audioHash, transcriptNoteFor, transcriptNote, loadAudioLedger,
} from "../server/brain-obsidian-audio";
import { isTranscribable, STT_EXTENSIONS } from "../server/stt";
import { adoptHumanNote } from "../server/brain-obsidian-note";
import { sweepEmptyShells, isAbandonedShell } from "../server/brain-obsidian";
import type { TranscribeResult } from "../server/stt";

let vault: string;
beforeEach(() => { vault = mkdtempSync(join(tmpdir(), "obs-audio-")); });

const putAudio = (rel: string, bytes = "RIFFfake") => {
  const p = join(vault, rel);
  mkdirSync(join(p, "..").replace(/\/[^/]+$/, "") || vault, { recursive: true });
  mkdirSync(p.slice(0, p.lastIndexOf("/")), { recursive: true });
  writeFileSync(p, bytes);
};
const ok = (text: string) => async (): Promise<TranscribeResult> => ({ ok: true, text, provider: "groq", model: "whisper-large-v3" });
const fail = (kind: TranscribeResult["kind"], error = "boom") => async (): Promise<TranscribeResult> => ({ ok: false, kind, error });

describe("format gate", () => {
  test("only container formats the provider decodes are considered", () => {
    // Verified against Groq's own rejection message.
    for (const e of [".m4a", ".wav", ".mp3", ".webm", ".ogg", ".flac"]) expect(isTranscribable(`x${e}`)).toBe(true);
    // aiff was rejected live with a 400 — filter locally instead of buying that lesson again.
    for (const e of [".aiff", ".pdf", ".md", ".txt", ""]) expect(isTranscribable(`x${e}`)).toBe(false);
    expect(STT_EXTENSIONS.has(".m4a")).toBe(true);
  });

  test("extension matching is case-insensitive", () => {
    expect(isTranscribable("Recording.M4A")).toBe(true);
  });
});

describe("discovery", () => {
  test("finds recordings in the root and in inbox/, ignoring non-audio", () => {
    putAudio("Recording 2026.m4a");
    putAudio("inbox/memo.wav");
    writeFileSync(join(vault, "note.md"), "not audio");
    expect(findAudio(vault)).toEqual(["Recording 2026.m4a", "inbox/memo.wav"]);
  });
});

describe("transcription", () => {
  test("a recording becomes an inbox note that adoption can turn into a memory", async () => {
    putAudio("Recording 2026.m4a");
    const r = await syncAudio(vault, { transcribe: ok("Obsidyen kasası artık beynin canlı yüzeyi") });
    expect(r.transcribed).toBe(1);

    const note = join(vault, "inbox", "Recording 2026.md");
    expect(existsSync(note)).toBe(true);
    const body = readFileSync(note, "utf8");
    expect(body).toContain("Obsidyen kasası");
    expect(body).toContain("![[Recording 2026.m4a]]"); // keeps a way back to the source
    // The whole point: it flows to the brain through the ordinary L27 path.
    const mem = adoptHumanNote("Recording 2026.md", body)!;
    expect(mem.tier).toBe("episodic");
    expect(mem.source).toBe("voice/groq");
    expect(mem.content).toContain("Obsidyen kasası");
  });

  test("the same bytes are never transcribed twice", async () => {
    putAudio("memo.m4a");
    expect((await syncAudio(vault, { transcribe: ok("bir") })).transcribed).toBe(1);
    const second = await syncAudio(vault, { transcribe: async () => { throw new Error("must not be called"); } });
    expect(second.transcribed).toBe(0);
    expect(second.skipped).toBe(1);
  });

  test("re-recording over the same filename IS new audio", async () => {
    putAudio("memo.m4a", "RIFFone");
    await syncAudio(vault, { transcribe: ok("bir") });
    putAudio("memo.m4a", "RIFFtwo");
    expect((await syncAudio(vault, { transcribe: ok("iki") })).transcribed).toBe(1);
    expect(readFileSync(join(vault, "inbox", "memo.md"), "utf8")).toContain("iki");
  });

  test("silence produces no note — a blank recording is not a thought", async () => {
    putAudio("silence.m4a");
    const r = await syncAudio(vault, { transcribe: ok("   ") });
    expect(r.transcribed).toBe(0);
    expect(existsSync(join(vault, "inbox", "silence.md"))).toBe(false);
    // Marked done so we stop paying to re-confirm the silence.
    expect(loadAudioLedger(vault)["silence.m4a"].status).toBe("done");
  });
});

describe("failure discipline", () => {
  test("a file the provider cannot decode is given up on after 2 attempts", async () => {
    putAudio("broken.m4a"); // the real 757-byte case
    let calls = 0;
    const counting = async (): Promise<TranscribeResult> => { calls++; return { ok: false, kind: "provider", error: "groq 500" }; };
    for (let i = 0; i < 5; i++) await syncAudio(vault, { transcribe: counting });
    expect(calls, "must stop retrying a permanently undecodable file").toBe(2);
    expect(loadAudioLedger(vault)["broken.m4a"].status).toBe("failed");
  });

  test("a missing API key never blacklists a file — that failure is ours, not the file's", async () => {
    putAudio("memo.m4a");
    for (let i = 0; i < 3; i++) await syncAudio(vault, { transcribe: fail("unconfigured", "no key") });
    expect(loadAudioLedger(vault)["memo.m4a"].attempts).toBe(0);
    // Once the key arrives, it transcribes.
    expect((await syncAudio(vault, { transcribe: ok("nihayet") })).transcribed).toBe(1);
  });

  test("failures are reported, never swallowed", async () => {
    putAudio("broken.m4a");
    const r = await syncAudio(vault, { transcribe: fail("provider", "groq 500") });
    expect(r.failed).toBe(1);
    expect(r.errors[0]).toMatchObject({ file: "broken.m4a", error: "groq 500" });
  });

  test("oversize audio is rejected locally, before any network call", async () => {
    putAudio("big.wav", "x".repeat(1000));
    const r = await syncAudio(vault, { maxBytes: 100, transcribe: async () => { throw new Error("must not be called"); } });
    expect(r.skipped).toBe(1);
    expect(r.errors[0].error).toMatch(/oversize/);
  });

  test("the ledger lives under _index/, which adoption does not scan", async () => {
    putAudio("broken.m4a");
    await syncAudio(vault, { transcribe: fail("provider", "groq 500") });
    const idx = readFileSync(join(vault, "_index", "audio.md"), "utf8");
    expect(idx).toContain("broken.m4a");
    expect(idx).toContain("groq 500");
    // Reporting a failure must not create a "transcription failed" memory.
    expect(existsSync(join(vault, "inbox", "broken.md"))).toBe(false);
  });
});

describe("empty-shell sweep", () => {
  test("abandoned untitled canvases/bases are MOVED to the attic, not deleted", () => {
    writeFileSync(join(vault, "Başlıksız.canvas"), "{}");
    writeFileSync(join(vault, "Başlıksız 3.base"), "");
    const r = sweepEmptyShells(vault);
    expect(r.moved.sort()).toEqual(["Başlıksız 3.base", "Başlıksız.canvas"]);
    expect(existsSync(join(vault, "Başlıksız.canvas"))).toBe(false);
    expect(existsSync(join(vault, "_index", "attic", "Başlıksız.canvas"))).toBe(true);
  });

  test("Obsidian's default scaffold counts as abandoned — it is not an empty file", () => {
    // Observed live: 6 of 9 shells survived a byte-length check because Obsidian writes a
    // default view / empty text nodes rather than nothing at all.
    writeFileSync(join(vault, "Başlıksız 1.base"), "views:\n  - type: table\n    name: Tablo\n");
    writeFileSync(join(vault, "Başlıksız 2.canvas"),
      '{"nodes":[{"id":"a","type":"text","text":""},{"id":"b","type":"text","text":""}],"edges":[]}');
    expect(sweepEmptyShells(vault).moved.sort()).toEqual(["Başlıksız 1.base", "Başlıksız 2.canvas"]);
  });

  test("a canvas the user actually started is never touched", () => {
    writeFileSync(join(vault, "Başlıksız 1.canvas"), '{"nodes":[{"id":"a","type":"text","text":"gerçek fikir"}],"edges":[]}');
    writeFileSync(join(vault, "Başlıksız 2.canvas"), '{"nodes":[{"id":"a","type":"file","file":"Home.md"}],"edges":[]}');
    writeFileSync(join(vault, "Başlıksız 3.canvas"), '{"nodes":[{"id":"a","text":""},{"id":"b","text":""}],"edges":[{"id":"e"}]}');
    writeFileSync(join(vault, "Başlıksız.base"), "filters:\n  and:\n    - file.hasTag('x')\nviews:\n  - type: table\n");
    expect(sweepEmptyShells(vault).moved).toEqual([]);
    expect(existsSync(join(vault, "Başlıksız 1.canvas"))).toBe(true);
    expect(existsSync(join(vault, "Başlıksız.base"))).toBe(true);
  });

  test("an unparseable canvas is left alone — not ours to judge", () => {
    writeFileSync(join(vault, "Başlıksız 4.canvas"), "{ broken json");
    expect(sweepEmptyShells(vault).moved).toEqual([]);
  });

  test("a deliberately named empty canvas is not untitled-shaped, so it stays", () => {
    writeFileSync(join(vault, "roadmap.canvas"), "{}");
    expect(sweepEmptyShells(vault).moved).toEqual([]);
    expect(existsSync(join(vault, "roadmap.canvas"))).toBe(true);
  });
});

describe("pure helpers", () => {
  test("transcript note name is deterministic across directories", () => {
    expect(transcriptNoteFor("inbox/Recording 1.m4a")).toBe("Recording 1.md");
    expect(transcriptNoteFor("Recording 1.m4a")).toBe("Recording 1.md");
  });

  test("hash is content-addressed", () => {
    expect(audioHash(Buffer.from("a"))).not.toBe(audioHash(Buffer.from("b")));
    expect(audioHash(Buffer.from("a"))).toBe(audioHash(Buffer.from("a")));
  });

  test("the note carries no brain id — adoption owns that", () => {
    expect(transcriptNote("m.m4a", "metin", "groq")).not.toContain("id:");
  });
});
