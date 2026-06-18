import { describe, test, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DB = path.join(os.tmpdir(), `ollamas-whk-${process.pid}.db`);
let store: typeof import("../server/store/index");
let outbound: typeof import("../server/webhooks/outbound");

// Local receiver capturing webhook POSTs.
let received: { body: string; sig: string }[] = [];
let receiver: http.Server;
let receiverUrl = "";

beforeAll(async () => {
  process.env.SAAS_DB_PATH = DB;
  store = await import("../server/store/index");
  outbound = await import("../server/webhooks/outbound");
  await store.initStore();
  await new Promise<void>((resolve) => {
    receiver = http.createServer((req, res) => {
      let b = ""; req.on("data", (c) => (b += c));
      req.on("end", () => { received.push({ body: b, sig: String(req.headers["x-ollamas-signature"] || "") }); res.writeHead(200).end("ok"); });
    });
    receiver.listen(0, "127.0.0.1", () => { receiverUrl = `http://127.0.0.1:${(receiver.address() as any).port}`; resolve(); });
  });
});
afterAll(() => {
  receiver?.close();
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) try { fs.unlinkSync(f); } catch {}
});

describe("webhook signing (Faz 11B)", () => {
  test("sign → verify roundtrip; tamper + wrong secret fail", () => {
    const body = JSON.stringify({ type: "key.created" });
    const header = outbound.signWebhook("whsec_x", body);
    expect(outbound.verifyWebhook("whsec_x", body, header)).toBe(true);
    expect(outbound.verifyWebhook("whsec_x", body + "x", header)).toBe(false);
    expect(outbound.verifyWebhook("whsec_other", body, header)).toBe(false);
  });
});

describe("webhook delivery pipeline (Faz 11B/12C)", () => {
  test("queue → deliver → receiver gets a valid signed POST", async () => {
    const t = await store.createTenant("whkco", "pro");
    const { secret } = await store.addWebhook(t.id, receiverUrl, ["key.created"]);
    const n = await store.queueWebhookEvent(t.id, "key.created", { keyId: "key_x" });
    expect(n).toBe(1);

    await outbound.processDeliveries();

    const hit = received.find((r) => r.body.includes("key_x"));
    expect(hit).toBeTruthy();
    expect(outbound.verifyWebhook(secret, hit!.body, hit!.sig)).toBe(true);
  });

  test("event only fans out to webhooks subscribed to that type", async () => {
    const t = await store.createTenant("whkco2", "pro");
    await store.addWebhook(t.id, receiverUrl, ["subscription.updated"]); // not key.created
    expect(await store.queueWebhookEvent(t.id, "key.created", {})).toBe(0);
  });

  // Faz 12C: two parallel workers must not double-deliver the same event.
  test("parallel processDeliveries does not double-send", async () => {
    received.length = 0;
    const t = await store.createTenant("whkpar", "pro");
    await store.addWebhook(t.id, receiverUrl, ["key.created"]);
    for (let i = 0; i < 3; i++) await store.queueWebhookEvent(t.id, "key.created", { keyId: `kp_${i}` });
    await Promise.all([outbound.processDeliveries(), outbound.processDeliveries()]);
    const mine = received.filter((r) => r.body.includes("kp_"));
    const ids = new Set(mine.map((r) => JSON.parse(r.body).data.keyId));
    expect(ids.size).toBe(3); // each delivered exactly once
    expect(mine.length).toBe(3);
  });
});
