// Outbound alerts to Slack / Discord incoming webhooks. Unlike the tenant webhook
// queue (server/webhooks/outbound.ts), these are simple plain-JSON posters with NO
// HMAC — Slack/Discord incoming webhooks expect {text}/{content} and reject signed
// bodies. Best-effort + fire-and-forget: a missing URL or a failed POST never throws,
// so alerting can never break the path that emits the event.

export interface NotifyConfig {
  slackWebhookUrl?: string;
  discordWebhookUrl?: string;
}

/** Build the Slack payload. Pure → unit-testable without a network call. */
export function slackPayload(text: string): { text: string } {
  return { text };
}

/** Build the Discord payload. Pure → unit-testable. */
export function discordPayload(text: string): { content: string } {
  return { content: text };
}

async function post(url: string, body: unknown): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false; // network/timeout — alerting must never throw into the caller
  }
}

/**
 * Send `text` to whichever sinks are configured. Returns the sinks that accepted it.
 * No-op (returns []) when nothing is configured — so call sites stay unconditional.
 */
export async function notify(text: string, cfg: NotifyConfig | undefined): Promise<string[]> {
  if (!cfg) return [];
  const sent: string[] = [];
  if (cfg.slackWebhookUrl && (await post(cfg.slackWebhookUrl, slackPayload(text)))) sent.push("slack");
  if (cfg.discordWebhookUrl && (await post(cfg.discordWebhookUrl, discordPayload(text)))) sent.push("discord");
  return sent;
}
