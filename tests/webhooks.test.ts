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
  store.initStore();
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

describe("webhook delivery pipeline (Faz 11B)", () => {
  test("queue → deliver → receiver gets a valid signed POST", async () => {
    const t = store.createTenant("whkco", "pro");
    const { secret } = store.addWebhook(t.id, receiverUrl, ["key.created"]);
    const n = store.queueWebhookEvent(t.id, "key.created", { keyId: "key_x" });
    expect(n).toBe(1);
    expect(store.pendingDeliveries().some((d) => d.tenant_id === t.id)).toBe(true);

    await outbound.processDeliveries();

    const hit = received.find((r) => r.body.includes("key_x"));
    expect(hit).toBeTruthy();
    expect(outbound.verifyWebhook(secret, hit!.body, hit!.sig)).toBe(true);
    expect(store.pendingDeliveries().some((d) => d.tenant_id === t.id)).toBe(false); // delivered
  });

  test("event only fans out to webhooks subscribed to that type", () => {
    const t = store.createTenant("whkco2", "pro");
    store.addWebhook(t.id, receiverUrl, ["subscription.updated"]); // not key.created
    expect(store.queueWebhookEvent(t.id, "key.created", {})).toBe(0);
  });
});
