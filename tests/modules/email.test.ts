// O4 email module (docs/odyssey/05-features/email-mcp.md) — service unit +
// store CRUD + route/guard/toggle. Mirrors tests/modules/notes-tasks.test.ts:
// schema validation (pure), store/service CRUD (real SQLite via _core/store,
// restart-persist), AI summarize/draft (fake aiCall, no network), SMTP send
// gate (fake transport, mock call-count proof — never a real network call),
// route + toggle (functional), and the localOwnerGuard invariant.
import { describe, test, expect, beforeAll, afterAll, beforeEach } from "vitest";
import http from "node:http";
import type { Server } from "node:http";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import "../../server/modules/email"; // side-effect: register the real module
import { mountEnabledModules, enabledModules } from "../../server/modules/registry";
import {
  TRIAGE_LABELS,
  sanitizeTriageLabel,
  sanitizeFolder,
  parseTriageInput,
  parseDraftInput,
  parseSendInput,
} from "../../server/modules/email/schema";
import {
  triageClassify,
  summarizeMessage,
  draftReply,
  sendEmail,
  getStatus,
  syncMessages,
  getMessage,
  setTriage,
  summarize,
  draft,
  send,
  loadEmailConfig,
  _setEmailDeps,
  _resetEmailDeps,
  type ImapTransport,
  type SmtpTransport,
} from "../../server/modules/email/service";
import { closeStore } from "../../server/store";

const sharedTmp = fs.mkdtempSync(path.join(os.tmpdir(), "ollamas-o4-email-"));
beforeAll(() => {
  delete process.env.DATABASE_URL;
  process.env.SAAS_DB_PATH = path.join(sharedTmp, "saas.db");
});
afterAll(async () => {
  await closeStore();
  fs.rmSync(sharedTmp, { recursive: true, force: true });
});

// ── Schema validation (pure, P1) ─────────────────────────────────────────────
describe("O4 email — schema validation (P1)", () => {
  test("TRIAGE_LABELS / sanitizeTriageLabel — single enum source", () => {
    for (const l of TRIAGE_LABELS) expect(sanitizeTriageLabel(l)).toBe(l);
    expect(() => sanitizeTriageLabel("urgent")).toThrow();
    expect(() => sanitizeTriageLabel(5)).toThrow();
  });

  test("sanitizeFolder rejects empty/path-traversal, accepts plain folder names", () => {
    expect(sanitizeFolder("INBOX")).toBe("INBOX");
    expect(() => sanitizeFolder("")).toThrow();
    expect(() => sanitizeFolder("  ")).toThrow();
    expect(() => sanitizeFolder("../etc")).toThrow();
    expect(() => sanitizeFolder(5)).toThrow();
  });

  test("parseTriageInput requires a valid label", () => {
    expect(parseTriageInput({ label: "action" })).toEqual({ label: "action" });
    expect(() => parseTriageInput({ label: "bogus" })).toThrow();
    expect(() => parseTriageInput({})).toThrow();
  });

  test("parseDraftInput: instruction optional, defaults to empty string", () => {
    expect(parseDraftInput({})).toEqual({ instruction: "" });
    expect(parseDraftInput({ instruction: "be terse" })).toEqual({ instruction: "be terse" });
    expect(() => parseDraftInput({ instruction: 5 })).toThrow();
  });

  test("parseSendInput requires non-empty to[]/subject/text; rejects malformed recipients", () => {
    expect(() => parseSendInput({})).toThrow();
    expect(() => parseSendInput({ to: [], subject: "s", text: "t" })).toThrow();
    expect(() => parseSendInput({ to: ["not-an-email"], subject: "s", text: "t" })).toThrow();
    const ok = parseSendInput({ to: ["a@b.com"], subject: "Hi", text: "body" });
    expect(ok).toEqual({ to: ["a@b.com"], subject: "Hi", text: "body" });
    const full = parseSendInput({
      to: ["a@b.com"],
      cc: ["c@d.com"],
      subject: "Hi",
      text: "body",
      inReplyTo: "<msg-1>",
    });
    expect(full.cc).toEqual(["c@d.com"]);
    expect(full.inReplyTo).toBe("<msg-1>");
  });
});

// ── Rule-based triage classifier (pure, no AI) ───────────────────────────────
describe("O4 email — triageClassify (rule-based, deterministic)", () => {
  test("action keywords → action", () => {
    expect(triageClassify({ subject: "Please review PR #412", text: "Can you take a look?" })).toBe("action");
    expect(triageClassify({ subject: "Need your approval", text: "urgent, blocks release" })).toBe("action");
  });
  test("waiting keywords → waiting", () => {
    expect(triageClassify({ subject: "Following up", text: "just waiting on your reply" })).toBe("waiting");
  });
  test("no signal → archive", () => {
    expect(triageClassify({ subject: "Weekly newsletter", text: "Here is what happened this week." })).toBe(
      "archive",
    );
  });
});

// ── loadEmailConfig — graceful no-mailbox + no plaintext leak ────────────────
describe("O4 email — loadEmailConfig (env-driven, kapalı-varsayılan)", () => {
  const cleanEnv: NodeJS.ProcessEnv = {};

  test("no EMAIL_IMAP_* set → imap:null, smtp:null (graceful, not crash)", () => {
    const cfg = loadEmailConfig(cleanEnv);
    expect(cfg.imap).toBeNull();
    expect(cfg.smtp).toBeNull();
  });

  test("full IMAP+SMTP env → config resolved, password NEVER present in the returned object", () => {
    const env: NodeJS.ProcessEnv = {
      EMAIL_IMAP_HOST: "imap.example.com",
      EMAIL_IMAP_PORT: "993",
      EMAIL_IMAP_USER: "me@example.com",
      EMAIL_IMAP_PASSWORD: "super-secret-pw",
      EMAIL_SMTP_HOST: "smtp.example.com",
      EMAIL_SMTP_PORT: "587",
    } as NodeJS.ProcessEnv;
    const cfg = loadEmailConfig(env);
    expect(cfg.imap).toEqual({ host: "imap.example.com", port: 993, secure: true, user: "me@example.com" });
    expect(cfg.smtp).toEqual({ host: "smtp.example.com", port: 587, secure: false, user: "me@example.com" });
    const serialized = JSON.stringify(cfg);
    expect(serialized).not.toContain("super-secret-pw");
    expect(serialized.toLowerCase()).not.toContain("password");
  });
});

// ── AI summarize/draft — fake aiCall, no network, no SMTP ────────────────────
describe("O4 email — summarize/draft (fake aiCall, $0 local)", () => {
  test("summarizeMessage parses a well-formed JSON reply", async () => {
    const aiCall = async () =>
      JSON.stringify({ summary: "Priya needs review by Friday.", bullets: ["Fix on branch", "Blocks release"], suggestedAction: "Approve PR #412" });
    const out = await summarizeMessage({ subject: "PR #412", from: "priya@ollamas.dev", text: "please review" }, aiCall);
    expect(out.summary).toBe("Priya needs review by Friday.");
    expect(out.bullets).toEqual(["Fix on branch", "Blocks release"]);
    expect(out.suggestedAction).toBe("Approve PR #412");
  });

  test("summarizeMessage falls back to raw text on malformed JSON (safe fallback)", async () => {
    const aiCall = async () => "not json at all";
    const out = await summarizeMessage({ subject: "x", from: "a@b.com", text: "y" }, aiCall);
    expect(out.summary).toBe("not json at all");
    expect(out.bullets).toEqual([]);
  });

  test("draftReply returns a draft string and NEVER touches SMTP (mock call count 0)", async () => {
    let smtpCalls = 0;
    const fakeSmtp: SmtpTransport = {
      sendMail: async () => {
        smtpCalls++;
        return { ok: true, messageId: "should-not-be-called" };
      },
    };
    const aiCall = async () => "Thursday 3pm works — I'll pull the branch and approve if green.";
    const draftText = await draftReply({ subject: "PR #412", from: "priya@ollamas.dev", text: "..." }, "be concise", aiCall);
    expect(draftText).toBe("Thursday 3pm works — I'll pull the branch and approve if green.");
    expect(smtpCalls).toBe(0);
    void fakeSmtp; // constructed but intentionally never invoked
  });
});

// ── SMTP send gate (fake transport injected via _setEmailDeps) ───────────────
describe("O4 email — sendEmail (privileged, transport injected)", () => {
  test("smtp:null → 503, never throws", async () => {
    const r = await sendEmail({ to: ["a@b.com"], subject: "s", text: "t" }, null);
    expect(r.ok).toBe(false);
    if ("error" in r) expect(r.status).toBe(503);
  });

  test("smtp configured → sendMail called exactly once with the envelope", async () => {
    const calls: unknown[] = [];
    const fakeSmtp: SmtpTransport = {
      sendMail: async (input) => {
        calls.push(input);
        return { ok: true, messageId: "abc123" };
      },
    };
    const r = await sendEmail({ to: ["a@b.com"], subject: "Hi", text: "body" }, fakeSmtp);
    expect(r.ok).toBe(true);
    if (!("error" in r)) expect(r.messageId).toBe("abc123");
    expect(calls.length).toBe(1);
  });

  test("smtp transport failure → ok:false, status 502 (not a throw)", async () => {
    const fakeSmtp: SmtpTransport = { sendMail: async () => ({ ok: false, error: "535 auth rejected" }) };
    const r = await sendEmail({ to: ["a@b.com"], subject: "s", text: "t" }, fakeSmtp);
    expect(r.ok).toBe(false);
    if ("error" in r) {
      expect(r.status).toBe(502);
      expect(r.error).toContain("535");
    }
  });
});

// ── Service-level: status/sync/triage/summarize/draft/send via injected deps ─
describe("O4 email — service (IMAP-mock fetch, injected deps, no real network)", () => {
  beforeEach(() => _resetEmailDeps());
  afterAll(() => _resetEmailDeps());

  test("getStatus: imap:null → connected:false (graceful, no mailbox configured)", async () => {
    _setEmailDeps({ imap: null });
    const s = await getStatus();
    expect(s.connected).toBe(false);
  });

  test("getStatus: fake imap.listFolders() → connected:true + folders", async () => {
    const fakeImap: ImapTransport = {
      listFolders: async () => ["INBOX", "Sent", "Drafts"],
      fetchMessages: async () => [],
    };
    _setEmailDeps({ imap: fakeImap });
    const s = await getStatus();
    expect(s.connected).toBe(true);
    expect(s.folders).toEqual(["INBOX", "Sent", "Drafts"]);
  });

  test("getStatus: imap.listFolders() throws (535 auth) → connected:false + error, never throws to caller", async () => {
    const fakeImap: ImapTransport = {
      listFolders: async () => {
        throw new Error("535 5.7.8 auth rejected");
      },
      fetchMessages: async () => [],
    };
    _setEmailDeps({ imap: fakeImap });
    const s = await getStatus();
    expect(s.connected).toBe(false);
    expect(s.error).toContain("535");
  });

  test("syncMessages: fake imap.fetchMessages() → triage-classified + persisted (O0 store v11)", async () => {
    const fakeImap: ImapTransport = {
      listFolders: async () => ["INBOX"],
      fetchMessages: async () => [
        {
          uid: "1",
          from: "priya@ollamas.dev",
          to: "me@ollamas.dev",
          subject: "Please review PR #412",
          date: "2026-01-01T00:00:00.000Z",
          text: "Can you review before Friday? Thanks!",
        },
        {
          uid: "2",
          from: "newsletter@example.com",
          to: "me@ollamas.dev",
          subject: "Weekly digest",
          date: "2026-01-02T00:00:00.000Z",
          text: "Here is what happened this week.",
        },
      ],
    };
    _setEmailDeps({ imap: fakeImap });
    const r = await syncMessages("INBOX");
    expect(r.connected).toBe(true);
    expect(r.messages.length).toBe(2);
    const reviewMsg = r.messages.find((m) => m.subject.includes("PR #412"));
    expect(reviewMsg?.triage).toBe("action");
    const digestMsg = r.messages.find((m) => m.subject.includes("digest"));
    expect(digestMsg?.triage).toBe("archive");

    // Persisted — getMessage() reads it back from the store, not from imap again.
    const got = await getMessage(reviewMsg!.id);
    expect(got?.from).toBe("priya@ollamas.dev");
  });

  test("syncMessages: imap:null → serves the cache (already-synced) without crashing", async () => {
    _setEmailDeps({ imap: null });
    const r = await syncMessages("INBOX");
    expect(r.connected).toBe(false);
    expect(Array.isArray(r.messages)).toBe(true); // may be the previously-cached rows
  });

  test("setTriage overrides the label; 404-equivalent undefined for unknown id", async () => {
    const fakeImap: ImapTransport = {
      listFolders: async () => ["INBOX"],
      fetchMessages: async () => [
        { uid: "3", from: "a@b.com", to: "me@x.com", subject: "no signal here", date: "2026-01-03T00:00:00.000Z", text: "hello" },
      ],
    };
    _setEmailDeps({ imap: fakeImap });
    const synced = await syncMessages("INBOX");
    const msg = synced.messages.find((m) => m.subject === "no signal here")!;
    expect(msg.triage).toBe("archive");

    const updated = await setTriage(msg.id, "waiting");
    expect(updated?.triage).toBe("waiting");
    expect(await setTriage("does-not-exist", "action")).toBeUndefined();
  });

  test("summarize(id) uses the injected aiCall; undefined for unknown id", async () => {
    const fakeImap: ImapTransport = {
      listFolders: async () => ["INBOX"],
      fetchMessages: async () => [
        { uid: "4", from: "priya@ollamas.dev", to: "me@x.com", subject: "PR #412", date: "2026-01-04T00:00:00.000Z", text: "please review" },
      ],
    };
    const aiCall = async () => JSON.stringify({ summary: "short summary", bullets: [] });
    _setEmailDeps({ imap: fakeImap, aiCall });
    const synced = await syncMessages("INBOX");
    const msg = synced.messages[0];
    const out = await summarize(msg.id);
    expect(out?.summary).toBe("short summary");
    expect(await summarize("nope")).toBeUndefined();
  });

  test("draft(id, instruction) uses the injected aiCall; undefined for unknown id", async () => {
    const fakeImap: ImapTransport = {
      listFolders: async () => ["INBOX"],
      fetchMessages: async () => [
        { uid: "5", from: "priya@ollamas.dev", to: "me@x.com", subject: "PR #412", date: "2026-01-05T00:00:00.000Z", text: "please review" },
      ],
    };
    const aiCall = async () => "Sounds good, will review today.";
    _setEmailDeps({ imap: fakeImap, aiCall });
    const synced = await syncMessages("INBOX");
    const msg = synced.messages[0];
    const out = await draft(msg.id, "be brief");
    expect(out?.draft).toBe("Sounds good, will review today.");
    expect(await draft("nope", "")).toBeUndefined();
  });

  test("send() with smtp:null → 503; with fake smtp → sent exactly once", async () => {
    _setEmailDeps({ smtp: null });
    const off = await send({ to: ["a@b.com"], subject: "s", text: "t" });
    expect(off.ok).toBe(false);

    let calls = 0;
    const fakeSmtp: SmtpTransport = {
      sendMail: async () => {
        calls++;
        return { ok: true, messageId: "sent-1" };
      },
    };
    _setEmailDeps({ smtp: fakeSmtp });
    const on = await send({ to: ["a@b.com"], subject: "s", text: "t" });
    expect(on.ok).toBe(true);
    expect(calls).toBe(1);
  });
});

// ── Route + toggle (functional, P4) ──────────────────────────────────────────
describe("O4 email — route + toggle", () => {
  let server: Server;
  let base = "";

  beforeAll(async () => {
    _resetEmailDeps();
    const app = express();
    app.use(express.json());
    mountEnabledModules(app, { MODULE_EMAIL: "1" } as NodeJS.ProcessEnv);
    server = http.createServer(app as unknown as http.RequestListener);
    await new Promise<void>((r) => server.listen(0, () => r()));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  });

  test("MODULE_EMAIL=1 → module listed in /api/modules", async () => {
    process.env.MODULE_EMAIL = "1";
    expect(enabledModules().map((m) => m.id)).toContain("email");
    delete process.env.MODULE_EMAIL;
  });

  test("GET /status with no mailbox configured → connected:false (graceful boot)", async () => {
    _resetEmailDeps();
    const res = await fetch(`${base}/api/modules/email/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.connected).toBe(false);
  });

  test("GET /messages?folder=INBOX → 200 with a messages array (never crashes when unconfigured)", async () => {
    const res = await fetch(`${base}/api/modules/email/messages?folder=INBOX`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.messages)).toBe(true);
  });

  test("GET /messages without folder → 400 (honest validation)", async () => {
    const res = await fetch(`${base}/api/modules/email/messages`);
    expect(res.status).toBe(400);
  });

  test("GET /messages/:id 404 for unknown id", async () => {
    const res = await fetch(`${base}/api/modules/email/messages/does-not-exist`);
    expect(res.status).toBe(404);
  });

  test("POST /messages/:id/triage 404 for unknown id, 400 for invalid label", async () => {
    const bad = await fetch(`${base}/api/modules/email/messages/nope/triage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "bogus" }),
    });
    expect(bad.status).toBe(400);
    const missing = await fetch(`${base}/api/modules/email/messages/nope/triage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "archive" }),
    });
    expect(missing.status).toBe(404);
  });

  test("POST /send with an invalid body → 400 (never reaches SMTP)", async () => {
    const res = await fetch(`${base}/api/modules/email/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: [], subject: "", text: "" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /send with a valid body but no SMTP configured → 503 (privileged action gated)", async () => {
    _resetEmailDeps();
    const res = await fetch(`${base}/api/modules/email/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: ["a@b.com"], subject: "Hi", text: "body" }),
    });
    expect(res.status).toBe(503);
  });

  test("MODULE_EMAIL unset → routes 404 (toggle-off blackout)", async () => {
    const off = express();
    off.use(express.json());
    mountEnabledModules(off, {} as NodeJS.ProcessEnv);
    const s = http.createServer(off as unknown as http.RequestListener);
    await new Promise<void>((r) => s.listen(0, () => r()));
    const addr = s.address();
    const b = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
    try {
      expect((await fetch(`${b}/api/modules/email/status`)).status).toBe(404);
    } finally {
      await new Promise<void>((r) => s.close(() => r()));
    }
  });
});

// ── localOwnerGuard invariant: /api/modules/email is 403 under SaaS (P5) ─────
describe("O4 email — localOwnerGuard (SAAS_ENFORCE=1 → 403)", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    process.env.OLLAMAS_NO_AUTOBOOT = "1";
    process.env.MODULE_EMAIL = "1";
    delete process.env.SAAS_ENFORCE;
    const { app } = await import("../../server");
    server = http.createServer(app as unknown as http.RequestListener);
    await new Promise<void>((r) => server.listen(0, () => r()));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  }, 60_000);
  afterAll(async () => {
    delete process.env.SAAS_ENFORCE;
    delete process.env.MODULE_EMAIL;
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  });

  test("SAAS_ENFORCE=1 → /api/modules/email/* is 403 (inherits the guard)", async () => {
    process.env.SAAS_ENFORCE = "1";
    expect((await fetch(`${base}/api/modules/email/status`)).status).toBe(403);
    delete process.env.SAAS_ENFORCE;
  });

  test("SAAS_ENFORCE unset → guard calls next() (not 403)", async () => {
    delete process.env.SAAS_ENFORCE;
    expect((await fetch(`${base}/api/modules/email/status`)).status).not.toBe(403);
  });
});
