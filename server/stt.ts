// Speech-to-text execution (I/O side of stt-catalog, which stays pure).
//
// Extracted so the HTTP route (/api/ai/transcribe) and the Obsidian audio bridge
// (brain-obsidian-audio) share ONE transcription path instead of each carrying its own copy
// of the provider selection, key lookup, multipart build and error mapping.
import { sttEntryFor, buildTranscribeForm, STT_CATALOG, type SttCatalogEntry } from "./stt-catalog";
import { ProviderRouter } from "./providers";

/**
 * Container formats the provider will decode. Verified against Groq's own rejection message:
 * "file must be one of the following types: [flac mp3 mp4 mpeg mpga m4a ogg opus wav webm]".
 * Filtering here means an unsupported attachment (aiff, a PDF someone dropped in) is skipped
 * locally instead of burning a request to earn a 400.
 */
export const STT_EXTENSIONS = new Set([
  ".flac", ".mp3", ".mp4", ".mpeg", ".mpga", ".m4a", ".ogg", ".opus", ".wav", ".webm",
]);

export const isTranscribable = (filename: string): boolean =>
  STT_EXTENSIONS.has((filename.match(/\.[^.]+$/)?.[0] ?? "").toLowerCase());

/** First provider with a key — env first, then the encrypted vault. null → nothing configured. */
export function resolveSttEntry(): SttCatalogEntry | null {
  return sttEntryFor() ?? Object.values(STT_CATALOG).find((e) => ProviderRouter.keyPool(e.id).length > 0) ?? null;
}

export interface TranscribeResult {
  ok: boolean;
  text?: string;
  provider?: string;
  model?: string;
  error?: string;
  /** HTTP-ish class so callers can tell "retry later" from "this file will never work". */
  kind?: "unconfigured" | "too_large" | "provider" | "network";
}

/**
 * Transcribe one audio buffer. Never throws — the caller is usually a background sync tick,
 * and a 5-minute loop must not die because a provider had a bad minute.
 *
 * `kind` matters more than the message: a `provider` failure on a specific file (a 757-byte
 * m4a container with no audio in it, say) is permanent and should stop being retried, while
 * `network` is transient.
 */
export async function transcribeAudio(
  audio: Buffer, filename: string, opts: { timeoutMs?: number } = {},
): Promise<TranscribeResult> {
  const entry = resolveSttEntry();
  if (!entry) {
    return { ok: false, kind: "unconfigured", error: "no STT provider key configured (set GROQ_API_KEY — free tier: console.groq.com/keys)" };
  }
  let form: FormData;
  try {
    form = buildTranscribeForm(entry, audio, filename);
  } catch (e: any) {
    return { ok: false, kind: "too_large", error: String(e?.message ?? e) };
  }
  try {
    const r = await fetch(`${entry.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ProviderRouter.getDecryptedKey(entry.id)}` },
      body: form,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
    });
    if (!r.ok) {
      const detail = (await r.text().catch(() => "")).slice(0, 200);
      return { ok: false, kind: "provider", error: `${entry.id} transcription error ${r.status}: ${detail}` };
    }
    const j: any = await r.json();
    return { ok: true, text: String(j?.text ?? "").trim(), provider: entry.id, model: entry.defaultModel };
  } catch (e: any) {
    return { ok: false, kind: "network", error: String(e?.message ?? e).slice(0, 300) };
  }
}
