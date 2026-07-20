// src/lib/streamStore.ts — module-level stream store (v19).
//
// BUG: App.tsx mounts ChatPanel/AssistDrawer conditionally on the active tab.
// Switching tabs unmounts the panel, which used to own ALL conversation/stream
// state in component `useState` — the in-flight SSE (and everything already
// streamed) was orphaned and lost the moment the component unmounted.
//
// FIX: state lives here, keyed by a stable id (`chat:<sessionId>` /
// `assist:<panelId>`), NOT inside the component. The stream body (fetch +
// SSE parse + watchdog) keeps running with zero subscribers; a remounted
// component just re-subscribes to the same key and sees whatever accumulated
// while it was gone.
//
// Framework-agnostic core (KeyedStore, startChatStream/startAssistStream) +
// a thin useSyncExternalStore-based hook per domain.

import { useCallback, useSyncExternalStore } from "react";
import { api } from "./apiClient";
import { stripThink, type ArithResult } from "./certainty";

// ── generic core ────────────────────────────────────────────────────────────

type Listener = () => void;

interface Entry<T> {
  state: T;
  listeners: Set<Listener>;
  running: boolean; // an underlying api.streamPost is currently in flight for this key
  controller: AbortController | null;
}

export class KeyedStore<T> {
  private entries = new Map<string, Entry<T>>();

  constructor(private makeDefault: () => T) {}

  private entry(key: string): Entry<T> {
    let e = this.entries.get(key);
    if (!e) {
      e = { state: this.makeDefault(), listeners: new Set(), running: false, controller: null };
      this.entries.set(key, e);
    }
    return e;
  }

  // Stable reference until the next patch()/set() — required so
  // useSyncExternalStore doesn't loop (same snapshot in ⇒ no re-render).
  getSnapshot = (key: string): T => this.entry(key).state;

  subscribe = (key: string, cb: Listener): (() => void) => {
    const e = this.entry(key);
    e.listeners.add(cb);
    return () => { e.listeners.delete(cb); };
  };

  private notify(e: Entry<T>): void {
    e.listeners.forEach((cb) => cb());
  }

  patch(key: string, partial: Partial<T>): void {
    const e = this.entry(key);
    e.state = { ...e.state, ...partial };
    this.notify(e);
  }

  set(key: string, state: T): void {
    const e = this.entry(key);
    e.state = state;
    this.notify(e);
  }

  isRunning(key: string): boolean {
    return this.entry(key).running;
  }

  beginRun(key: string, controller: AbortController): void {
    const e = this.entry(key);
    e.running = true;
    e.controller = controller;
  }

  endRun(key: string): void {
    const e = this.entries.get(key);
    if (!e) return;
    e.running = false;
    e.controller = null;
  }

  // Explicit user cancel ONLY — never called on unmount. apiClient.streamPost
  // already resolves quietly (no throw) when its signal is aborted.
  abort(key: string): void {
    this.entries.get(key)?.controller?.abort();
  }

  clear(key: string): void {
    this.abort(key);
    this.entries.delete(key);
  }

  // Move an entry to a new key (chat:new → chat:<id> once the session is
  // created). Assumes newKey has no existing entry/subscribers yet.
  rename(oldKey: string, newKey: string): void {
    const e = this.entries.get(oldKey);
    if (!e) return;
    this.entries.delete(oldKey);
    this.entries.set(newKey, e);
  }

  // Test-only: module-level singletons need isolation between test cases.
  clearAll(): void {
    this.entries.forEach((e) => e.controller?.abort());
    this.entries.clear();
  }
}

// ── SSE frame parsing — copied 1:1 from the former ChatPanel/AssistDrawer
// onChunk handlers (split on "\n\n", "data:" prefix, JSON.parse the rest,
// swallow partial frames) so behavior is byte-for-byte identical. ─────────
function feedSSE(bufRef: { buf: string }, chunkText: string, onFrame: (f: Record<string, unknown>) => void): void {
  bufRef.buf += chunkText;
  const parts = bufRef.buf.split("\n\n");
  bufRef.buf = parts.pop() ?? "";
  for (const part of parts) {
    const line = part.trim();
    if (!line.startsWith("data:")) continue;
    try {
      onFrame(JSON.parse(line.slice(5).trim()) as Record<string, unknown>);
    } catch { /* partial frame — wait for more text */ }
  }
}

// ── chat domain ──────────────────────────────────────────────────────────

export interface ChatMsg {
  id: string;
  role: "user" | "assistant" | string;
  content: string;
  timestamp: string;
  certain?: ArithResult;
  slow?: boolean;
  // v20 — silent model substitution (honesty defect): the router can fall through its
  // provider chain and answer with something other than what was requested (e.g.
  // ecy:latest failed to load, cloud:gemini answered instead) with zero indication.
  // The `done` SSE frame already carries the real `source`; these fields surface it
  // per-message so the UI can render an honest provenance warning instead of silently
  // presenting a substituted answer as if it came from the requested model.
  servedBy?: string; // actual `source` that answered (e.g. "ollama_local", "cloud:gemini") — undefined if the done frame carried none
  latencyMs?: number;
  requestedModel?: string; // the model selected when THIS message was sent (may differ from the panel's current selection later)
  substituted?: boolean; // true only when servedBy is known AND differs from the requested provider — never true on unknown provenance
}

export interface ChatStreamState {
  messages: ChatMsg[];
  streaming: boolean;
  error: string;
  tokS: number | null;
}

export const chatStreamStore = new KeyedStore<ChatStreamState>(() => ({
  messages: [],
  streaming: false,
  error: "",
  tokS: null,
}));

// ── provenance comparison ───────────────────────────────────────────────────
// Requested provider ids use hyphens ("ollama-local"); the router's `source` field
// (server.ts POST /api/generate) uses underscores for the same local case
// ("ollama_local") but "tier:detail" for everything else (e.g. "cloud:gemini",
// "fleet:worker1", "demo"). Normalize hyphen/underscore ONLY — a colon-prefixed
// source is a genuinely different provider and must read as a mismatch.
function normalizeProviderId(id: string): string {
  return id.replace(/-/g, "_");
}

// Undefined/empty source (done frame carried none) is treated as "not substituted" —
// we have no evidence a substitution happened, and flagging every message on a missing
// field would be its own kind of dishonesty (false alarm on the happy path).
function isSubstitutedProvider(servedBy: string | undefined, requestedProvider: string): boolean {
  if (!servedBy) return false;
  return normalizeProviderId(servedBy) !== normalizeProviderId(requestedProvider);
}

// ChatPanel's key (`chat:<sessionId ?? "new">`) depends on component-chosen
// state (which session is open), unlike AssistDrawer's key which is a stable
// prop (`panelId`). A plain useState for sessionId would reset to null on
// remount, orphaning the reconnect. This module-level pointer is the same
// "survive unmount" fix applied to the one extra bit of state that decides
// WHICH store key to read.
let activeChatSessionId: string | null = null;
export function getActiveChatSessionId(): string | null { return activeChatSessionId; }
export function setActiveChatSessionId(id: string | null): void { activeChatSessionId = id; }

export interface StartChatOpts {
  key: string;
  base: ChatMsg[]; // conversation history to send (role/content), WITHOUT the draft
  draftId: string;
  provider: string;
  model: string;
  onDone?: (finalMessages: ChatMsg[], tokS: number | null) => void;
  onError?: (message: string) => void;
}

const CHAT_TIMEOUT_MS = 120_000;
const CHAT_SLOW_MS = 8_000;

// Idempotent: if a stream is already running for `key`, this is a no-op.
// The caller is expected to have already painted the optimistic
// [...base, draft] into the store (chatStreamStore.set) before calling this.
export function startChatStream(opts: StartChatOpts): void {
  const { key, base, draftId, provider, model, onDone, onError } = opts;
  if (chatStreamStore.isRunning(key)) return;

  const controller = new AbortController();
  chatStreamStore.beginRun(key, controller);
  chatStreamStore.patch(key, { streaming: true, error: "", tokS: null });

  const started = Date.now();
  let firstChunk = false;
  let acc = "";
  let servedBy: string | undefined;
  let servedLatencyMs: number | undefined;
  const bufRef = { buf: "" };

  // GPU-busy watchdog: if no first chunk in 8s, flag the draft as slow (queued).
  const slowTimer = setTimeout(() => {
    if (!firstChunk) {
      const cur = chatStreamStore.getSnapshot(key);
      chatStreamStore.patch(key, {
        messages: cur.messages.map((m) => (m.id === draftId ? { ...m, slow: true } : m)),
      });
    }
  }, CHAT_SLOW_MS);

  void (async () => {
    try {
      // Hard ceiling so a saturated GPU can't hang the UI forever. Also aborts
      // the underlying fetch (the original component-owned version didn't —
      // a small hardening: without it a chunk that arrives AFTER the timeout
      // error was already shown could resurrect the "failed" message).
      const timeout = new Promise<never>((_, rej) => {
        setTimeout(() => {
          controller.abort();
          rej(new Error("model timed out after 120s (GPU busy) — try again"));
        }, CHAT_TIMEOUT_MS);
      });
      await Promise.race([timeout, api.streamPost("/api/generate", {
        provider,
        model,
        stream: true,
        messages: base.map((m) => ({ role: m.role, content: m.content })),
      }, {
        signal: controller.signal,
        onChunk: (t: string) => feedSSE(bufRef, t, (f) => {
          if (controller.signal.aborted) return; // explicit cancel — stop applying frames
          if (f.chunk) {
            firstChunk = true;
            acc += String(f.chunk);
            const cur = chatStreamStore.getSnapshot(key);
            chatStreamStore.patch(key, {
              messages: cur.messages.map((m) => (m.id === draftId ? { ...m, content: acc, slow: false } : m)),
            });
          } else if (f.error) {
            // informational — original behavior does NOT stop the stream on an error frame
            chatStreamStore.patch(key, { error: String(f.error) });
          } else if (f.done) {
            // terminal frame — server.ts always writes { done: true, source, latencyMs };
            // tolerate either field missing rather than crashing on an unexpected shape.
            if (typeof f.source === "string") servedBy = f.source;
            if (typeof f.latencyMs === "number") servedLatencyMs = f.latencyMs;
          }
        }),
      })]);
      const secs = (Date.now() - started) / 1000;
      const tokS = acc && secs > 0 ? Math.round(acc.length / 4 / secs) : null; // ~4 chars/token estimate
      const substituted = isSubstitutedProvider(servedBy, provider);
      const cur = chatStreamStore.getSnapshot(key);
      const finalMessages = cur.messages.map((m) => (m.id === draftId
        ? { ...m, content: acc, servedBy, latencyMs: servedLatencyMs, requestedModel: model, substituted }
        : m));
      chatStreamStore.set(key, { messages: finalMessages, streaming: false, error: cur.error, tokS });
      onDone?.(finalMessages, tokS);
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      const cur = chatStreamStore.getSnapshot(key);
      const withoutDraft = cur.messages.filter((m) => m.id !== draftId); // honest state — drop the empty draft
      chatStreamStore.set(key, { messages: withoutDraft, streaming: false, error: msg, tokS: cur.tokS });
      onError?.(msg);
    } finally {
      clearTimeout(slowTimer);
      chatStreamStore.endRun(key);
    }
  })();
}

// ── assist domain ────────────────────────────────────────────────────────

export interface AssistStreamState {
  text: string;
  streaming: boolean;
  error: string;
}

export const assistStreamStore = new KeyedStore<AssistStreamState>(() => ({
  text: "",
  streaming: false,
  error: "",
}));

export interface StartAssistOpts {
  key: string;
  endpoint: string;
  context: string;
}

const ASSIST_TIMEOUT_MS = 90_000;

export function startAssistStream(opts: StartAssistOpts): void {
  const { key, endpoint, context } = opts;
  if (assistStreamStore.isRunning(key)) return;

  const controller = new AbortController();
  assistStreamStore.beginRun(key, controller);
  assistStreamStore.set(key, { text: "", streaming: true, error: "" });

  let acc = "";
  const bufRef = { buf: "" };

  void (async () => {
    try {
      // Honest hard ceiling: on a saturated single GPU the specialist may
      // never get a slot — fail with a clear message instead of hanging.
      const timeout = new Promise<never>((_, rej) => {
        setTimeout(() => {
          controller.abort();
          rej(new Error("model 90sn'de yanıt vermedi (GPU meşgul) — sonra tekrar dene"));
        }, ASSIST_TIMEOUT_MS);
      });
      await Promise.race([timeout, api.streamPost(endpoint, { context }, {
        signal: controller.signal,
        onChunk: (t: string) => feedSSE(bufRef, t, (f) => {
          if (controller.signal.aborted) return;
          if (f.chunk) {
            acc += String(f.chunk);
            assistStreamStore.patch(key, { text: stripThink(acc).visible });
          } else if (f.error) {
            assistStreamStore.patch(key, { error: String(f.error) });
          }
        }),
      })]);
      assistStreamStore.patch(key, { streaming: false });
    } catch (e) {
      assistStreamStore.patch(key, { error: String((e as Error)?.message || e), streaming: false });
    } finally {
      assistStreamStore.endRun(key);
    }
  })();
}

// ── React bindings ──────────────────────────────────────────────────────

function useKeyedSnapshot<T>(store: KeyedStore<T>, key: string): T {
  const subscribe = useCallback((cb: () => void) => store.subscribe(key, cb), [store, key]);
  const getSnapshot = useCallback(() => store.getSnapshot(key), [store, key]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useChatStream(key: string): ChatStreamState {
  return useKeyedSnapshot(chatStreamStore, key);
}

export function useAssistStream(key: string): AssistStreamState {
  return useKeyedSnapshot(assistStreamStore, key);
}

// ── test support ─────────────────────────────────────────────────────────

/** Test-only: wipe both stores + the active-session pointer. Module-level
 *  singletons need explicit isolation between test cases. */
export function __resetStreamStoresForTests(): void {
  chatStreamStore.clearAll();
  assistStreamStore.clearAll();
  activeChatSessionId = null;
}
