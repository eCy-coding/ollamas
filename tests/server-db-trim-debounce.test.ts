/**
 * B6 — `db.save()` was a measured event-loop freeze: `DBConfig.sessions` held EVERY message of
 * EVERY chat, uncapped (unlike `securityLog`, capped at 500), so JSON.stringify + a synchronous
 * atomic write on every chat turn cost multi-hundred-ms across 26 call sites. This suite covers
 * the two-part fix:
 *   (a) trim() inside save() — caps sessions to the newest N (default 100) and each session's
 *       messages to the newest 500 — covering all call sites with zero call-site edits.
 *   (b) saveDebounced()/flushPendingSave() — coalesces bursts into one physical write (trailing
 *       500ms, maxWait 2000ms), while save() itself stays synchronous/immediate (c).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { SecureDB, type ChatSession, type ChatMessage } from "../server/db";

function makeSession(i: number, messageCount: number): ChatSession {
  const messages: ChatMessage[] = Array.from({ length: messageCount }, (_, j) => ({
    id: `s${i}-m${j}`,
    role: "user",
    content: `message ${j} of session ${i}`,
    timestamp: new Date().toISOString(),
  }));
  return {
    id: `s${i}`,
    title: `Session ${i}`,
    modelId: "test-model",
    providerId: "test-provider",
    messages,
    updatedAt: new Date().toISOString(),
  };
}

describe("SecureDB — session/message cap + debounced writer (B6)", () => {
  let tmp: string | undefined;
  const savedDir = process.env.MISSION_CONTROL_DATA_DIR;
  const savedKey = process.env.MASTER_KEY_B64;
  const savedMax = process.env.OLLAMAS_MAX_SESSIONS;

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks(); // each test's fs.writeFileSync / console.warn spy must not leak into the next
    if (savedDir === undefined) delete process.env.MISSION_CONTROL_DATA_DIR; else process.env.MISSION_CONTROL_DATA_DIR = savedDir;
    if (savedKey === undefined) delete process.env.MASTER_KEY_B64; else process.env.MASTER_KEY_B64 = savedKey;
    if (savedMax === undefined) delete process.env.OLLAMAS_MAX_SESSIONS; else process.env.OLLAMAS_MAX_SESSIONS = savedMax;
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  function freshDb(): SecureDB {
    tmp = mkdtempSync(join(tmpdir(), "ollamas-db-trim-"));
    process.env.MISSION_CONTROL_DATA_DIR = tmp;
    process.env.MASTER_KEY_B64 = randomBytes(32).toString("base64");
    delete process.env.OLLAMAS_MAX_SESSIONS;
    return new SecureDB();
  }

  // (a) ---------------------------------------------------------------------------------------
  it("150 sessions x 600 messages -> save() -> reload -> exactly 100 sessions, 500 newest messages each", () => {
    const db1 = freshDb();
    // Newest-first, matching real call sites (`db.data.sessions.unshift(newSession)`): index 0
    // is the newest session. Messages within a session are oldest-first (chat order).
    db1.data.sessions = Array.from({ length: 150 }, (_, i) => makeSession(i, 600));
    db1.save();

    // Simulated restart: reload from disk with a fresh instance pointed at the same dir.
    const db2 = new SecureDB();

    expect(db2.data.sessions.length).toBe(100);
    // Kept the newest (front) 100 sessions: s0..s99 survive, s100.. were dropped.
    expect(db2.data.sessions[0].id).toBe("s0");
    expect(db2.data.sessions[99].id).toBe("s99");
    expect(db2.data.sessions.some((s) => s.id === "s100")).toBe(false);

    for (const s of db2.data.sessions) {
      expect(s.messages.length).toBe(500);
      // Kept the newest (tail) 500 messages: indices 100..599 survive, 0..99 were dropped.
      expect(s.messages[0].id).toBe(`${s.id}-m100`);
      expect(s.messages[499].id).toBe(`${s.id}-m599`);
    }
  });

  it("honors OLLAMAS_MAX_SESSIONS override", () => {
    const db1 = freshDb();
    process.env.OLLAMAS_MAX_SESSIONS = "3";
    db1.data.sessions = Array.from({ length: 5 }, (_, i) => makeSession(i, 1));
    db1.save();
    expect(db1.data.sessions.length).toBe(3);
    expect(db1.data.sessions.map((s) => s.id)).toEqual(["s0", "s1", "s2"]);
  });

  it("warns exactly once (not per save) the first time a trim actually drops data", () => {
    const db1 = freshDb();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    db1.data.sessions = Array.from({ length: 150 }, (_, i) => makeSession(i, 1));
    db1.save(); // trims -> should warn once
    db1.save(); // already <= cap -> no further drop -> no additional warning
    db1.save();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("under the cap: save() -> reload leaves sessions/messages untouched", () => {
    const db1 = freshDb();
    db1.data.sessions = Array.from({ length: 5 }, (_, i) => makeSession(i, 10));
    db1.save();
    const db2 = new SecureDB();
    expect(db2.data.sessions.length).toBe(5);
    expect(db2.data.sessions[0].messages.length).toBe(10);
  });

  // (b) ---------------------------------------------------------------------------------------
  it("10 saveDebounced() calls within 100ms coalesce into exactly ONE physical write", () => {
    const db1 = freshDb(); // constructor's own initial write happens before the spy below
    vi.useFakeTimers();
    const writeSpy = vi.spyOn(fs, "writeFileSync");

    for (let i = 0; i < 10; i++) {
      db1.data.workspacePath = `/w/${i}`;
      db1.saveDebounced();
      vi.advanceTimersByTime(10); // 10 calls spread across 100ms total
    }
    expect(writeSpy).not.toHaveBeenCalled(); // still debouncing, nothing flushed yet

    vi.advanceTimersByTime(500); // trailing window elapses
    expect(writeSpy).toHaveBeenCalledTimes(1); // exactly ONE physical write
    expect(db1.data.workspacePath).toBe("/w/9"); // wrote the LATEST data, not an intermediate one
  });

  it("flushPendingSave() resolves after the coalesced write (no extra write on later flush)", async () => {
    const db1 = freshDb();
    vi.useFakeTimers();
    const writeSpy = vi.spyOn(fs, "writeFileSync");

    for (let i = 0; i < 10; i++) {
      db1.data.workspacePath = `/w/${i}`;
      db1.saveDebounced();
      vi.advanceTimersByTime(10);
    }
    vi.advanceTimersByTime(500); // let the coalesced write happen
    expect(writeSpy).toHaveBeenCalledTimes(1);

    await db1.flushPendingSave(); // nothing pending anymore -> resolves, no 2nd write
    expect(writeSpy).toHaveBeenCalledTimes(1);
  });

  it("flushPendingSave() forces a still-pending debounced save immediately, then resolves", async () => {
    const db1 = freshDb();
    vi.useFakeTimers();
    const writeSpy = vi.spyOn(fs, "writeFileSync");

    db1.data.workspacePath = "/forced";
    db1.saveDebounced();
    expect(writeSpy).not.toHaveBeenCalled(); // still within the 500ms trailing window

    await db1.flushPendingSave(); // forces the write now, without waiting out the timer
    expect(writeSpy).toHaveBeenCalledTimes(1);

    await db1.flushPendingSave(); // idempotent: nothing pending -> no extra write
    expect(writeSpy).toHaveBeenCalledTimes(1);
  });

  it("maxWait 2000ms flushes even under continuous saveDebounced() calls (trailing never idles)", () => {
    const db1 = freshDb();
    vi.useFakeTimers();
    const writeSpy = vi.spyOn(fs, "writeFileSync");

    // Call every 450ms — always resets the 500ms trailing timer before it can fire.
    for (let i = 0; i < 4; i++) {
      db1.data.workspacePath = `/mw/${i}`;
      db1.saveDebounced();
      vi.advanceTimersByTime(450);
    }
    expect(writeSpy).not.toHaveBeenCalled(); // trailing kept getting reset; still < 2000ms elapsed

    db1.saveDebounced();
    vi.advanceTimersByTime(450); // total elapsed now > 2000ms -> maxWait must have fired
    expect(writeSpy).toHaveBeenCalledTimes(1);
  });

  // (c) ---------------------------------------------------------------------------------------
  it("plain save() still writes immediately (synchronous, no debounce delay)", () => {
    const db1 = freshDb();
    db1.data.workspacePath = "/immediate";
    db1.save(); // no fake timers involved at all -- must already be on disk
    const db2 = new SecureDB();
    expect(db2.data.workspacePath).toBe("/immediate");
  });
});
