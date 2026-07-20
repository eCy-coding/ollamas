// FAZ 0 SPIKE — ollama token-logprob yüzeyi var mı? (ship edilmez, ölçüm aracı)
//
// Gerçek p_final = Σ_j w_j·p_j(y|x) (formüller.md F3a RAG-Token) token logprob İSTER.
// Yerel/keyless sağlayıcılar genelde vermez. Bu probe VARSAYMAZ, ÖLÇER: iki yüzeyi
// dener ve ham kanıtı basar. Faz 7 yalnız burada logprob görülürse açılır; görülmezse
// mixtureSelect + expectedMixture dürüst yaklaşım olarak kalır (brain-formulas.ts başlığı).
//
// Koş: npx tsx scripts/probe-logprobs.ts | jq .
import { argv, env, exit } from "node:process";

const HOST = env.OLLAMA_HOST || "http://127.0.0.1:11434";
const MODEL = argv[2] || env.PROBE_MODEL || "qwen3:4b";
const TIMEOUT_MS = Number(env.PROBE_TIMEOUT_MS) || 45_000;

interface SurfaceResult {
  surface: string;
  ok: boolean;
  httpStatus?: number;
  /** Yanıtta per-token logprob DİZİSİ bulundu mu (asıl soru). */
  logprobsFound: boolean;
  /** Bulunduysa ilk birkaç örnek — kanıt, iddia değil. */
  sample?: unknown;
  /** Yanıtın hangi anahtarları taşıdığı (logprob nerede aranmalı ipucu). */
  topLevelKeys?: string[];
  error?: string;
}

async function post(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(`${HOST}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = { _raw: text.slice(0, 400) }; }
  return { status: r.status, json };
}

/** Yanıt ağacında per-token logprob taşıyan bir dizi var mı — biçimden bağımsız arar. */
function findLogprobs(node: unknown, depth = 0): unknown | null {
  if (depth > 6 || node == null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    // [{token, logprob}, ...] deseni
    const hit = node.find((x) => x && typeof x === "object" && "logprob" in (x as object));
    if (hit) return node.slice(0, 3);
    for (const el of node.slice(0, 5)) {
      const r = findLogprobs(el, depth + 1);
      if (r) return r;
    }
    return null;
  }
  const obj = node as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (/^(logprobs|top_logprobs)$/.test(k) && v != null) {
      const inner = findLogprobs(v, depth + 1);
      if (inner) return inner;
      if (typeof v === "object" && Object.keys(v as object).length) return v;
    }
    const r = findLogprobs(v, depth + 1);
    if (r) return r;
  }
  return null;
}

async function probeNativeChat(): Promise<SurfaceResult> {
  const surface = "ollama /api/chat (options.logprobs)";
  try {
    const { status, json } = await post("/api/chat", {
      model: MODEL,
      messages: [{ role: "user", content: "Say OK." }],
      stream: false,
      options: { logprobs: true, top_logprobs: 2, num_predict: 8, temperature: 0 },
    });
    const found = findLogprobs(json);
    return {
      surface, ok: status === 200, httpStatus: status,
      logprobsFound: !!found, sample: found ?? undefined,
      topLevelKeys: json && typeof json === "object" ? Object.keys(json) : undefined,
    };
  } catch (e: any) {
    return { surface, ok: false, logprobsFound: false, error: String(e?.message ?? e).slice(0, 200) };
  }
}

async function probeOpenAICompat(): Promise<SurfaceResult> {
  const surface = "ollama /v1/chat/completions (logprobs)";
  try {
    const { status, json } = await post("/v1/chat/completions", {
      model: MODEL,
      messages: [{ role: "user", content: "Say OK." }],
      stream: false,
      logprobs: true,
      top_logprobs: 2,
      max_tokens: 8,
      temperature: 0,
    });
    const found = findLogprobs(json);
    return {
      surface, ok: status === 200, httpStatus: status,
      logprobsFound: !!found, sample: found ?? undefined,
      topLevelKeys: json?.choices?.[0] ? Object.keys(json.choices[0]) : undefined,
    };
  } catch (e: any) {
    return { surface, ok: false, logprobsFound: false, error: String(e?.message ?? e).slice(0, 200) };
  }
}

async function main() {
  const [chat, openai] = await Promise.all([probeNativeChat(), probeOpenAICompat()]);
  const anyLogprobs = chat.logprobsFound || openai.logprobsFound;
  console.log(JSON.stringify({
    probe: "logprobs", host: HOST, model: MODEL,
    chat_logprobs: chat.logprobsFound,
    openai_logprobs: openai.logprobsFound,
    // Faz 7 (gerçek p_final / RAG-Token) yalnız bu true ise açılır.
    phase7_unlocked: anyLogprobs,
    verdict: anyLogprobs
      ? "logprob VAR → Faz 7 açılabilir (yalnız logprob veren uzmanlar için)"
      : "logprob YOK → mixtureSelect + expectedMixture dürüst yaklaşım olarak KALIR",
    surfaces: [chat, openai],
  }, null, 2));
  exit(0);
}

void main();
