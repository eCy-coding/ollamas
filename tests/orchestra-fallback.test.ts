// L54 — the deterministic summary that rescues a weak synthesis.
//
// The $0 model keeps ignoring its own command output — "sistem yükü" gets `ps` with node at
// 184.7% and the answer still says "could be assumed". The grounding guardrail correctly
// withholds that from the brain, but then the task has no answer at all. For the common machine
// questions the answer is right there in the output; these parse it directly — $0, deterministic,
// model-independent — so a weak synthesis still yields a grounded, citable conclusion.
import { describe, test, expect } from "vitest";
import { deterministicSummary, summariseFromSteps } from "../server/orchestra-fallback";
import { gradeGrounding } from "../server/orchestra-grounding";
import { synthesizeTask, type SynthesisSource } from "../server/orchestra-synthesis";
import type { StepResult } from "../server/orchestra-tasks";

describe("deterministicSummary parsers", () => {
  test("df → the fullest volume by capacity", () => {
    const s = deterministicSummary("df -h",
      "Filesystem Size Used Avail Capacity Mounted on\n/dev/disk3s5 926Gi 608Gi 262Gi 70% /System/Volumes/Data\n/dev/disk1 500Mi 6Mi 480Mi 2% /boot")!;
    expect(s).toContain("%70");
    expect(s).toContain("/System/Volumes/Data");
    expect(s).toContain("[mem:step:command]");
  });

  test("ps by %cpu → the top process, name without path", () => {
    const s = deterministicSummary("ps -A -o pid,%cpu,comm -r", "80515 184.7 /usr/local/bin/node\n4675 98.1 next-server")!;
    expect(s).toContain("node");
    expect(s).toContain("184.7");
    expect(s).not.toContain("/usr/local/bin"); // path stripped to the binary name
  });

  test("ps by %mem is labelled memory, not cpu", () => {
    const s = deterministicSummary("ps -A -o pid,%mem,comm -m", "80515 12.4 chrome\n4675 3.1 node")!;
    expect(s).toContain("bellek");
    expect(s).toContain("chrome");
    expect(s).toContain("12.4");
  });

  test("uptime → 1/5/15 load averages, correctly ordered", () => {
    const s = deterministicSummary("uptime", "18:23 up 5 days, 28 users, load averages: 40.02 33.74 24.89")!;
    expect(s).toContain("1 dk: 40.02");
    expect(s).toContain("5 dk: 33.74");
    expect(s).toContain("15 dk: 24.89");
  });

  test("pwd and hostname", () => {
    expect(deterministicSummary("pwd", "/Users/emre/Desktop/ollamas")).toContain("/Users/emre/Desktop/ollamas");
    expect(deterministicSummary("hostname", "MacBook-Pro.local")).toContain("MacBook-Pro.local");
  });

  test("an unrecognised command returns null — no invented answer", () => {
    expect(deterministicSummary("cat foo", "bar")).toBeNull();
    expect(deterministicSummary("git log", "commit abc")).toBeNull();
    expect(deterministicSummary("", "x")).toBeNull();
    expect(deterministicSummary("df -h", "")).toBeNull();
  });

  test("every summary it produces is itself grounded", () => {
    // The whole point: the fallback answer must pass the same guardrail the model failed.
    const src: SynthesisSource[] = [{ id: "step:command", tier: "working", distance: 0, score: 1, createdAt: 0,
      content: "[command] ps\n80515 184.7 node" }];
    const det = deterministicSummary("ps -A -o pid,%cpu,comm -r", "80515 184.7 node")!;
    expect(gradeGrounding(det, src).weak).toBe(false);
  });
});

describe("summariseFromSteps — the multi-command case", () => {
  test("two commands from a follow-up round are both summarised", () => {
    const s = summariseFromSteps([
      { role: "command", invocation: "uptime", output: "load averages: 40.02 33.74 24.89", ok: true },
      { role: "command", invocation: "ps -A -o pid,%cpu,comm -r", output: "80515 184.7 node", ok: true },
    ])!;
    expect(s).toContain("40.02");   // the load half
    expect(s).toContain("node");    // the responsible-process half
  });

  test("failed and gated steps are ignored", () => {
    expect(summariseFromSteps([
      { role: "command", invocation: "df -h", output: "err", ok: false },
      { role: "command", invocation: "df -h", output: "x", ok: true, gated: true },
    ])).toBeNull();
  });

  test("non-command steps never contribute", () => {
    expect(summariseFromSteps([{ role: "vault", invocation: "q", output: "notlar", ok: true }])).toBeNull();
  });
});

describe("synthesizeTask · fallback wiring", () => {
  const step = (invocation: string, output: string): StepResult =>
    ({ role: "command", invocation, ok: true, ms: 4, output });

  test("a weak model answer is replaced by the deterministic summary and marked so", async () => {
    // The model hedges; the command output has the real figure.
    const r = await synthesizeTask("sistem yükü ve hangi işlem", [step("ps -A -o pid,%cpu,comm -r", "80515 184.7 node")], {
      generate: async () => "Sorumlu süreç genellikle CPU yoğun işlemlerdir, varsayılabilir.",
      experts: { ollamas: async () => "Sorumlu süreç genellikle CPU yoğun işlemlerdir, varsayılabilir." },
    } as any);
    expect(r!.grounding!.weak).toBe(false);          // rescued
    expect(r!.grounding!.via).toBe("deterministic");
    expect(r!.answer).toContain("node");
    expect(r!.answer).toContain("184.7");
  });

  test("a grounded model answer is kept — fallback is not invoked", async () => {
    const r = await synthesizeTask("disk doluluk", [step("df -h", "/dev/disk3s5 926Gi 608Gi 262Gi 70% /Data")], {
      generate: async () => "Disk %70 dolu, 608Gi/926Gi [mem:step:command]",
      experts: { ollamas: async () => "Disk %70 dolu, 608Gi/926Gi [mem:step:command]" },
    } as any);
    expect(r!.grounding!.via).toBe("model");
    expect(r!.answer).toContain("%70");
  });

  test("a weak answer with an unparseable command stays honestly weak", async () => {
    const r = await synthesizeTask("git durumu", [step("git status", "on branch main")], {
      generate: async () => "Durum genellikle temizdir, varsayılabilir.",
      experts: { ollamas: async () => "Durum genellikle temizdir, varsayılabilir." },
    } as any);
    expect(r!.grounding!.weak).toBe(true);
    expect(r!.grounding!.via).toBe("model");
  });
});
