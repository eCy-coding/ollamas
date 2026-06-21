// MCP resource subscription registry. Watches individual workspace files and
// fires onUpdate after a short debounce so the MCP server can push
// notifications/resources/updated to the connected client.
//
// WHY fs.watch: macOS FSEvents (via fs.watch) is kernel-level, efficient, zero
// extra deps. WHY debounce: editors (VS Code, vim) issue multiple write events
// per save (truncate + write + rename); coalescing to 150 ms delivers one
// notification per user-save instead of a burst.

import * as fs from "node:fs";
import { FilesystemManager } from "../files";

interface Entry {
  watcher: fs.FSWatcher;
  timer?: NodeJS.Timeout;
}

export class SubscriptionRegistry {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly workspaceRoot: string,
    private readonly onUpdate: (uri: string) => void
  ) {}

  subscribe(uri: string): void {
    if (this.entries.has(uri)) return; // idempotent

    // file:// URIs on POSIX produce a leading slash after stripping the scheme,
    // giving an absolute path. resolveSafePath expects a path relative to the
    // workspace root, so strip the leading slash to make it relative.
    const stripped = uri.replace(/^file:\/\//, "");
    const rel = stripped.startsWith("/") ? stripped.slice(1) : stripped;
    // resolveSafePath throws on path traversal — let it propagate to the caller
    const absPath = FilesystemManager.resolveSafePath(this.workspaceRoot, rel);

    // Throw early if file doesn't exist (fs.watch may silently succeed on some
    // platforms then never fire, giving the caller a false sense of success).
    if (!fs.existsSync(absPath)) {
      throw new Error(`Resource not found: ${absPath}`);
    }

    let entry: Entry;
    try {
      const watcher = fs.watch(absPath, () => {
        const existing = this.entries.get(uri);
        if (!existing) return;
        if (existing.timer) clearTimeout(existing.timer);
        existing.timer = setTimeout(() => {
          existing.timer = undefined;
          this.onUpdate(uri);
        }, 150);
      });
      entry = { watcher };
    } catch (err: any) {
      throw new Error(`Cannot watch ${absPath}: ${err?.message || err}`);
    }

    this.entries.set(uri, entry);
  }

  unsubscribe(uri: string): void {
    const entry = this.entries.get(uri);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.watcher.close();
    this.entries.delete(uri);
  }

  dispose(): void {
    for (const [uri] of this.entries) {
      this.unsubscribe(uri);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
