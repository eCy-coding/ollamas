// Structured logging (Faz 9D). pino — JSON logs with levels; LOG_LEVEL controls
// verbosity (default info). Replaces ad-hoc console.log for operational events.
import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: { service: "ollamas" },
});
