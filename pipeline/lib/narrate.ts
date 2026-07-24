// Algorithm narration (pure) — why the pipeline did what it did, in Turkish.
//
// WHY THIS EXISTS
// The board shows steps advancing; it does not show REASONING. Which wave ran concurrently
// and why, which dependency forced an order, which gate decided, why `go_ahead` came back
// false — all of that lived only in the JSON artefact. The operator asked to watch the
// algorithms flow, not just the output.
//
// Turkish because that is the language the operator reads; the numbers stay numbers.
// Everything here is derived from data the run already produced (`dag.batches`, gate
// results, the self-audit) — nothing is recomputed, and nothing is asserted that was not
// measured.
import type { Batch, Pipeline } from "./dag";
import type { GateResult, Decision } from "./gates";
import type { AuditResult } from "./audit";

export interface NarrationLine {
  kind: "plan" | "wave" | "step" | "gate" | "decision" | "audit";
  text: string;
}

/** How the DAG will run: which waves overlap, and what that buys. */
export function narratePlan(p: Pipeline, batches: Batch[], parallelism: number): NarrationLine[] {
  const out: NarrationLine[] = [
    { kind: "plan", text: `Plan: ${p.steps.length} adım, ${batches.length} dalga, paralellik ${parallelism}×.` },
    {
      kind: "plan",
      text: "Bağımlılıklar elle yazılmadı — her adımın girdi/çıktı anahtarlarından türetildi; " +
        "bir anahtarı üreten adım yoksa bu hata sayılır, sessizce atlanmaz.",
    },
  ];
  for (const b of batches) {
    if (b.parallel.length > 1) {
      out.push({
        kind: "wave",
        text: `L${b.level}: ${b.parallel.length} adım EŞZAMANLI — ${b.parallel.join(" ∥ ")}. ` +
          "Aralarında veri bağı yok ve hiçbiri paylaşılan dosya yazmıyor.",
      });
    } else if (b.parallel.length === 1) {
      out.push({ kind: "wave", text: `L${b.level}: ${b.parallel[0]} (tek başına, eşzamanlı işaretli).` });
    }
    for (const s of b.serial) {
      out.push({ kind: "wave", text: `L${b.level}: ${s} — sıralı; öncekinin başarısını varsayıyor.` });
    }
  }
  return out;
}

const STEP_TR: Record<string, string> = {
  search: "bilgi topla", think: "sentezle", analyze: "boşlukları çıkar", plan: "plan üret",
  todo: "görev panosuna yaz", sandbox_test: "izole kutuda koştur", test: "testleri koştur",
  true_or_false: "ikili karar", chaos_test: "arıza enjekte et", security_scan: "güvenlik tara",
  coverage_check: "kapsam ölç", code: "kod öner", merge: "birleştir (kuru)",
  commit: "commit (kuru)", push: "push (kapılı)",
};

export function narrateStep(id: string, action: string, ok: boolean, ms: number, degraded?: boolean): NarrationLine {
  const what = STEP_TR[action] ?? action;
  const mark = ok ? "✓" : "✗";
  const note = degraded ? " — servise ulaşılamadı, dürüst degrade (uydurma yok)" : "";
  return { kind: "step", text: `${mark} ${id} · ${what} · ${ms} ms${note}` };
}

/**
 * Gate results as sentences.
 *
 * A `MISS` is spelled out as "ölçülmedi", never as a pass and never as a failure of the
 * system — the distinction between "we looked and it was bad" and "we never looked" is the
 * one this pipeline refuses to blur.
 */
export function narrateGates(gates: GateResult[]): NarrationLine[] {
  return gates.map((g) => {
    if (g.measured === null) {
      return { kind: "gate", text: `• ${g.name}: ÖLÇÜLMEDİ (sınır ${g.limit}) — geçti sayılmaz, kaldı da sayılmaz.` };
    }
    return {
      kind: "gate",
      text: `${g.ok ? "✓" : "✗"} ${g.name}: ${g.measured} / sınır ${g.limit}${g.ok ? "" : " — SINIR AŞILDI"}`,
    };
  });
}

/** Why the binary decision came out the way it did, including the weak-evidence caveat. */
export function narrateDecision(d: Decision): NarrationLine[] {
  const out: NarrationLine[] = [];
  if (d.go_ahead) {
    out.push({ kind: "decision", text: "Karar: GEÇ — yedi kapının hepsi sağlandı." });
  } else {
    out.push({
      kind: "decision",
      text: `Karar: GEÇME — ${d.failed.length} kapı düştü: ${d.failed.join(", ")}.`,
    });
  }
  if (d.weak_evidence) {
    out.push({
      kind: "decision",
      text: "Uyarı: kanıt ZAYIF (koşu sayısı 3'ten az ya da değişkenlik yüksek). " +
        "Kapılar gevşetilmedi; yalnız bu yeşilin tek koşuya dayandığı işaretlendi.",
    });
  }
  return out;
}

/** Self-audit gaps: what the run never exercised, and why that downgrades it. */
export function narrateAudit(a: AuditResult): NarrationLine[] {
  if (a.complete) {
    return [{ kind: "audit", text: `Öz-denetim ${a.score}: kör nokta yok.` }];
  }
  return [
    { kind: "audit", text: `Öz-denetim ${a.score} — eksik: ${a.missing.join(", ")}.` },
    {
      kind: "audit",
      text: "Bu yüzden koşu 'incomplete' sayıldı: SLO'lar geçse bile kanıtlanmamış bir yetenek, " +
        "çalıştığı varsayılan bir yetenektir.",
    },
    ...a.todo.slice(0, 4).map((t) => ({ kind: "audit" as const, text: `  → ${t.id} [${t.owner}] ${t.description}` })),
  ];
}

const KIND_MARK: Record<NarrationLine["kind"], string> = {
  plan: "▸", wave: "│", step: " ", gate: "│", decision: "■", audit: "▪",
};

/** Render for the tab: a left rule so nested detail is scannable without colour. */
export function renderNarration(lines: NarrationLine[]): string[] {
  return lines.map((l) => `${KIND_MARK[l.kind]} ${l.text}`);
}

/** Section header used between phases in the ALGORİTMA tab. */
export function section(title: string): string[] {
  return ["", `── ${title} ${"─".repeat(Math.max(0, 60 - title.length))}`, ""];
}
