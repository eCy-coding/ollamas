// Per-tenant rate limiting + monthly quota (AGENTS.md Faz 3/4). Token bucket
// keyed by tenant, capacity = plan.rate_per_min; monthly quota enforced against
// the usage_events table. Unauthenticated requests (no req.tenant) pass through
// — they are the single-user localhost path.

import type { Request, Response, NextFunction } from "express";
import { monthToDateUsage } from "../store";

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
  // Still over cap after sweeping idle? Drop the oldest-touched entry.
  if (buckets.size >= MAX_BUCKETS) {
    let oldestK: string | null = null, oldest = Infinity;
    for (const [k, b] of buckets) if (b.last < oldest) { oldest = b.last; oldestK = k; }
    if (oldestK) buckets.delete(oldestK);
  }
}

export function rateLimitMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const t = req.tenant;
    if (!t) return next(); // single-user / unauthenticated path is unmetered.

    // Monthly quota (0 = unlimited).
    if (t.plan.monthly_quota > 0 && monthToDateUsage(t.tenantId) >= t.plan.monthly_quota) {
      return res.status(429).json({ error: "Monthly quota exceeded", quota: t.plan.monthly_quota, plan: t.plan.id });
    }

    // Token bucket: refill continuously toward capacity.
    const cap = Math.max(1, t.plan.rate_per_min);
    const refillPerMs = cap / 60000;
    const now = Date.now();
    if (!buckets.has(t.tenantId)) evictIfNeeded(now);
    const b = buckets.get(t.tenantId) || { tokens: cap, last: now };
    b.tokens = Math.min(cap, b.tokens + (now - b.last) * refillPerMs);
    b.last = now;

    if (b.tokens < 1) {
      buckets.set(t.tenantId, b);
      res.setHeader("Retry-After", "1");
      return res.status(429).json({ error: "Rate limit exceeded", ratePerMin: cap, plan: t.plan.id });
    }
    b.tokens -= 1;
    buckets.set(t.tenantId, b);
    next();
  };
}
