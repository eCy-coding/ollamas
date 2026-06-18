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
