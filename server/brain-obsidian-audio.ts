// L28 — voice memos become memories.
//
// WHY: Obsidian ships an audio recorder, and on 2026-07-22 Emre used it. The result sat in
// the vault as `Recording 20260722114904.m4a`, linked from a note, and utterly opaque: not
// searchable, not recallable, not part of the brain. Capture without transcription is a
// filing cabinet, not a second brain.
//
// The transcript is written into inbox/ as an ordinary note, which means it flows to the
// brain through the L27 adoption path — no second ingestion route to keep in sync.
//
// Failure discipline: `provider` errors on a specific file are treated as PERMANENT after a
// couple of attempts. That is not pessimism, it is the observed case — Emre's recording is a
// 757-byte MP4 container with no audio in it, and whisper returns 500 on it every single
// time. Retrying that forever on a 5-minute tick would be a self-inflicted rate-limit.
import { readFileSync, readdirSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { isTranscribable, transcribeAudio, type TranscribeResult } from "./stt";

/** Directories a recording realistically lands in. Tier folders are brain-owned, .obsidian is config. */
const SCAN_DIRS = ["", "inbox", "attachments", "assets"];

/** Give up on a file after this many provider-side rejections — it will not start decoding. */
const MAX_ATTEMPTS = 2;

export interface AudioLedgerEntry {
  hash: string;
  status: "done" | "failed" | "pending";
  attempts: number;
  note?: string;
  error?: string;
  chars?: number;
}
export type AudioLedger = Record<string, AudioLedgerEntry>;

const ledgerPath = (vault: string) => join(vault, "_index", ".audio-state.json");

export function loadAudioLedger(vault: string): AudioLedger {
  try { return JSON.parse(readFileSync(ledgerPath(vault), "utf8")); } catch { return {}; }
}
function saveAudioLedger(vault: string, l: AudioLedger): void {
  mkdirSync(join(vault, "_index"), { recursive: true });
  writeFileSync(ledgerPath(vault), JSON.stringify(l, null, 0));
}

/** Content hash — re-recording over the same filename must be treated as new audio. */
export const audioHash = (buf: Buffer): string => createHash("sha1").update(buf).digest("hex").slice(0, 16);

/** Every transcribable file in the vault, as vault-relative paths. */
export function findAudio(vault: string): string[] {
  const out: string[] = [];
  for (const d of SCAN_DIRS) {
    const dir = d ? join(vault, d) : vault;
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!isTranscribable(f)) continue;
      const rel = d ? `${d}/${f}` : f;
      try { if (statSync(join(vault, rel)).isFile()) out.push(rel); } catch { /* vanished mid-scan */ }
    }
  }
  return out.sort();
}

/** Note filename for a recording's transcript — deterministic, so re-runs upsert. */
export const transcriptNoteFor = (rel: string): string =>
  `${(rel.split("/").pop() ?? rel).replace(/\.[^.]+$/, "")}.md`;

/**
 * The transcript note. Deliberately plain: no brain frontmatter, because adoption (L27) is
 * what turns it into a memory and it derives the id from the filename. The audio stays
 * embedded so the note keeps a way back to the source recording.
 */
export function transcriptNote(rel: string, text: string, provider: string): string {
  const base = (rel.split("/").pop() ?? rel);
  return `---\nsource: voice/${provider}\ntier: episodic\n---\n\n${text}\n\n![[${base}]]\n`;
}

export interface AudioSyncResult {
  scanned: number;
  transcribed: number;
  skipped: number;
  failed: number;
  /** Honest reason strings for whatever did not make it — surfaced, never swallowed. */
  errors: { file: string; error: string }[];
}

/**
 * Transcribe any new recording into inbox/. Injectable transcriber keeps the tests offline.
 */
export async function syncAudio(
  vault: string,
  opts: { transcribe?: (a: Buffer, f: string) => Promise<TranscribeResult>; maxBytes?: number } = {},
): Promise<AudioSyncResult> {
  const transcribe = opts.transcribe ?? transcribeAudio;
  const maxBytes = opts.maxBytes ?? 25 * 1024 * 1024;
  const ledger = loadAudioLedger(vault);
  const res: AudioSyncResult = { scanned: 0, transcribed: 0, skipped: 0, failed: 0, errors: [] };

  for (const rel of findAudio(vault)) {
    res.scanned++;
    let buf: Buffer;
    try { buf = readFileSync(join(vault, rel)); } catch { res.skipped++; continue; }
    if (buf.byteLength > maxBytes) {
      res.skipped++;
      res.errors.push({ file: rel, error: `oversize (${buf.byteLength} bytes)` });
      continue;
    }
    const hash = audioHash(buf);
    const prev = ledger[rel];
    // Same bytes already handled — done, or given up on. Either way, do not spend a request.
    if (prev && prev.hash === hash && (prev.status === "done" || prev.attempts >= MAX_ATTEMPTS)) { res.skipped++; continue; }

    const attempts = prev && prev.hash === hash ? prev.attempts : 0;
    const r = await transcribe(buf, rel.split("/").pop() ?? rel);

    if (!r.ok) {
      // "unconfigured" is our fault, not the file's — never count it against the file, or a
      // missing key would permanently blacklist every recording in the vault.
      const counted = r.kind === "unconfigured" ? attempts : attempts + 1;
      ledger[rel] = { hash, status: "failed", attempts: counted, error: r.error };
      res.failed++;
      res.errors.push({ file: rel, error: r.error ?? "unknown" });
      continue;
    }
    const text = (r.text ?? "").trim();
    if (!text) {
      // Silence is not a thought. Mark done so we stop paying to re-confirm the silence.
      ledger[rel] = { hash, status: "done", attempts: attempts + 1, chars: 0 };
      res.skipped++;
      continue;
    }
    mkdirSync(join(vault, "inbox"), { recursive: true });
    const note = transcriptNoteFor(rel);
    writeFileSync(join(vault, "inbox", note), transcriptNote(rel, text, r.provider ?? "stt"));
    ledger[rel] = { hash, status: "done", attempts: attempts + 1, note: `inbox/${note}`, chars: text.length };
    res.transcribed++;
  }

  saveAudioLedger(vault, ledger);
  writeAudioIndex(vault, ledger);
  return res;
}

/**
 * A human-readable ledger under _index/ — which is NOT scanned by adoption, so reporting a
 * failed transcription cannot pollute the brain with "transcription failed" memories while
 * still being visible in Obsidian.
 */
export function writeAudioIndex(vault: string, ledger: AudioLedger): void {
  const rows = Object.entries(ledger).sort(([a], [b]) => a.localeCompare(b));
  const line = (f: string, e: AudioLedgerEntry) =>
    e.status === "done"
      ? `- ✅ \`${f}\` → ${e.note ? `[[${e.note.replace(/^inbox\//, "").replace(/\.md$/, "")}]]` : "_(sessiz)_"}${e.chars ? ` · ${e.chars} kar` : ""}`
      : `- ⚠️ \`${f}\` — ${e.attempts}/${MAX_ATTEMPTS} deneme · ${String(e.error ?? "").slice(0, 160)}`;
  mkdirSync(join(vault, "_index"), { recursive: true });
  writeFileSync(join(vault, "_index", "audio.md"),
    `---\ncssclasses: [brain]\ntags: [index]\naliases: [Ses kayıtları]\n---\n\n`
    + `# 🎙️ Ses kayıtları\n\n> [!info] Kayıtlar transkript edilip \`inbox/\`'a düşer, oradan brain'e akar.\n\n`
    + (rows.length ? rows.map(([f, e]) => line(f, e)).join("\n") : "_(kayıt yok)_") + "\n");
}
