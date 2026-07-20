// SONSUZ LOOP (~/Desktop/formüller.md iş akışı) — ortak-brain'in kendi kendini
// besleyen döngüsü. Her tur: zayıf-nokta sorusu üret → askShared (3 uzman, tek
// retrieval, MoE gate) → kalite kapısı → brain'e yaz → gate kalibre et → bakım.
// MacBook dostu: GPU meşgulse tur ATLANIR, tur-başı süre ve günlük yazım bütçeli,
// tek-örnek pid kilidi. Acil durdurma: BRAIN_LOOP=0. Elle tek tur: make brain-loop.
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const STATE_DIR = process.env.BRAIN_LOOP_DIR || join(homedir(), ".llm-mission-control");
const STATE_FILE = join(STATE_DIR, "loop-state.json");
const LOCK_FILE = join(STATE_DIR, "loop.lock");
const GATE_FILE = join(STATE_DIR, "gate.json");

export interface LoopState {
  turn: number;
  day: string;
  writesToday: number;
  askedHashes: string[];
  lastAt: number;
}

export function loadState(): LoopState {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const s = JSON.parse(readFileSync(STATE_FILE, "utf8")) as LoopState;
    return s.day === today ? s : { ...s, day: today, writesToday: 0 };
  } catch {
    return { turn: 0, day: today, writesToday: 0, askedHashes: [], lastAt: 0 };
  }
}

export function saveState(s: LoopState): void {
  try { mkdirSync(STATE_DIR, { recursive: true }); writeFileSync(STATE_FILE, JSON.stringify(s, null, 1)); } catch { /* best-effort */ }
}

/** Pure: bir kaydın içeriğinden öğrenme sorusu türet (LLM'siz, deterministik). */
export function questionFromRecord(content: string): string {
  const first = String(content).split(/[.\n]/)[0].trim();
  const subject = first.replace(/^[^']*'([^']+)'.*$/, "$1").slice(0, 80);
  return subject && subject !== first ? `${subject} nedir, ollamas'ta nasıl kullanılır?` : `${first.slice(0, 90)} — bu konuyu özetle`;
}

/** Pure: günlük yazım bütçesi ve tekrar-soru koruması. */
export function shouldAsk(state: LoopState, qHash: string, maxWrites: number): boolean {
  return state.writesToday < maxWrites && !state.askedHashes.includes(qHash);
}

const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);

async function main() {
  if (process.env.BRAIN_LOOP === "0") return;
  // Loop bir İSTEMCİdir: brain.db'yi doğrudan AÇMAZ, canlı :3000 API'sini kullanır.
  // Böylece paylaşımlı checkout'ta başka lane'in WIP'i (embed provider-id fingerprint
  // geçişi) loop'u düşürmez, WAL kilidi ve provider-mismatch yüzeyi sıfırlanır.
  const t0 = Date.now();
  const budgetMs = Number(process.env.BRAIN_LOOP_BUDGET_MS) || 90_000;
  const maxWrites = Number(process.env.BRAIN_LOOP_MAX_WRITES) || 40;

  // Tek örnek: eski kilit (>10dk) bayat sayılır, aksi halde bu tur atlanır.
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    if (existsSync(LOCK_FILE)) {
      const age = Date.now() - Number(readFileSync(LOCK_FILE, "utf8").split("|")[1] || 0);
      if (age < 600_000) { console.log(JSON.stringify({ event: "brain.loop", skipped: "locked" })); return; }
    }
    writeFileSync(LOCK_FILE, `${process.pid}|${Date.now()}`);
  } catch { /* kilit yazılamadıysa yine de devam */ }

  try {
    const { llmActive } = await import("../server/gpu-coordinator");
    if (llmActive()) { console.log(JSON.stringify({ event: "brain.loop", skipped: "gpu-busy" })); return; }

    const API = process.env.OLLAMAS_URL || "http://127.0.0.1:3000";
    const api = async (path: string, body?: unknown, ms = 30_000): Promise<any> => {
      const r = await fetch(`${API}${path}`, {
        method: body ? "POST" : "GET",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(ms),
      });
      if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
      return r.json();
    };
    const httpRecall = async (q: string, o: { k?: number; ns?: string } = {}) =>
      (await api("/api/brain/recall", { query: q, k: o.k ?? 5, ns: o.ns })).hits ?? [];
    const { askShared } = await import("../server/brain-shared");
    const { resolveDistillProvider } = await import("../server/brain-active");
    const { ProviderRouter } = await import("../server/providers");
    const { liveSystemContext } = await import("../server/brain-system");
    const { emptyGate } = await import("../server/brain-formulas");

    const state = loadState();
    state.turn++;

    // 1) Zayıf nokta: hiç recall edilmemiş (hits=0) en eski knowledge kaydı.
    const cold = await httpRecall("ollamas brain kod sistem", { k: 12, ns: "knowledge" });
    // Hedef seçimi ile bütçe kontrolü AYNI hash uzayında olmalı — aksi halde her tur
    // aynı kaydı seçip "tekrar" diye atlar (ilk canlı koşuda yakalandı).
    const candidates = cold.map((h: { content: string }) => questionFromRecord(h.content));
    const question = candidates.find((qq: string) => !state.askedHashes.includes(hash(qq))) || "";
    if (!question) { console.log(JSON.stringify({ event: "brain.loop", turn: state.turn, skipped: "no-fresh-target" })); saveState(state); return; }
    const qHash = hash(question);
    if (!shouldAsk(state, qHash, maxWrites)) {
      saveState(state);
      console.log(JSON.stringify({ event: "brain.loop", turn: state.turn, skipped: "budget-or-repeat", writesToday: state.writesToday }));
      return;
    }

    // 2) Ortak-brain: tek retrieval → üç uzman → gate.
    let gate = emptyGate(768);
    try { gate = JSON.parse(readFileSync(GATE_FILE, "utf8")); } catch { /* öğrenilmemiş */ }
    const gen = (provider: string, model?: string) => async (messages: { role: string; content: string }[]) =>
      (await ProviderRouter.generate({ provider, model: model || "openai", messages, stream: false } as any)).text || "";

    const askPromise = askShared(question, {
      recall: (q: string, o: any) => httpRecall(q, o),
      searchFacts: async () => [], // semantik fact araması HTTP yüzeyinde yok → widen atlanır
      namespaces: () => ["knowledge", "universe", "loop", "default", "research", "org"],
      liveContext: liveSystemContext,
      generate: gen(resolveDistillProvider(process.env)),
      gate,
      saveGate: (g) => { try { writeFileSync(GATE_FILE, JSON.stringify(g)); } catch { /* best-effort */ } },
      experts: {
        ollamas: gen(resolveDistillProvider(process.env)),
        // eCym yerel modeldir: GPU'yu chat LLM ile paylaşır → yalnız boştayken katılır.
        ecym: llmActive() ? undefined : gen("ollama-local", process.env.ECY_MODEL || "ecy"),
        odysseus: async (messages) => {
          const { ToolRegistry } = await import("../server/tool-registry");
          const out = await ToolRegistry.execute("mcp__odysseus__odysseus_chat",
            { prompt: messages[1].content, model: "ollamas-auto" }, { source: "brain-loop" } as any);
          return typeof out === "string" ? out : JSON.stringify(out).slice(0, 4000);
        },
      },
    } as any);
    // Tur bütçesi: askShared'ın kendi uzman-timeout'ları var; bu çit toplam turu bağlar.
    const r: any = await Promise.race([
      askPromise,
      new Promise<never>((_, rej) => {
        const t = setTimeout(() => rej(new Error(`loop turn exceeded ${budgetMs}ms`)), budgetMs);
        (t as { unref?: () => void }).unref?.();
      }),
    ]);

    // 3) Kalite kapısı → öğrenilen bilgi brain'e (ns=loop, conf 0.7).
    let wrote = false;
    if (!r.abstained && r.sources.length >= 2 && r.answer.length > 40) {
      await api("/api/brain/remember", {
        id: `loop:${qHash}`, tier: "learned", ns: "loop", actor: r.expert || "loop",
        confidence: 0.7, source: "brain-loop",
        content: `S: ${question}\nY(${r.expert}): ${r.answer.slice(0, 1200)}`,
      });
      wrote = true;
      state.writesToday++;
    }
    state.askedHashes = [...state.askedHashes, qHash].slice(-500);
    state.lastAt = Date.now();
    saveState(state);

    // 4) Bakım: her 4 turda backfill + ekosistem senkronu (üç sistem güncel kalır).
    if (state.turn % 4 === 0 && Date.now() - t0 < budgetMs) {
      // Bakım canlı sürecin işi (store sahibi o) — loop yalnız tetikleyici olabilir;
      // burada sadece ekosistem senkronu koşar.
      try {
        const { execFileSync } = await import("node:child_process");
        execFileSync("npx", ["tsx", "scripts/ecosystem-sync.ts"], { timeout: 30_000, stdio: "ignore" });
      } catch { /* senkron best-effort */ }
    }

    console.log(JSON.stringify({
      event: "brain.loop", turn: state.turn, question: question.slice(0, 70), expert: r.expert,
      weights: r.weights, sources: r.sources.length, confidence: r.confidence, degraded: r.degraded,
      wrote, writesToday: state.writesToday, ms: Date.now() - t0,
    }));
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    // 503/meşgul geçici bir DURUM, hata değil: tur sessizce atlanır, 15 dk sonra
    // tekrar denenir (canlı ilk otomatik turda yakalandı).
    const kind = /HTTP 503|embedder busy/i.test(msg) ? "embedder-busy"
      : /provider mismatch/i.test(msg) ? "embed-provider-mismatch"
      : /timed out|exceeded/i.test(msg) ? "budget"
      : /HTTP 5\d\d|fetch failed|ECONNREFUSED/i.test(msg) ? "server-unavailable"
      : "error";
    console.warn(JSON.stringify({ event: "brain.loop", [kind === "error" ? "error" : "skipped"]: kind, detail: msg.slice(0, 160) }));
  } finally {
    try { unlinkSync(LOCK_FILE); } catch { /* zaten yok */ }
    // Kusursuz loop şartı: iş bitince SÜREÇ de biter. Yarıda kalan sağlayıcı
    // fetch'leri (ollama stall-retry gibi) event-loop'u dakikalarca açık tutuyordu —
    // launchd her 15dk yeni süreç açsaydı süreçler birikirdi. İş bitti, çık.
    if (process.env.BRAIN_LOOP_NO_EXIT !== "1") setTimeout(() => process.exit(0), 50).unref?.();
  }
}

if (process.argv[1]?.includes("brain-loop")) void main();
