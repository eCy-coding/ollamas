#!/usr/bin/env tsx
/**
 * orchestration/bin/oracle-serve.ts — kalıcı Doğruluk Oracle daemon'u.
 *
 * Uzun-ömürlü süreç; Unix domain socket üzerinde NDJSON (satır başına bir JSON istek → bir JSON yanıt).
 * Yüklü modülü + memo cache'i SICAK tutar → her çağrıda tsx+modül cold-start (~1-2s) ORTADAN KALKAR.
 *
 * İstek biçimleri (her biri tek satır):
 *   <OracleInput>                       → tek verdict
 *   {"batch":[<OracleInput>, ...]}       → {"results":[...]}  (paralel)
 *   {"cmd":"ping"}                       → {"ok":true,"memo":N}
 *   {"cmd":"clear"}                      → {"ok":true}        (memo temizle — bench için)
 *
 * Çalıştır:  tsx orchestration/bin/oracle-serve.ts        (ORACLE_SOCK ile yol özelleştirilebilir)
 */
import { createServer } from "node:net";
import { unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleOracleLine } from "./lib/oracle-lib";

const SOCK = process.env.ORACLE_SOCK || join(tmpdir(), "ollamas-oracle.sock");
if (existsSync(SOCK)) { try { unlinkSync(SOCK); } catch { /* yoksay */ } }

const server = createServer((sock) => {
  let buf = "";
  sock.on("data", async (chunk) => {
    buf += chunk.toString("utf8");
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const resp = await handleOracleLine(line);
      sock.write(JSON.stringify(resp) + "\n");
    }
  });
  sock.on("error", () => { /* istemci koptu */ });
});

server.listen(SOCK, () => { console.log(`[oracle-serve] dinliyor: ${SOCK}`); });
const bye = () => { try { unlinkSync(SOCK); } catch { /* yoksay */ } process.exit(0); };
process.on("SIGINT", bye);
process.on("SIGTERM", bye);
