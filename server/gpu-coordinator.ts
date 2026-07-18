// GPU coordinator (Tur-4 research: "context-aware embedding batcher") — the chat LLM
// and the embedder share Apple Silicon unified memory, so background embedding must
// yield while a generation runs. Every local generation flows through
// ProviderRouter.generate → executeProvider (the one choke-point), which brackets
// itself with beginLLM/endLLM; consumers gate on llmActive(). Zero-dep, in-process.
let activeGenerations = 0;
let lastActivityAt = 0;

export function beginLLM(at = Date.now()): void {
  activeGenerations++;
  lastActivityAt = at;
}

export function endLLM(at = Date.now()): void {
  activeGenerations = Math.max(0, activeGenerations - 1);
  lastActivityAt = at;
}

/** true while a local generation runs OR within the quiet window after the last one —
 *  KV-cache/queue pressure on the GPU outlasts the HTTP call itself.
 *  GPU_QUIET_MS tunes the window (default 2000). */
export function llmActive(at = Date.now()): boolean {
  if (activeGenerations > 0) return true;
  if (lastActivityAt === 0) return false;
  const quiet = Number(process.env.GPU_QUIET_MS) || 2000;
  return at - lastActivityAt < quiet;
}

export function resetGpuCoordinatorForTest(): void {
  activeGenerations = 0;
  lastActivityAt = 0;
}
