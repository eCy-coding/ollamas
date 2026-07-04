// server/cloudflare.ts — minimum-manual Cloudflare Workers AI onboarding. A valid Workers-AI
// token is enough to derive the account_id: GET /client/v4/accounts returns the account(s) the
// token can access, so the operator pastes ONLY the token — never the account id. The REST base
// is https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1 (OpenAI-compat). Pure
// parsing + a thin fetch, side-effect-safe (derivation never throws into the connect path).

/** First account id from a GET /client/v4/accounts response. Malformed/empty → null. */
export function parseCloudflareAccounts(json: any): string | null {
  const result = json?.result;
  if (!Array.isArray(result) || result.length === 0) return null;
  const id = result[0]?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** Derive the account_id from a Workers-AI token via GET /accounts. Returns null on any
 *  failure (bad token, network, empty) so the caller can surface an honest config error. */
export async function deriveCloudflareAccountId(token: string, fetchFn: typeof fetch = fetch): Promise<string | null> {
  const t = (token || "").trim();
  if (!t) return null;
  try {
    const r = await fetchFn("https://api.cloudflare.com/client/v4/accounts", {
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    return parseCloudflareAccounts(await r.json());
  } catch {
    return null;
  }
}
