export interface InputEvent {
  type: 'keyboard' | 'mouse';
  payload: {
    key?: string;
    x?: number;
    y?: number;
  };
}

export interface SecurityEvent {
  id: string;
  timestamp: string;
  category: "file_system" | "command_exec" | "network" | "permission_change";
  action: string;
  details: string;
  status: "allow" | "deny" | "warning" | "info";
}

export interface SystemMemory {
  total: number;
  free: number;
  percentageUsed: number;
}

export interface OSInfo {
  platform: string;
  release: string;
  arch: string;
  uptime: number;
}

export interface LoadedModel {
  name: string;
  model: string;
  size: number;
  digest: string;
  details: {
    parent_model: string;
    format: string;
    family: string;
    families: string[] | null;
    parameter_size: string;
    quantization_level: string;
  };
  expires_at: string;
}

export interface HealthTelemetry {
  mode: "live" | "degraded-live" | "demo";
  isLive: boolean;
  os: OSInfo;
  metrics: {
    cpuLoad1Min: number;
    memory: SystemMemory;
    ollamaVersion: string;
    loadedModels: LoadedModel[];
  };
  workspacePath: string;
  permissions: {
    fileRead: boolean;
    fileWrite: boolean;
    commandExec: boolean;
    git: boolean;
  };
  hasBackupEnabled: boolean;
  // vCockpit (live SSE) — present on /api/cockpit/stream frames, absent on plain /api/health.
  backend?: { host: string; reachable: boolean; version: string; activeModel: string | null };
  fleet?: { activeUrl: string; poolSize: number; backends: { name: string; url: string; priority: number; active: boolean }[] };
  cloudProviders?: { name: string; ready: boolean }[]; // cloud LLM providers with a key present (fleet/council backends)
  updatedAt?: number; // SSE frame timestamp; absent on /api/health poll fallback
  realtime?: {
    cores: number[]; // per-core CPU % (live deltas)
    activity: { sessionCount: number; recentRuns: number; lastActivityAgoSec: number | null };
    backendLatencyMs: number | null;
  };
  models?: {
    list: { name: string; sizeGb: number; fitsRam: boolean; loaded: boolean; recommended: boolean }[];
    recommended: string | null;
    totalRamGb: number;
    championTokPerSec: number | null;
  };
}

export interface FileItem {
  name: string;
  relativePath: string;
  isDirectory: boolean;
  size?: number;
  gitStatus?: "untracked" | "modified" | "staged" | "none";
  children?: FileItem[];
}

export interface TestGateReport {
  status: "PASS" | "FAIL" | "WARN";
  details: string;
}

export type SelfTestReport = Record<string, TestGateReport>;

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

export interface PipelineStageState {
  stage: "architect" | "coder" | "reviewer" | "self_improve";
  status: "pending" | "running" | "done" | "fail";
  text: string;
  tokensPerSec?: number;
  elapsed?: number;
}

export interface NodeCapability {
  nodeId: string;
  os: string;
  cpuCores: number;
  totalRAM: number;
  gpuType: "metal" | "cuda" | "directml" | "none";
  vramGB: number;
  maxLayers: number;
}

export interface ClusterNode extends NodeCapability {
  active: boolean;
  load: number;
  assignedLayers: number[];
}

export interface ClusterConsent {
  approved: boolean;
  timestamp: string;
  termsHash: string;
}

export interface ClusterTelemetry {
  consent: ClusterConsent;
  peers: ClusterNode[];
  isJoined: boolean;
}
