// F3c vektör yüzeyleri — /api/brain/embed + /api/brain/recall'ın `vector` alanı.
// Kişiselleştirme (q* = q + λ·p_u) ancak retrieval VEKTÖRLE sürülebilirse gerçek olur;
// bu testler o yüzeyin GİRDİ SÖZLEŞMESİNİ kilitler. Bozuk vektör 500 değil 400 dönmeli —
// aksi halde çağıran "sunucu bozuldu" sanır, oysa gönderdiği veri hatalıdır.
//
// Gömme mutlu-yolu (gerçek 768-boyutlu vektör) canlı embedder ister; o yüzden burada
// YOK — burada yalnız embedder'sız deterministik olan doğrulama yolları var.
// routes-hardening.test.ts deseni: gerçek app, in-process, port :0, autoboot kapalı.
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { Server } from "node:http";

let server: Server;
let base = "";

beforeAll(async () => {
  process.env.OLLAMAS_NO_AUTOBOOT = "1";
  const { app } = await import("../server");
  server = http.createServer(app as unknown as http.RequestListener);
  await new Promise<void>((r) => server.listen(0, () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 60_000);

afterAll(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
});

const post = async (path: string, body: unknown) => {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

describe("POST /api/brain/embed (F3c)", () => {
  test("metin yoksa 400", async () => {
    expect((await post("/api/brain/embed", {})).status).toBe(400);
    expect((await post("/api/brain/embed", { text: "   " })).status).toBe(400);
    expect((await post("/api/brain/embed", { text: 42 })).status).toBe(400);
  });
});

describe("POST /api/brain/recall — vector alanı (F3c)", () => {
  test("bozuk vektör 400 döner (500 DEĞİL — girdi hatası sunucu hatası değildir)", async () => {
    for (const bad of ["dizi-degil", [], [1, "x"], [1, null], [NaN], {}]) {
      const r = await post("/api/brain/recall", { query: "kod", vector: bad });
      expect(r.status, `vector=${JSON.stringify(bad)} 400 olmalı`).toBe(400);
      expect(String(r.body?.error ?? "")).toMatch(/vector/i);
    }
  });

  test("query hâlâ zorunlu — vector onun yerine geçmez", async () => {
    // Vektör verilse bile leksik/FTS kolu ham metinle sürülür, o yüzden query şart.
    expect((await post("/api/brain/recall", { vector: [1, 0, 0] })).status).toBe(400);
  });

  test("vector verilmeyince mevcut davranış değişmez (geriye dönük uyum)", async () => {
    // Embedder yoksa bile bu yol 400 DÖNMEMELİ — 200/503 kabul (degrade sözleşmesi).
    const r = await post("/api/brain/recall", { query: "kod", k: 1 });
    expect(r.status).not.toBe(400);
  });
});
