// İZİN-TEST PLANLAYICI — "verdiğim izinlerle yapılabilecekleri test et" (saf çekirdek).
//
// Mevcut politikanın FİİLEN neye izin verdiğini, TEHLİKELİ yan etki üretmeden kanıtlar.
// Her op sınıfına göre bir EYLEM atanır; IO scripts/permission-probe.ts'te.
//
// DEĞİŞMEZ GÜVENLİK SÖZLEŞMESİ:
//   • gated/deny sınıflar (dışa-iletim, sistem-değişiklik) TEST AMAÇLI BİLE çalışmaz.
//   • mutate-local politika auto verse bile flag'siz ÇALIŞMAZ — bir yetenek testi
//     yan etki olarak state değiştirmemeli (not oluşturmak, pencere açmak).
//   • read osascript'i flag'le çalışır ama ilk çalıştırma TCC dialog'u tetikler.
//   • launch varsayılanda 91 app'i AÇMAZ (makineyi kilitler) — appExists doğrular.
import { decide, type AgentPolicy, type RiskClass } from "./agent-policy";
import { isGuiRisky } from "./ecym-guard";
import type { AppCard, AppOp } from "./app-literacy";

export type ProbeAction = "run" | "compile" | "appExists" | "skip";

export interface ProbeFlags {
  /** osascript read op'larını GERÇEKTEN çalıştır (TCC dialog'u tetikler). */
  runReads?: boolean;
  /** mutate-local op'larını GERÇEKTEN çalıştır (yan etki üretir). */
  runMutations?: boolean;
  /** İlk N launch op'unu gerçekten aç (0 = hiçbiri, yalnız appExists). */
  launchSample?: number;
}

export interface ProbePlan {
  opId: string;
  app: string;
  tier: RiskClass;
  /** Politikanın bu sınıf için kararı. */
  decision: "deny" | "gated" | "auto";
  action: ProbeAction;
  reason: string;
  cmd: string;
}

/** Bir op'un gerçekten çalıştırılabilir sınırı — GATED/DENY asla `run` olmaz. */
export function planProbe(cards: AppCard[], policy: AgentPolicy, flags: ProbeFlags): ProbePlan[] {
  const plan: ProbePlan[] = [];
  let launchRun = 0;
  const launchCap = flags.launchSample ?? 0;

  for (const c of cards) {
    for (const op of c.ops) {
      plan.push(decidePlan(c.app, op, policy, flags, () => launchRun < launchCap && ++launchRun > 0));
    }
  }
  return plan;
}

function decidePlan(
  app: string, op: AppOp, policy: AgentPolicy, flags: ProbeFlags, takeLaunchSlot: () => boolean,
): ProbePlan {
  const tier = op.riskClass;
  const decision = decide(policy, app, tier);
  const base = { opId: op.opId, app, tier, decision, cmd: op.cmd };

  // Sınıf gated/deny ise: hiçbir koşulda çalıştırma. Bu DEĞİŞMEZ sınır.
  if (decision !== "auto") {
    // Zararsız-yapı doğrulaması yine yapılabilir (compile/appExists), ama RUN yok.
    if (decision === "deny") return { ...base, action: "skip", reason: `${tier} deny → çalıştırılmaz` };
    // gated: kullanıcı onayıyla çalışır, TEST otomatik çalıştırmaz.
    return {
      ...base,
      action: op.verify === "compile" ? "compile" : "appExists",
      reason: `${tier} gated → onay gerekir, test yalnız ${op.verify === "compile" ? "derler" : "app-var-mı bakar"}`,
    };
  }

  // decision === "auto" — sınıfa göre agresiflik:
  switch (tier) {
    case "inspect":
      // TCC-siz, yan-etkisiz kabuk sorgusu → gerçekten çalıştır (GUI-riskli değilse).
      return isGuiRisky(op.cmd)
        ? { ...base, action: "compile", reason: "inspect ama GUI-riskli → derle" }
        : { ...base, action: "run", reason: "inspect auto, GUI-risksiz → çalıştır" };

    case "read":
      // osascript getter: flag'le çalışır, aksi halde derle (TCC dialog'u tetiklemesin).
      return flags.runReads
        ? { ...base, action: "run", reason: "read auto + runReads → çalıştır (macOS TCC izni sorabilir)" }
        : { ...base, action: "compile", reason: "read auto → derle (ilk çalıştırma TCC dialog'u tetikler)" };

    case "mutate-local":
      // Politika auto verse bile TEST state değiştirmemeli — flag şart.
      return flags.runMutations
        ? { ...base, action: "run", reason: "mutate-local auto + runMutations → çalıştır (YAN ETKİ üretir)" }
        : { ...base, action: "compile", reason: "mutate-local auto → derle (test yan etki üretmez, --run-mutations ile çalışır)" };

    case "launch":
      // 91 app'i açmak makineyi kilitler → appExists; yalnız örnek kadarı açılır.
      return takeLaunchSlot()
        ? { ...base, action: "run", reason: "launch auto → temsilci örnek, aç+kapat" }
        : { ...base, action: "appExists", reason: "launch auto → app-var-mı (91 app açmak makineyi kilitler)" };

    default:
      // communicate-outward / system-change auto YAPILMIŞ olsa bile buraya düşmemeli
      // (Emre gated bıraktı); yine de savunma: çalıştırma.
      return { ...base, action: "compile", reason: `${tier} → güvenlik gereği çalıştırılmaz` };
  }
}

/** İnsan-okur sınıf-başı özet için gruplama. */
export function groupByTier(plan: ProbePlan[]): Record<string, ProbePlan[]> {
  const out: Record<string, ProbePlan[]> = {};
  for (const p of plan) (out[p.tier] ??= []).push(p);
  return out;
}
