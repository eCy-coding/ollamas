// O8 settings router — mounted by the registry at /api/modules/settings
// (scoped Router; inherits localOwnerGuard via the single /api/modules prefix,
// INV-O0-1). Every route is thin: validate → service → json. Mirrors
// server/modules/notes-tasks/router.ts + cookbook/router.ts.
import type { Router } from "express";
import {
  parseGeneralPatch,
  parseRolePermsPatch,
  parseToolPolicyPatch,
  parseTotpCredential,
  parseTotpToken,
  sanitizeRoleName,
  sanitizeToolId,
} from "./schema";
import {
  activate2fa,
  disable2fa,
  enroll2fa,
  get2faStatus,
  getGeneralPrefs,
  getSandboxEnforced,
  listRoles,
  listSessions,
  listToolPolicy,
  regenerateBackupCodes,
  revokeSession,
  RoleError,
  setSandboxEnforced,
  ToolPolicyError,
  TotpError,
  updateGeneralPrefs,
  updateRolePerms,
  updateToolPolicy,
  verify2fa,
} from "./service";

export function mountSettingsRoutes(router: Router): void {
  // ── General ────────────────────────────────────────────────────────────
  router.get("/general", async (_req, res) => {
    res.json(await getGeneralPrefs());
  });

  router.put("/general", async (req, res) => {
    let patch: ReturnType<typeof parseGeneralPatch>;
    try {
      patch = parseGeneralPatch(req.body);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    res.json(await updateGeneralPrefs(patch));
  });

  router.get("/sandbox", async (_req, res) => {
    res.json({ enforced: await getSandboxEnforced() });
  });

  router.put("/sandbox", async (req, res) => {
    const enforced = (req.body as { enforced?: unknown })?.enforced;
    if (typeof enforced !== "boolean") {
      res.status(400).json({ error: "field 'enforced' must be a boolean" });
      return;
    }
    res.json({ enforced: await setSandboxEnforced(enforced) });
  });

  // ── Security: 2FA ──────────────────────────────────────────────────────
  router.get("/security/2fa", async (_req, res) => {
    res.json(await get2faStatus());
  });

  router.post("/security/2fa/enroll", async (_req, res) => {
    res.json(await enroll2fa());
  });

  router.post("/security/2fa/activate", async (req, res) => {
    let token: string;
    try {
      token = parseTotpToken(req.body);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    try {
      res.json(await activate2fa(token));
    } catch (e) {
      if (e instanceof TotpError) {
        res.status(400).json({ error: e.message });
        return;
      }
      throw e;
    }
  });

  router.post("/security/2fa/verify", async (req, res) => {
    let cred: ReturnType<typeof parseTotpCredential>;
    try {
      cred = parseTotpCredential(req.body);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    try {
      const result = await verify2fa(cred);
      if (!result.ok) {
        res.status(401).json({ error: "invalid_totp", ...result });
        return;
      }
      res.json(result);
    } catch (e) {
      if (e instanceof TotpError) {
        res.status(400).json({ error: e.message });
        return;
      }
      throw e;
    }
  });

  router.post("/security/2fa/disable", async (req, res) => {
    let cred: ReturnType<typeof parseTotpCredential>;
    try {
      cred = parseTotpCredential(req.body);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    const ok = await disable2fa(cred);
    if (!ok) {
      res.status(401).json({ error: "invalid_totp" });
      return;
    }
    res.json({ enabled: false });
  });

  router.post("/security/2fa/backup-codes/regenerate", async (req, res) => {
    let cred: ReturnType<typeof parseTotpCredential>;
    try {
      cred = parseTotpCredential(req.body);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    const codes = await regenerateBackupCodes(cred);
    if (!codes) {
      res.status(401).json({ error: "invalid_totp" });
      return;
    }
    res.json({ backupCodes: codes });
  });

  // ── Security: sessions ─────────────────────────────────────────────────
  router.get("/security/sessions", async (_req, res) => {
    res.json({ sessions: await listSessions() });
  });

  router.post("/security/sessions/:id/revoke", async (req, res) => {
    const ok = await revokeSession(req.params.id);
    if (!ok) {
      res.status(404).json({ error: "session not found or cannot be revoked" });
      return;
    }
    res.json({ ok: true });
  });

  // ── Roles ──────────────────────────────────────────────────────────────
  router.get("/roles", async (_req, res) => {
    res.json({ roles: await listRoles() });
  });

  router.put("/roles/:name", async (req, res) => {
    let name: ReturnType<typeof sanitizeRoleName>;
    let patch: ReturnType<typeof parseRolePermsPatch>;
    try {
      name = sanitizeRoleName(req.params.name);
      patch = parseRolePermsPatch(req.body);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    try {
      res.json(await updateRolePerms(name, patch));
    } catch (e) {
      if (e instanceof RoleError) {
        res.status(403).json({ error: e.message });
        return;
      }
      throw e;
    }
  });

  // ── Tool policy ────────────────────────────────────────────────────────
  router.get("/tools/policy", async (_req, res) => {
    res.json({ tools: await listToolPolicy() });
  });

  router.put("/tools/policy/:tool", async (req, res) => {
    let tool: ReturnType<typeof sanitizeToolId>;
    let patch: ReturnType<typeof parseToolPolicyPatch>;
    try {
      tool = sanitizeToolId(req.params.tool);
      patch = parseToolPolicyPatch(req.body);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    try {
      res.json(await updateToolPolicy(tool, patch));
    } catch (e) {
      if (e instanceof ToolPolicyError) {
        res.status(404).json({ error: e.message });
        return;
      }
      throw e;
    }
  });
}
