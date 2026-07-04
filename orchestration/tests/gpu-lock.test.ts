import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  takeTicket, isServed, advance, shouldForceAdvance,
  pullTicket, tryTurn, renewTurn, releaseTurn,
  type TicketState,
} from "../bin/lib/gpu-lock";

const S = (over: Partial<TicketState> = {}): TicketState =>
  ({ next: 0, serving: 0, holder: null, heldSince: null, ...over });

// ---------- pure core ----------

describe("takeTicket — monotonic dispenser", () => {
  it("ilk ticket = next, state.next bir artar", () => {
    const { state, ticket } = takeTicket(S());
    expect(ticket).toBe(0);
    expect(state.next).toBe(1);
  });
  it("ardışık çekişler strictly artan ticket verir (FIFO sırası)", () => {
    let s = S();
    const tickets: number[] = [];
    for (let i = 0; i < 5; i++) { const r = takeTicket(s); s = r.state; tickets.push(r.ticket); }
    expect(tickets).toEqual([0, 1, 2, 3, 4]);
    expect(s.next).toBe(5);
  });
  it("girdi state'i mutate etmez", () => {
    const orig = S({ next: 3, serving: 1 });
    takeTicket(orig);
    expect(orig.next).toBe(3);
  });
  it("serving/holder alanlarına dokunmaz", () => {
    const { state } = takeTicket(S({ serving: 2, holder: "a", heldSince: 7 }));
    expect(state.serving).toBe(2);
    expect(state.holder).toBe("a");
    expect(state.heldSince).toBe(7);
  });
});

describe("isServed — strict FIFO", () => {
  it("yalnız serving === ticket iken true", () => {
    expect(isServed(S({ serving: 2 }), 2)).toBe(true);
    expect(isServed(S({ serving: 2 }), 1)).toBe(false); // geçmiş ticket
    expect(isServed(S({ serving: 2 }), 3)).toBe(false); // sıradaki bekler
  });
});

describe("advance — release", () => {
  it("serving++ ve holder/heldSince temizlenir", () => {
    const s = advance(S({ serving: 1, holder: "w1", heldSince: 100 }));
    expect(s.serving).toBe(2);
    expect(s.holder).toBeNull();
    expect(s.heldSince).toBeNull();
  });
  it("next'e dokunmaz, girdiyi mutate etmez", () => {
    const orig = S({ next: 9, serving: 1, holder: "w1", heldSince: 1 });
    const s = advance(orig);
    expect(s.next).toBe(9);
    expect(orig.serving).toBe(1);
    expect(orig.holder).toBe("w1");
  });
});

describe("shouldForceAdvance — dead-holder liveness", () => {
  it("holder yok → false (kimse tutmuyor, atlanacak şey yok)", () => {
    expect(shouldForceAdvance(S(), 10_000, 100)).toBe(false);
  });
  it("heldSince null → false", () => {
    expect(shouldForceAdvance(S({ holder: "w1", heldSince: null }), 10_000, 100)).toBe(false);
  });
  it("heartbeat taze (now - heldSince <= ttl) → false; sınır tam ttl'de skip yok (strict >)", () => {
    expect(shouldForceAdvance(S({ holder: "w1", heldSince: 900 }), 1000, 100)).toBe(false);
    expect(shouldForceAdvance(S({ holder: "w1", heldSince: 950 }), 1000, 100)).toBe(false);
  });
  it("heartbeat bayat (now - heldSince > ttl) → true", () => {
    expect(shouldForceAdvance(S({ holder: "w1", heldSince: 899 }), 1000, 100)).toBe(true);
  });
  it("unclaimed pozisyon (holder null) + idle-stamp bayat → true (pullTicket-sonrası-crash liveness)", () => {
    expect(shouldForceAdvance(S({ holder: null, heldSince: 899 }), 1000, 100)).toBe(true);
    expect(shouldForceAdvance(S({ holder: null, heldSince: 950 }), 1000, 100)).toBe(false);
  });
});

describe("FIFO + starvation-free property (pure zincir)", () => {
  it("N waiter arrival sırasıyla servis edilir; kimse atlanmaz", () => {
    let s = S();
    const arrival: number[] = [];
    for (let i = 0; i < 4; i++) { const r = takeTicket(s); s = r.state; arrival.push(r.ticket); }
    const served: number[] = [];
    while (served.length < arrival.length) {
      const t = arrival.find((x) => isServed(s, x))!;
      served.push(t);
      s = advance(s);
    }
    expect(served).toEqual(arrival); // strict FIFO — geç gelen erken geleni asla geçemez
  });
});

// ---------- IO layer (gerçek temp dir, mock yok) ----------

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "gpu-lock-test-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const persisted = (): TicketState => JSON.parse(readFileSync(join(dir, "gpu-lock.json"), "utf8"));

describe("pullTicket — atomik FIFO ticket", () => {
  it("boş dizinde 0'dan başlar, ardışık çağrılar 0,1,2", () => {
    expect(pullTicket(dir)).toBe(0);
    expect(pullTicket(dir)).toBe(1);
    expect(pullTicket(dir)).toBe(2);
  });
  it("state diske persist edilir (cross-process görünürlük)", () => {
    pullTicket(dir);
    pullTicket(dir);
    const s = persisted();
    expect(s.next).toBe(2);
    expect(s.serving).toBe(0);
  });
  it("bozuk state dosyası → DEFAULT'a döner (crash yok)", () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "gpu-lock.json"), "{corrupt!!");
    expect(pullTicket(dir)).toBe(0);
  });
});

describe("tryTurn — sıra kapma", () => {
  it("serving === ticket → true, holder + heldSince yazılır", () => {
    const t = pullTicket(dir);
    expect(tryTurn(dir, t, "w1", 1000, 5000)).toBe(true);
    const s = persisted();
    expect(s.holder).toBe("w1");
    expect(s.heldSince).toBe(1000);
  });
  it("sıra bende değilken false; erken gelen serbest bırakınca sıradaki alır", () => {
    const t0 = pullTicket(dir);
    const t1 = pullTicket(dir);
    expect(tryTurn(dir, t1, "w2", 1000, 5000)).toBe(false); // FIFO: t1, t0'ı geçemez
    expect(tryTurn(dir, t0, "w1", 1000, 5000)).toBe(true);
    expect(tryTurn(dir, t1, "w2", 1001, 5000)).toBe(false); // hâlâ w1 tutuyor
    releaseTurn(dir, t0);
    expect(tryTurn(dir, t1, "w2", 1002, 5000)).toBe(true);
  });
  it("pullTicket sonrası ilk tryTurn'den önce ölen sahip kuyruğu KALICI bloklamaz (idle force-advance)", () => {
    pullTicket(dir); // t0 sahibi hemen crash — hiç tryTurn çağırmayacak
    const t1 = pullTicket(dir);
    expect(tryTurn(dir, t1, "w2", 1000, 5000)).toBe(false); // idle timer damgalanır
    expect(persisted().heldSince).toBe(1000);
    expect(tryTurn(dir, t1, "w2", 6001, 5000)).toBe(false); // bayat idle → force-advance (serving 0→1)
    expect(tryTurn(dir, t1, "w2", 6002, 5000)).toBe(true);  // kuyruk aktı, sıra t1'de
    expect(persisted().holder).toBe("w2");
  });
  it("ölü holder (heartbeat > ttl) force-advance edilir; kuyruk kilitli kalmaz", () => {
    const t0 = pullTicket(dir);
    const t1 = pullTicket(dir);
    expect(tryTurn(dir, t0, "dead", 1000, 5000)).toBe(true);
    // dead asla release/renew etmedi; t1 ttl sonrası dener
    expect(tryTurn(dir, t1, "w2", 7000, 5000)).toBe(false); // bu çağrı force-advance turu
    expect(tryTurn(dir, t1, "w2", 7001, 5000)).toBe(true);  // sonraki poll'da sıra t1'de
  });
  it("canlı holder (heartbeat taze) force-advance EDİLMEZ", () => {
    const t0 = pullTicket(dir);
    const t1 = pullTicket(dir);
    tryTurn(dir, t0, "w1", 1000, 5000);
    expect(tryTurn(dir, t1, "w2", 3000, 5000)).toBe(false);
    const s = persisted();
    expect(s.serving).toBe(0); // atlanmadı
    expect(s.holder).toBe("w1");
  });
  it("holder kendi ticket'ında expired görünse bile skip edilmez, yeniden claim eder", () => {
    const t0 = pullTicket(dir);
    tryTurn(dir, t0, "w1", 1000, 5000);
    // w1 renew etmedi ama hayatta; kendi tryTurn'ünde serving===ticket → force-advance guard devre dışı
    expect(tryTurn(dir, t0, "w1", 99_000, 5000)).toBe(true);
    const s = persisted();
    expect(s.serving).toBe(0);
    expect(s.heldSince).toBe(99_000);
  });
});

describe("renewTurn — heartbeat", () => {
  it("holder'ın heldSince'i tazelenir → force-advance engellenir", () => {
    const t0 = pullTicket(dir);
    const t1 = pullTicket(dir);
    tryTurn(dir, t0, "w1", 1000, 5000);
    renewTurn(dir, t0, 6000); // uzun-ama-canlı iş
    expect(tryTurn(dir, t1, "w2", 10_000, 5000)).toBe(false); // 10000-6000 <= 5000 → skip yok
    const s = persisted();
    expect(s.serving).toBe(0);
    expect(s.heldSince).toBe(6000);
  });
  it("serving !== ticket iken no-op (bayat waiter state'i bozamaz)", () => {
    const t0 = pullTicket(dir);
    const t1 = pullTicket(dir);
    tryTurn(dir, t0, "w1", 1000, 5000);
    renewTurn(dir, t1, 9999); // sıra t1'de değil
    expect(persisted().heldSince).toBe(1000);
  });
});

describe("releaseTurn — idempotent release", () => {
  it("serving++ ve holder temizlenir", () => {
    const t0 = pullTicket(dir);
    tryTurn(dir, t0, "w1", 1000, 5000);
    releaseTurn(dir, t0);
    const s = persisted();
    expect(s.serving).toBe(1);
    expect(s.holder).toBeNull();
    expect(s.heldSince).toBeNull();
  });
  it("çift release güvenli: ikinci çağrı no-op (serving bir daha artmaz)", () => {
    const t0 = pullTicket(dir);
    tryTurn(dir, t0, "w1", 1000, 5000);
    releaseTurn(dir, t0);
    releaseTurn(dir, t0); // idempotent
    expect(persisted().serving).toBe(1);
  });
  it("sırası olmayan ticket release edemez (başkasının turn'ünü çalamaz)", () => {
    const t0 = pullTicket(dir);
    const t1 = pullTicket(dir);
    tryTurn(dir, t0, "w1", 1000, 5000);
    releaseTurn(dir, t1);
    const s = persisted();
    expect(s.serving).toBe(0);
    expect(s.holder).toBe("w1");
  });
});

describe("e2e FIFO senaryosu — 3 waiter tam yaşam döngüsü", () => {
  it("arrival sırasıyla servis: w0 → w1(crash, force-advance) → w2", () => {
    const t0 = pullTicket(dir);
    const t1 = pullTicket(dir);
    const t2 = pullTicket(dir);
    // w0 normal döngü
    expect(tryTurn(dir, t0, "w0", 100, 1000)).toBe(true);
    releaseTurn(dir, t0);
    // w1 alır ama crash (release yok)
    expect(tryTurn(dir, t1, "w1", 200, 1000)).toBe(true);
    // w2 poll'lar: önce false (w1 ttl içinde), ttl aşınca skip turu, sonra alır
    expect(tryTurn(dir, t2, "w2", 300, 1000)).toBe(false);
    expect(tryTurn(dir, t2, "w2", 1500, 1000)).toBe(false); // force-advance turu
    expect(tryTurn(dir, t2, "w2", 1501, 1000)).toBe(true);
    releaseTurn(dir, t2);
    expect(persisted()).toMatchObject({ next: 3, serving: 3, holder: null, heldSince: null });
  });
});
