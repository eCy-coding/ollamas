// server/stt-catalog.ts — free-tier SPEECH-TO-TEXT provider catalog (pure, zero-dep).
// Groq's free tier serves whisper-large-v3 at ~2,000 requests/day on the SAME
// GROQ_API_KEY as chat (one signup, two modalities), via the OpenAI-compat
// `/audio/transcriptions` multipart endpoint. Native FormData/Blob — no SDK.

export interface SttCatalogEntry {
  id: string;
  baseUrl: string;
  envKey: string;
  defaultModel: string;
  /** Provider's per-file upload cap — enforced BEFORE any network call. */
  maxBytes: number;
}

export const STT_CATALOG: Record<string, SttCatalogEntry> = {
  groq: {
    id: "groq",
    baseUrl: "https://api.groq.com/openai/v1",
    envKey: "GROQ_API_KEY",
    defaultModel: "whisper-large-v3",
    maxBytes: 25 * 1024 * 1024,
  },
};

/** First STT provider whose key is present; null → the route answers an honest 503. */
export function sttEntryFor(env: NodeJS.ProcessEnv = process.env): SttCatalogEntry | null {
  for (const e of Object.values(STT_CATALOG)) {
    if ((env[e.envKey] || "").trim()) return e;
  }
  return null;
}

/** OpenAI-compat transcription multipart body. Throws on oversize input so a 30MB upload
 *  fails fast with the real reason instead of a provider-side 413. */
export function buildTranscribeForm(entry: SttCatalogEntry, audio: Buffer, filename: string): FormData {
  if (audio.byteLength > entry.maxBytes) {
    throw new Error(`audio too large: ${audio.byteLength} bytes > ${entry.id} cap ${entry.maxBytes} (25MB)`);
  }
  const form = new FormData();
  form.append("file", new File([new Uint8Array(audio)], filename || "audio.wav"));
  form.append("model", entry.defaultModel);
  return form;
}
