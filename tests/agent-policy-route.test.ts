// /api/agent/policy — panel yüzeyi. Yetki değişikliği DENETLENEBİLİR ve
// geçersiz istek mevcut politikayı BOZAMAZ olmalı.
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let server: Server;
let base = "";
let dir = "";
const prev = process.env.BRAIN_LOOP_DIR;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "polroute-"));
  process.env.BRAIN_LOOP_DIR = dir;
  process.env.OLLAMAS_NO_AUTOBOOT = "1";
  const { app } = await import("../server");
  server = http.createServer(app as unknown as http.RequestListener);
  await new Promise<void>((r) => server.listen(0, () => r()));
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
}, 60_000);

afterAll(async () => {
  if (prev === undefined) delete process.env.BRAIN_LOOP_DIR; else process.env.BRAIN_LOOP_DIR = prev;
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* geçici */ }
});

const post = async (body: unknown) => {
  const r = await fetch(`${base}/api/agent/policy`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const get = async () => (await fetch(`${base}/api/agent/policy`)).json();

describe("GET /api/agent/policy", () => {
  test("politika + şema döner (panel seçenekleri sunucudan)", async () => {
    const r: any = await get();
    expect(r.riskClasses).toHaveLength(6);
    expect(r.autonomyLevels).toEqual(["deny", "gated", "auto"]);
    // Varsayılanda hiçbir sınıf auto olmamalı — panel açılınca kapalı görünsün.
    for (const c of r.riskClasses) expect(r.policy.classes[c], c).not.toBe("auto");
  });
});

describe("POST /api/agent/policy", () => {
  test("kısmi güncelleme uygulanır, dokunulmayan alan KORUNUR", async () => {
    const r = await post({ classes: { read: "auto" } });
    expect(r.status).toBe(200);
    expect((r.body as any).policy.classes.read).toBe("auto");
    expect((r.body as any).policy.classes["communicate-outward"]).toBe("deny");
  });

  test("GEÇERSİZ değer yok sayılır, politika BOZULMAZ", async () => {
    await post({ classes: { "system-change": "deny" } });
    const r = await post({ classes: { "system-change": "SÜPER-YETKİ" } });
    expect(r.status).toBe(200);
    expect((r.body as any).policy.classes["system-change"]).toBe("deny"); // korundu
  });

  test("boş gövde çökmez", async () => {
    expect((await post({})).status).toBe(200);
  });

  test("ilkeler kaydedilir (Emre'nin etik işaretlemesi)", async () => {
    const r = await post({ principles: ["ucuncu kisilere asla toplu mesaj atma"] });
    expect((r.body as any).policy.principles).toContain("ucuncu kisilere asla toplu mesaj atma");
  });
});
