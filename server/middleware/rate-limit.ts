// Per-tenant rate limiting + monthly quota (AGENTS.md Faz 3/4, prod 9C). Token
// bucket keyed by tenant, capacity = plan.rate_per_min. When REDIS_URL is set the
// bucket is a shared atomic Lua script (multi-instance correct); otherwise it
// falls back to an in-memory Map (zero-infra single instance). Monthly quota is
// enforced against usage_events. Unauthenticated requests pass through.

import type { Request, Response, NextFunction } from "express";
import { monthToDateUsage, queueWebhookEvent } from "../store";

interface Bucket {
  tokens: number;
  last: number;
}
const buckets = new Map<string, Bucket>();

// Bound memory: cap distinct tenants tracked and evict buckets idle past the TTL,
// so a tenant-id spray can't grow the Map without limit (DoS guard).
const MAX_BUCKETS = Number(process.env.RATE_LIMIT_MAX_BUCKETS || 10000);
const IDLE_TTL_MS = 10 * 60_000;

function evictIfNeeded(now: number) {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [k, b] of buckets) if (now - b.last > IDLE_TTL_MS) buckets.delete(k);
  if (buckets.size >= MAX_BUCKETS) {
    let oldestK: string | null = null, oldest = Infinity;
    for (const [k, b] of buckets) if (b.last < oldest) { oldest = b.last; oldestK = k; }
    if (oldestK) buckets.delete(oldestK);
  }
}

function inMemoryAllow(tenantId: string, cap: number): boolean {
  const refillPerMs = cap / 60000;
  const now = Date.now();
  if (!buckets.has(tenantId)) evictIfNeeded(now);
  const b = buckets.get(tenantId) || { tokens: cap, last: now };
  b.tokens = Math.min(cap, b.tokens + (now - b.last) * refillPerMs);
  b.last = now;
  if (b.tokens < 1) { buckets.set(tenantId, b); return false; }
  b.tokens -= 1; buckets.set(tenantId, b);
  return true;
}

// Redis token bucket (atomic, multi-instance). Lazy client; null until first use.
const LUA = `
local key=KEYS[1]
local cap=tonumber(ARGV[1])
local now=tonumber(ARGV[2])
local refill=tonumber(ARGV[3])
local tokens=tonumber(redis.call('HGET',key,'tokens') or cap)
local last=tonumber(redis.call('HGET',key,'last') or now)
tokens=math.min(cap, tokens + (now-last)*refill)
local allowed=0
if tokens>=1 then tokens=tokens-1; allowed=1 end
redis.call('HSET',key,'tokens',tokens,'last',now)
redis.call('PEXPIRE',key,120000)
return allowed`;
let redisClient: any = null;
let redisReady = false;
async function getRedis() {
  if (!process.env.REDIS_URL) return null;
  if (!redisClient) {
    try {
      const { default: Redis } = await import("ioredis");
      redisClient = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: false });
      redisClient.on("error", () => {}); // tolerate; we fall back to memory
      redisReady = true;
    } catch { redisClient = null; }
  }
  return redisReady ? redisClient : null;
}

async function allow(tenantId: string, cap: number): Promise<boolean> {
  const r = await getRedis();
  if (r) {
    try {
      const res = await r.eval(LUA, 1, `rl:${tenantId}`, cap, Date.now(), cap / 60000);
      return Number(res) === 1;
    } catch { /* fall through to memory */ }
  }
  return inMemoryAllow(tenantId, cap);
}

export function rateLimitMiddleware() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const t = req.tenant;
    if (!t) return next(); // single-user / unauthenticated path is unmetered.

    if (t.plan.monthly_quota > 0 && monthToDateUsage(t.tenantId) >= t.plan.monthly_quota) {
      queueWebhookEvent(t.tenantId, "usage.quota_exceeded", { quota: t.plan.monthly_quota, plan: t.plan.id });
      return res.status(429).json({ error: "Monthly quota exceeded", quota: t.plan.monthly_quota, plan: t.plan.id });
    }

    const cap = Math.max(1, t.plan.rate_per_min);
    if (!(await allow(t.tenantId, cap))) {
      res.setHeader("Retry-After", "1");
      return res.status(429).json({ error: "Rate limit exceeded", ratePerMin: cap, plan: t.plan.id });
    }
    next();
  };
}
