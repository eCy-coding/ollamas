// Canonical provider identifiers the gateway routes to. Single source of truth so
// shell completion (-p/--provider), the chat/agent/bench flags, and docs agree.
// Mirrors the server's provider fallback chain (server/providers.ts).
export const PROVIDERS = ["ollama-local", "openrouter", "gemini", "gemini-cli", "openai", "ollama-cloud", "demo"] as const;
export type Provider = (typeof PROVIDERS)[number];
