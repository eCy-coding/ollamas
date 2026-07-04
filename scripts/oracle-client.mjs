// scripts/oracle-client.mjs — kalıcı oracle daemon'una küçük NDJSON istemcisi.
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const SOCK = process.env.ORACLE_SOCK || join(tmpdir(), "ollamas-oracle.sock");

/** Tek bir JSON istek gönder, tek JSON yanıt al (yeni bağlantı, satır-sınırlı). */
export function oracleCall(req, sock = SOCK, timeoutMs = 40000) {
  return new Promise((resolve, reject) => {
    const c = createConnection(sock);
    let buf = "";
    const to = setTimeout(() => { c.destroy(); reject(new Error("oracle daemon timeout")); }, timeoutMs);
    c.on("connect", () => c.write(JSON.stringify(req) + "\n"));
    c.on("data", (d) => {
      buf += d.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl >= 0) { clearTimeout(to); try { resolve(JSON.parse(buf.slice(0, nl))); } catch (e) { reject(e); } c.end(); }
    });
    c.on("error", (e) => { clearTimeout(to); reject(e); });
  });
}
