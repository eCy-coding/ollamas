// Integrations health matrix (dalga-11). On-demand self-diagnosis: probes each
// integration and reports status + a one-step fix + its purpose. Reuses existing
// probes (checkAvailable, getFeedItems, searchGitHub) — no new heavy code.
import { checkAvailable } from "./mcp/catalog";
import { getFeedItems, type FetchLike } from "./threatfeed";

export type Status = "ok" | "needs-setup" | "degraded";
export interface IntegrationStatus {
  id: string; title: string; status: Status; detail: string; fix?: string; purpose: string; lane: string;
}

export async function checkIntegrations(opts: {
  token: string;
  isAvailable?: (cmd: string) => boolean;
  feedFetch?: FetchLike;
}): Promise<IntegrationStatus[]> {
  const isAvailable = opts.isAvailable ?? checkAvailable;
  const out: IntegrationStatus[] = [];

  // 1. GitHub — the token gates Actions writes, code search, job logs, dispatch.
  out.push(opts.token
    ? { id: "github", title: "GitHub", status: "ok", detail: "Token bağlı — Actions/arama/log/dispatch aktif.", purpose: "CI görünürlüğü + kod/depo araması + audit-teslimatı.", lane: "revenue/ops" }
    : { id: "github", title: "GitHub", status: "needs-setup", detail: "Vault'ta GitHub token yok.", fix: "‘GitHub'ı otomatik bağla (gh CLI)’ butonu, veya PAT yapıştır.", purpose: "CI görünürlüğü + kod/depo araması + audit-teslimatı.", lane: "revenue/ops" });

  // 2/3. MCP runtimes — npx (node) + uvx (Python) drive the one-click catalog.
  const npx = isAvailable("npx");
  out.push({ id: "mcp-npx", title: "MCP (npx)", status: npx ? "ok" : "needs-setup", detail: npx ? "npx mevcut — memory/filesystem/everything/sequential-thinking/playwright eklenebilir." : "npx bulunamadı.", fix: npx ? undefined : "Node.js kur.", purpose: "Küratörlü MCP server'larını gateway'e tek-tık ekleme.", lane: "integrations/MCP" });
  const uvx = isAvailable("uvx");
  out.push({ id: "mcp-uvx", title: "MCP (uvx)", status: uvx ? "ok" : "needs-setup", detail: uvx ? "uvx mevcut — git/fetch/time eklenebilir." : "uvx yok (git/fetch/time için gerekli; npx server'lar çalışır).", fix: uvx ? undefined : "brew install uv", purpose: "Python-tabanlı MCP server'ları (git/fetch/time).", lane: "integrations/MCP" });

  // 4. Threat feed — anon RSS/KEV; healthy if any source returns items.
  try {
    const feed = await getFeedItems({ fetchImpl: opts.feedFetch });
    const live = feed.sources.filter((s) => !s.error && s.items > 0).length;
    out.push({ id: "threat-feed", title: "Tehdit Akışı", status: live > 0 ? "ok" : "degraded", detail: `${live}/${feed.sources.length} kaynak canlı.`, purpose: "Tehdit-İstihbaratı sekmesine bağımsız CVE/güvenlik beslemesi.", lane: "security" });
  } catch { out.push({ id: "threat-feed", title: "Tehdit Akışı", status: "degraded", detail: "besleme alınamadı.", purpose: "Tehdit-İstihbaratı beslemesi.", lane: "security" }); }

  // 5. GitHub Search — anon works but rate-limited + no code search; token lifts it.
  out.push(opts.token
    ? { id: "github-search", title: "GitHub Arama/Standart", status: "ok", detail: "Authed — 30/dk, kod araması + Standart Tarama aktif.", purpose: "Kendini-geliştiren keşif (adopt-fit görev listesi).", lane: "discovery" }
    : { id: "github-search", title: "GitHub Arama/Standart", status: "degraded", detail: "Anon — 10/dk, kod araması kapalı.", fix: "GitHub token bağla (yukarı).", purpose: "Kendini-geliştiren keşif (adopt-fit görev listesi).", lane: "discovery" });

  return out;
}
