import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";

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

export class SecureDB {
  private filePath: string;
  private masterKey: Buffer;
  public data: DBConfig;

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
    
    // 2. Setup master key file for AES encryption
    const keyPath = path.join(dir, ".master_key");
    if (fs.existsSync(keyPath)) {
      this.masterKey = fs.readFileSync(keyPath);
    } else {
      const newKey = crypto.randomBytes(32);
      fs.writeFileSync(keyPath, newKey, { mode: 0o600 });
      this.masterKey = newKey;
    }

    // 3. Load or initiate data
    this.data = this.load();
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
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
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
