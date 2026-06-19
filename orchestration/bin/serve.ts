#!/usr/bin/env tsx
/**
 * serve.ts — vO3 canlı cockpit sunucusu. ZERO-DEP (node:http). READ-ONLY conductor UI.
 *
 * Rotalar:
 *   GET /              → cockpit.html (tek dosya, iOS-friendly)
 *   GET /cockpit.json  → collect() snapshot (anlık)
 *   GET /events        → SSE stream (ORCH_POLL_SEC'de bir collect, default 5)
 *
 * Bağlama: default 127.0.0.1 (yalnız Mac). `--lan` → 0.0.0.0 (iOS Safari LAN erişimi, opt-in).
 * Scope Law: orchestration/** dışına HİÇBİR yazım yok; tüm veri lane'lerden READ.
 *
 * Çalıştır:  ~/Desktop/ollamas/node_modules/.bin/tsx orchestration/bin/serve.ts [--lan]
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { collect, type CockpitSnapshot } from "./lib/collect";

export type Collector = () => Promise<CockpitSnapshot>;

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = join(HERE, "..", "assets", "cockpit.html");

const FALLBACK_HTML =
  "<!doctype html><meta charset=utf-8><title>ollamas cockpit</title>" +
  "<body style='font:14px system-ui;background:#050608;color:#e8e8ea;padding:2rem'>" +
  "<h1>ollamas cockpit</h1><p>cockpit.html bulunamadı — <code>/cockpit.json</code> canlı.</p>" +
  "<script>setInterval(async()=>{const r=await fetch('/cockpit.json');document.querySelector('pre').textContent=await r.text()},2000)</script>" +
  "<pre style='white-space:pre-wrap'></pre></body>";

/** Saf, test edilebilir istek yönlendirici. collectFn + htmlPath inject edilir. */
export function makeHandler(collectFn: Collector, htmlPath: string, pollMs = 5000) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = (req.url || "/").split("?")[0];

    if (url === "/cockpit.json") {
      try {
        const snap = await collectFn();
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify(snap));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
      return;
    }

    if (url === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      });
      const push = async () => {
        try {
          const snap = await collectFn();
          res.write(`data: ${JSON.stringify(snap)}\n\n`);
        } catch { /* tek tur hata → sonraki tur dener */ }
      };
      await push(); // ilk frame hemen
      const timer = setInterval(push, pollMs);
      req.on("close", () => clearInterval(timer));
      return;
    }

    if (url === "/" || url === "/index.html") {
      let html: string;
      try { html = readFileSync(htmlPath, "utf8"); } catch { html = FALLBACK_HTML; }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  };
}

export interface ServeOpts { port?: number; lan?: boolean; pollMs?: number; }

/** Sunucuyu başlat (canlı). collect canlı sarmalayıcıyı kullanır. */
export function startServer(opts: ServeOpts = {}) {
  const port = opts.port ?? Number(process.env.ORCH_COCKPIT_PORT || 7777);
  const host = opts.lan ? "0.0.0.0" : "127.0.0.1";
  const pollMs = opts.pollMs ?? Number(process.env.ORCH_POLL_SEC || 5) * 1000;
  const server = createServer(makeHandler(collect, HTML_PATH, pollMs));
  server.listen(port, host, () => {
    console.error(`[serve] cockpit → http://${host}:${port}  (poll ${pollMs}ms, ${opts.lan ? "LAN/iOS açık" : "yalnız localhost"})`);
    if (opts.lan) console.error("[serve] ⚠️  --lan: LAN'daki herkes erişir. Güvenli ağda kullan (vO12 auth gelecek).");
  });
  return server;
}

// CLI girişi (import edildiğinde çalışmaz → test güvenli).
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer({ lan: process.argv.includes("--lan") });
}
