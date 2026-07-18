import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";
import { readGenericPassword, writeGenericPassword } from "./lib/keychain-scan";
import type { ModelOverride } from "./model-overrides";

// Atomic file write: write a temp sibling then rename over the target. rename(2) is atomic on
// POSIX within the same directory, so a crash / power loss mid-write can never leave the target
// half-written or truncated — critical for config.json (the encrypted vault + sessions) and the
// master key, where a torn write means total credential loss. Best-effort cleanup of the temp on
// failure. Exported for the durability test.
export function atomicWriteFileSync(filePath: string, data: string | Buffer, opts?: { mode?: number }): void {
  const tmp = `${filePath}.tmp.${process.pid}.${atomicWriteSeq++}`;
  try {
    fs.writeFileSync(tmp, data, opts?.mode != null ? { mode: opts.mode } : undefined);
    fs.renameSync(tmp, filePath);
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* best-effort */ }
    throw e;
  }
}
let atomicWriteSeq = 0;

export interface SecurityEvent {
  id: string;
  timestamp: string;
  category: "file_system" | "command_exec" | "network" | "permission_change";
  action: string;
  details: string;
  status: "allow" | "deny" | "warning" | "info";
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool" | string;
  content: string;
  timestamp: string;
  name?: string;
  tool_call_id?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  modelId: string;
  providerId: string;
  messages: ChatMessage[];
  updatedAt: string;
}

export interface ClusterConfig {
  eulaApproved: boolean;
  peerId: string;
  nodeActive: boolean;
  numCtxLimit: number;
  performanceFlags?: string;
}

export interface DBConfig {
  keys: Record<string, string>; // encrypted strings
  workspacePath: string;
  ollamaNumCtx: number;
  backup: {
    type: "s3" | "webdav" | "none";
    endpoint: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
    intervalMinutes: number;
    enabled: boolean;
  };
  permissions: {
    fileRead: boolean;
    fileWrite: boolean;
    commandExec: boolean;
    git: boolean;
  };
  sessions: ChatSession[];
  securityLog: SecurityEvent[];
  cluster: ClusterConfig;
  /** Revenue Ops (Faz19) — personal income tooling config (local-owner only). */
  revenue?: { model?: string; brand?: string; email?: string; paymentLink?: string };
  /** Outbound alert sinks (Slack/Discord incoming webhooks) — local-owner only. */
  notify?: { slackWebhookUrl?: string; discordWebhookUrl?: string };
  /** Per-model tuning overrides (M-038): model tag → num_ctx/temperature/keep_alive/system. */
  modelOverrides?: Record<string, ModelOverride>;
  /** eCym distillation ledger (v10) — capped history of ecy:latest/candidate rebuilds. */
  ecymVersions?: EcymVersionRecord[];
  /** eCym panel-specialist registry (v12) — panelId → binding + params + provenance. */
  ecymSpecialists?: Record<string, EcymSpecialistRecord>;
  /** Distilled panel knowledge briefs (v12) — panelId → { brief, ts, sources[] }. Public knowledge, unencrypted. */
  panelBriefs?: Record<string, { brief: string; ts: string; sources: string[] }>;
  /** Operator-added threat-intel feed URLs (v12, gap #9) — merged into threatfeed.ts FEEDS. */
  threatFeeds?: { source: string; url: string }[];
}

/** eCym distillation ledger record (was written off-schema pre-v12). */
export interface EcymVersionRecord {
  id: string; createdAt: string; base: string; numCtx: number; temperature: number;
  probeOk: boolean; note: string; specialistId?: string;
}

/** eCym panel-specialist binding (v12). model defaults to "ecy:latest" until baked. */
export interface EcymSpecialistRecord {
  panelId: string; model: string; identity: string;
  params: { temperature: number; numCtx: number };
  knowledgeSources: string[]; lastDistilled: string | null; lastVersionId: string | null;
}

const DEFAULT_CONFIG: DBConfig = {
  keys: {},
  workspacePath: "",
  ollamaNumCtx: 8192,
  backup: {
    type: "none",
    endpoint: "",
    bucket: "",
    accessKey: "",
    secretKey: "",
    intervalMinutes: 120,
    enabled: false,
  },
  permissions: {
    fileRead: true,
    fileWrite: true,
    commandExec: true,
    git: true,
  },
  sessions: [],
  securityLog: [],
  cluster: {
    eulaApproved: false,
    peerId: "",
    nodeActive: false,
    numCtxLimit: 8192,
  },
};

// Master-key source decision (pure → unit-tested). Priority: an injected env key (the stable
// Cloud-Run/Docker secret-mount path) wins; else an existing on-disk key file; else — if an
// encrypted store ALREADY exists — FAIL CLOSED rather than mint a key that can't decrypt it;
// else (truly fresh): mint a new one LOCALLY, but on cloud/container boots FAIL CLOSED too
// (M-020 — an ephemeral minted key dies with the replica and orphans every secret).
export type MasterKeyDecision =
  | { source: "env"; key: Buffer }
  | { source: "keychain"; key: Buffer }
  | { source: "file" }
  | { source: "mint" }
  | { source: "fail"; reason: string };

// Priority: injected env key (stable Cloud-Run/Docker secret) > hardware Keychain (Secure
// Enclave-backed, opt-in) > on-disk key file > (existing store → fail-closed | fresh → mint).
// The keychain slot sits ABOVE the file so a machine that has migrated its key into the
// hardware vault boots from it, while a machine that hasn't still reads the file unchanged.
export function decideMasterKeySource(o: {
  envB64?: string;
  /** 32-byte key already read from the hardware keychain, when the opt-in is enabled + present. */
  keychainKey?: Buffer;
  keyFileExists: boolean;
  configExists: boolean;
  /** Cloud/container context (M-020): minting is forbidden — a fresh random key dies with the
   *  replica and orphans every secret encrypted under it, so a keyless cloud boot FAILS CLOSED. */
  isCloud?: boolean;
}): MasterKeyDecision {
  if (o.envB64) {
    const key = Buffer.from(o.envB64, "base64");
    if (key.length !== 32) return { source: "fail", reason: "MASTER_KEY_B64 must be base64 of exactly 32 bytes" };
    return { source: "env", key };
  }
  if (o.keychainKey && o.keychainKey.length === 32) return { source: "keychain", key: o.keychainKey };
  if (o.keyFileExists) return { source: "file" };
  if (o.configExists) {
    return { source: "fail", reason: "encrypted store exists but no master key — set MASTER_KEY_B64 (the original 32-byte key, base64) to decrypt it" };
  }
  if (o.isCloud) {
    return { source: "fail", reason: "cloud/container boot without a master key — refusing to mint an ephemeral key that would orphan all secrets on restart/replica; set MASTER_KEY_B64 (base64 of a stable 32-byte key)" };
  }
  return { source: "mint" };
}

// Reported by GET /api/health (name only — NEVER a key value). Distinguishes a strong,
// persisted secret source from a weak/ephemeral one so the cockpit can surface remediation.
//   env             → stable secret injected via MASTER_KEY_B64 (Cloud-Run/Docker mount)
//   secure-enclave  → Secure-Enclave-backed macOS Keychain (opt-in hardware vault)
//   file            → on-disk .master_key (persisted; single-host)
//   generated-ephemeral → freshly minted key that WON'T survive restart/replica (cloud, no stable dir)
//   missing         → no key while an encrypted store exists (fail-closed; never boots)
export type MasterKeySourceLabel = "env" | "secure-enclave" | "file" | "generated-ephemeral" | "missing";

/** Actionable remediation for a given master-key source. Empty = healthy/strong (no action). */
export function masterKeyRemediation(source: MasterKeySourceLabel): string {
  switch (source) {
    case "generated-ephemeral":
      return "Ephemeral master key — persisted secrets will NOT survive restart/replica. Set MASTER_KEY_B64 (base64 of a stable 32-byte key), or mount a MISSION_CONTROL_DATA_DIR volume.";
    case "missing":
      return "No master key but an encrypted store exists. Set MASTER_KEY_B64 to the original 32-byte key (base64) to decrypt the vault.";
    case "file":
      return "Master key on local disk. For multi-replica/Cloud Run set MASTER_KEY_B64, or enable OLLAMAS_MASTER_KEY_KEYCHAIN=1 for the Secure-Enclave hardware vault.";
    case "env":
    case "secure-enclave":
      return "";
  }
}

/** Map the internal load decision (+ cloud context) to the reported source label. */
export function labelMasterKeySource(source: MasterKeyDecision["source"], isCloud: boolean): MasterKeySourceLabel {
  switch (source) {
    case "env": return "env";
    case "keychain": return "secure-enclave";
    case "file": return "file";
    case "mint": return isCloud ? "generated-ephemeral" : "file";
    case "fail": return "missing";
  }
}

/** Service name under which the vault master key lives in the macOS Keychain (hardware vault). */
export function masterKeyService(): string {
  return process.env.OLLAMAS_MASTER_KEY_SERVICE || "OLLAMAS_MASTER_KEY";
}

/** The Secure-Enclave-backed hardware vault is opt-in (default OFF → zero behavior change).
 *  Enable with OLLAMAS_MASTER_KEY_KEYCHAIN=1 once the keychain ACL is granted. */
export function keychainVaultEnabled(): boolean {
  return process.env.OLLAMAS_MASTER_KEY_KEYCHAIN === "1" && os.platform() === "darwin";
}

export class SecureDB {
  private filePath: string;
  private masterKey: Buffer;
  public data: DBConfig;
  /** Reported source of the AES master key (name only, never a value). See MasterKeySourceLabel. */
  public readonly masterKeySource: MasterKeySourceLabel;

  constructor() {
    // 1. Resolve storage path
    // Explicit override (e.g. a mounted Docker volume) always wins so the vault
    // + master key survive container recreation. Without it, non-darwin hosts
    // (Linux containers) fall back to an ephemeral in-image dir.
    const isCloud = process.env.K_SERVICE || process.env.GOOGLE_CLOUD_RUN || os.platform() !== "darwin";
    const dir = process.env.MISSION_CONTROL_DATA_DIR
      ? process.env.MISSION_CONTROL_DATA_DIR
      : isCloud
      ? path.join(process.cwd(), ".ephemeral-data")
      : path.join(os.homedir(), ".llm-mission-control");

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.filePath = path.join(dir, "config.json");
    
    // 2. Setup master key for AES encryption (fail-closed). A MISSING key with an EXISTING
    // encrypted store must NEVER silently mint a new key — that would orphan every persisted
    // secret (provider keys, Stripe/GitHub, OAuth) to undecryptable ciphertext (decrypt → "").
    // On Cloud Run / multi-replica, inject the stable 32-byte key (base64) via MASTER_KEY_B64.
    const keyPath = path.join(dir, ".master_key");
    // Hardware vault (Secure Enclave-backed macOS Keychain) — opt-in, default OFF. When enabled,
    // read the master key from the keychain; a best-effort, timeout-guarded read that never
    // blocks boot (falls through to the file/mint path on any failure).
    let keychainKey: Buffer | undefined;
    if (keychainVaultEnabled()) {
      const b64 = readGenericPassword(masterKeyService());
      if (b64) {
        const buf = Buffer.from(b64.trim(), "base64");
        if (buf.length === 32) keychainKey = buf;
      }
    }
    const decision = decideMasterKeySource({
      envB64: process.env.MASTER_KEY_B64,
      keychainKey,
      keyFileExists: fs.existsSync(keyPath),
      configExists: fs.existsSync(this.filePath),
      isCloud: !!isCloud,
    });
    switch (decision.source) {
      case "env":
        this.masterKey = decision.key;
        break;
      case "keychain":
        this.masterKey = decision.key;
        break;
      case "file":
        this.masterKey = fs.readFileSync(keyPath);
        break;
      case "mint": {
        // Local-only path: cloud boots never reach here (keyless cloud → "fail", M-020).
        const newKey = crypto.randomBytes(32);
        atomicWriteFileSync(keyPath, newKey, { mode: 0o600 });
        this.masterKey = newKey;
        break;
      }
      case "fail":
        throw new Error("[db] " + decision.reason);
    }
    // Migration into the hardware vault: when the opt-in is on and the keychain does not yet
    // hold the active key, mirror the EXISTING file/minted key into the keychain (same bytes, so
    // decrypt stays consistent). The file remains as a fallback. Best-effort; never blocks boot.
    let migrated = false;
    if (keychainVaultEnabled() && !keychainKey && decision.source !== "env") {
      migrated = writeGenericPassword(masterKeyService(), this.masterKey.toString("base64"));
    }
    // Observability (source NAME only, never a key value): confirms which store the master key
    // came from — "keychain" proves the Secure-Enclave hardware vault is the live source.
    this.masterKeySource = labelMasterKeySource(decision.source, !!isCloud);
    if (keychainVaultEnabled()) {
      console.log(`[db] master key source: ${decision.source}${migrated ? " (mirrored → keychain)" : ""}`);
    }

    // 3. Load or initiate data
    this.data = this.load();
  }

  /** Master-key source + remediation for GET /api/health (name only — never a key value). */
  public masterKeyStatus(): { masterKeySource: MasterKeySourceLabel; remediation: string } {
    return { masterKeySource: this.masterKeySource, remediation: masterKeyRemediation(this.masterKeySource) };
  }

  private load(): DBConfig {
    if (!fs.existsSync(this.filePath)) {
      this.save(DEFAULT_CONFIG);
      return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
    try {
      const content = fs.readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(content);
      // Ensure structure matches DBConfig
      return { ...DEFAULT_CONFIG, ...parsed };
    } catch (e) {
      console.error("Failed to parse config, resetting to default.", e);
      return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
  }

  public save(newData: DBConfig = this.data): void {
    this.data = newData;
    // Atomic temp+rename — a crash mid-write must never truncate config.json (the vault).
    atomicWriteFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }

  /**
   * AES-256-GCM Encryption
   */
  public encrypt(plaintext: string): string {
    if (!plaintext) return "";
    const iv = crypto.randomBytes(12);
    // authTagLength pinned to 16 bytes (128-bit) — prevents short-tag forgery (Node #52327).
    const cipher = crypto.createCipheriv("aes-256-gcm", this.masterKey, iv, { authTagLength: 16 });
    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");
    const tag = cipher.getAuthTag().toString("hex");
    return `${iv.toString("hex")}:${tag}:${encrypted}`;
  }

  /**
   * AES-256-GCM Decryption
   */
  public decrypt(ciphertext: string): string {
    if (!ciphertext) return "";
    try {
      const parts = ciphertext.split(":");
      if (parts.length !== 3) return "";
      const iv = Buffer.from(parts[0], "hex");
      const tag = Buffer.from(parts[1], "hex");
      const encrypted = parts[2];
      if (tag.length !== 16) return ""; // reject short/forged auth tags
      const decipher = crypto.createDecipheriv("aes-256-gcm", this.masterKey, iv, { authTagLength: 16 });
      decipher.setAuthTag(tag);
      let decrypted = decipher.update(encrypted, "hex", "utf8");
      decrypted += decipher.final("utf8");
      return decrypted;
    } catch (e) {
      console.error("Decryption failure", e);
      return "";
    }
  }

  public logSecurity(
    category: SecurityEvent["category"],
    action: string,
    details: string,
    status: SecurityEvent["status"]
  ): void {
    const event: SecurityEvent = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      category,
      action,
      details,
      status,
    };
    this.data.securityLog.unshift(event);
    if (this.data.securityLog.length > 500) {
      this.data.securityLog = this.data.securityLog.slice(0, 500);
    }
    this.save();
  }
}

// Export single shared instance
export const db = new SecureDB();
