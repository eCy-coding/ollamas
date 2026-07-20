// İzin-test planı — "verdiğim izinlerle yapılabilecekleri test et".
//
// GÜVENLİK SÖZLEŞMESİ: gated sınıflar (dışa-iletim, sistem-değişiklik) test amaçlı
// BİLE çalışmaz. mutate-local yalnız açık flag'le. launch varsayılanda açmaz.
import { describe, test, expect } from "vitest";
import { planProbe, type ProbePlan } from "../server/permission-probe";
import { defaultPolicy, type AgentPolicy } from "../server/agent-policy";
import type { AppCard } from "../server/app-literacy";

const op = (opId: string, riskClass: any, cmd: string, verify?: any) =>
  ({ opId, riskClass, triggers: [opId], cmd, arg: "yok", desc: "d", level: "baslangic" as const, verify });

const card = (app: string, ops: any[]): AppCard =>
  ({ rank: 1, app, scriptable: true, category: "x", purpose: "p", capabilities: [], drive: [], ops });

const CARDS: AppCard[] = [
  card("Ollama", [op("ollama.list", "inspect", "ollama list")]),
  card("Google Chrome", [op("chrome.tabs", "read", `osascript -e 'tell application "Google Chrome" to get URL of tabs'`, "compile")]),
  card("DaVinci Resolve", [op("resolve.open", "launch", `open -a "DaVinci Resolve"`, "appExists")]),
  card("Notes", [op("notes.new", "mutate-local", `osascript -e 'tell application "Notes" to make new note'`, "compile")]),
  card("Mail", [op("mail.draft", "communicate-outward", `osascript -e 'tell application "Mail" to make new outgoing message'`, "compile")]),
  card("System Settings", [op("settings.tcc", "system-change", `open "x-apple.systempreferences:"`)]),
];

const wide: AgentPolicy = {
  ...defaultPolicy(),
  classes: { inspect: "auto", launch: "auto", read: "auto", "mutate-local": "auto", "communicate-outward": "gated", "system-change": "gated" },
};

const byId = (plan: ProbePlan[], id: string) => plan.find((p) => p.opId === id)!;

describe("planProbe — Emre'nin gerçek politikası (4 auto, 2 gated)", () => {
  test("inspect (auto, GUI-risksiz) → RUN", () => {
    expect(byId(planProbe(CARDS, wide, {}), "ollama.list").action).toBe("run");
  });

  test("read (auto, osascript) → compile (RUN değil, flag'siz)", () => {
    // osascript ilk çalıştırmada TCC dialog'u tetikler; harness veremez.
    expect(byId(planProbe(CARDS, wide, {}), "chrome.tabs").action).toBe("compile");
  });

  test("read → runReads flag'iyle RUN olur", () => {
    expect(byId(planProbe(CARDS, wide, { runReads: true }), "chrome.tabs").action).toBe("run");
  });

  test("launch → varsayılanda appExists (91 app açmaz)", () => {
    expect(byId(planProbe(CARDS, wide, {}), "resolve.open").action).toBe("appExists");
  });

  test("mutate-local (auto) → flag'siz compile (yan etki üretmez)", () => {
    // Politika auto verse bile TEST amaçlı state değiştirmemeli.
    expect(byId(planProbe(CARDS, wide, {}), "notes.new").action).toBe("compile");
  });

  test("mutate-local → runMutations flag'iyle RUN", () => {
    expect(byId(planProbe(CARDS, wide, { runMutations: true }), "notes.new").action).toBe("run");
  });

  test("GATED sınıflar ASLA run olmaz — flag'ler DAHİL", () => {
    const all = planProbe(CARDS, wide, { runReads: true, runMutations: true, launchSample: 99 });
    expect(byId(all, "mail.draft").action).not.toBe("run");
    expect(byId(all, "settings.tcc").action).not.toBe("run");
    // dışa-iletim/sistem: değişmez güvenlik sınırı
    expect(["compile", "appExists", "skip"]).toContain(byId(all, "mail.draft").action);
  });
});

describe("planProbe — politika kısıtlıysa", () => {
  test("varsayılan politika (hiçbir şey auto değil) → inspect bile RUN olmaz", () => {
    const plan = planProbe(CARDS, defaultPolicy(), {});
    // inspect gated → çalıştırma, ama zararsız olduğu için compile/appExists/skip
    expect(byId(plan, "ollama.list").action).not.toBe("run");
    expect(byId(plan, "ollama.list").decision).toBe("gated");
  });

  test("deny sınıfı → skip", () => {
    const denyPol: AgentPolicy = { ...defaultPolicy(), classes: { ...defaultPolicy().classes, inspect: "deny" } };
    expect(byId(planProbe(CARDS, denyPol, {}), "ollama.list").action).toBe("skip");
  });
});

describe("planProbe — her op için karar + sebep var", () => {
  test("plan tüm op'ları kapsar, her birinde decision ve reason", () => {
    const plan = planProbe(CARDS, wide, {});
    expect(plan.length).toBe(CARDS.length); // her op bir plan satırı
    for (const p of plan) {
      expect(["run", "compile", "appExists", "skip"]).toContain(p.action);
      expect(p.reason.length).toBeGreaterThan(0);
    }
  });

  test("launchSample>0 ilk N launch op'unu run yapar", () => {
    const many = Array.from({ length: 4 }, (_, i) => card(`App${i}`, [op(`a${i}.open`, "launch", `open -a "App${i}"`, "appExists")]));
    const plan = planProbe(many, wide, { launchSample: 2 });
    const runs = plan.filter((p) => p.tier === "launch" && p.action === "run");
    expect(runs.length).toBe(2);
  });
});
