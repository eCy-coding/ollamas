// F7 GERÇEK p_final — logprob yakalama (RAG-Token karışımının ölçülebilir yarısı).
//
// perTokenMixture/sequenceLogprob (brain-formulas.ts) TANIMLIYDI ama HİÇ bağlı değildi
// (yalnız test çağırıyordu = ölü formül). ollama `/v1/chat/completions` per-token logprob
// VERİR (`/api/chat` vermez). Bu modül OpenAI-uyumlu yanıttan token logprob'larını çıkarır
// (saf) ve bir uzmanın ortalama logprob'unu getirir (IO). SÖZLEŞME: logprob VERMEYEN uzman
// (odysseus MCP) DIŞLANIR, sıfır SAYILMAZ; coverage açıkça raporlanır (perTokenMixture).
import { sequenceLogprob } from "./brain-formulas";

/** OpenAI-uyumlu yanıttan per-token logprob'ları çıkar (saf). Biçim:
 *  `choices[0].logprobs.content[] = {token, logprob}`. Eksik/bozuk → boş dizi. */
export function extractTokenLogprobs(resp: unknown): number[] {
  const content = (resp as any)?.choices?.[0]?.logprobs?.content;
  if (!Array.isArray(content)) return [];
  return content
    .map((c: any) => c?.logprob)
    .filter((x: any): x is number => typeof x === "number" && Number.isFinite(x));
}

/**
 * Bir uzmanın ORTALAMA token logprob'unu getir (IO). logprob vermeyen/erişilemeyen
 * uzman için null döner — çağıran (perTokenMixture) bunu DIŞLAR, sıfır saymaz.
 */
export async function fetchAvgLogprob(
  url: string, model: string, messages: { role: string; content: string }[],
  opts: { maxTokens?: number; timeoutMs?: number } = {},
): Promise<number | null> {
  try {
    const r = await fetch(`${url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, messages, max_tokens: opts.maxTokens ?? 64, logprobs: true, stream: false }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    });
    if (!r.ok) return null;
    return sequenceLogprob(extractTokenLogprobs(await r.json()));
  } catch {
    return null; // erişilemedi/timeout → ÖLÇÜLEMEDİ (null), yanlış DEĞİL
  }
}
