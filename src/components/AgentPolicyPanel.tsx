// AJAN İZİN PANELİ — ollamas·eCym·odysseus'un macOS uygulamaları üzerindeki yetkisi.
//
// Bu panelin varlık sebebi: izinlerin kodda gömülü sabitler değil, operatörün
// işaretlediği VERİ olması. Sunucu güvenli varsayılanı tutar (hiçbir sınıf "auto"
// doğmaz); neyin otonomlaşacağına buradan karar verilir.
//
// İKİ katman: (1) SINIF-düzeyi varsayılan (6 risk sınıfı) — tüm app'leri kapsar;
// (2) PER-APP override — bir app'i sınıf-varsayılanından ayır (kategori-gruplu,
// app sınıftan MİRAS alır, yalnız istisna işaretlenir). Backend `decide(policy,app,class)`
// per-app'i honor eder; boş override = miras. Tek-tık "güvenli preset" makul tabana çeker.
import React, { useEffect, useMemo, useState } from "react";
import { ShieldCheck, RefreshCw, Loader2, AlertTriangle, Save, Zap, ChevronDown, ChevronRight } from "lucide-react";
import { api } from "../lib/apiClient";

type Autonomy = "deny" | "gated" | "auto";

interface Policy {
  version: 1;
  updatedAt: number;
  classes: Record<string, Autonomy>;
  apps?: Record<string, Partial<Record<string, Autonomy>>>;
  principles?: string[];
}

interface AppOpLite { opId: string; riskClass: string }
interface AppCardLite { rank: number; app: string; category: string; purpose: string; ops: AppOpLite[] }

/** Sınıf başına: ne demek, somut örnek, ve otonomlaştırmanın bedeli. */
const CLASS_INFO: Record<string, { title: string; example: string; caution?: string }> = {
  inspect: {
    title: "İnceleme",
    example: "lsappinfo ile açık uygulamaları listele, mdfind ile dosya ara, system_profiler",
  },
  launch: {
    title: "Başlatma",
    example: "open -a \"DaVinci Resolve\" — uygulamayı açar, belge/URL argümanı YOK",
  },
  read: {
    title: "Okuma",
    example: "AppleScript okuyucular: Chrome sekme listesi, Notes başlıkları, Calendar etkinlikleri",
    caution: "İlk çalıştırmada macOS \"Otomasyon\" izni soracak — kabul etmek size ait.",
  },
  "mutate-local": {
    title: "Yerel değişiklik",
    example: "Not oluştur, belge kaydet, Resolve'dan render al",
    caution: "Dosyalarınızı değiştirir. Geri alma uygulamaya bağlıdır.",
  },
  "communicate-outward": {
    title: "Dışa iletim",
    example: "Mail gönder, Messages ile mesaj at, paylaş, satın al",
    caution: "GERİ ALINAMAZ ve sizin kimliğinizle dışarı çıkar. Otonomlaştırmadan önce iki kez düşünün.",
  },
  "system-change": {
    title: "Sistem değişikliği",
    example: "defaults write, System Settings panelleri, TCC izinleri",
    caution: "Makinenin durumunu değiştirir. Bozulma sessiz ve yaygın olabilir.",
  },
};

const LEVEL_INFO: Record<Autonomy, { label: string; desc: string }> = {
  deny: { label: "Kapalı", desc: "Hiç önerilmez, hiç çalışmaz" },
  gated: { label: "Onaylı", desc: "Önerilir, siz onaylayınca çalışır" },
  auto: { label: "Otonom", desc: "Sormadan çalışır" },
};

/** Seviye rozeti rengi (tutarlı görsel dil). */
const levelBtnClass = (lv: Autonomy, active: boolean): string =>
  active
    ? lv === "auto" ? "bg-amber-500/20 border-amber-500 text-amber-200"
      : lv === "gated" ? "bg-emerald-500/20 border-emerald-500 text-emerald-200"
        : "bg-slate-600/30 border-slate-500 text-slate-300"
    : "border-slate-700 text-slate-500 hover:text-slate-300";

const uniq = <T,>(a: T[]): T[] => [...new Set(a)];

export const AgentPolicyPanel: React.FC<{ onNotify?: (m: string, t: "success" | "error" | "info") => void }> = ({ onNotify }) => {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [classes, setClasses] = useState<string[]>([]);
  const [levels, setLevels] = useState<Autonomy[]>([]);
  const [preset, setPreset] = useState<Record<string, Autonomy> | null>(null);
  const [cards, setCards] = useState<AppCardLite[]>([]);
  const [principles, setPrinciples] = useState("");
  const [openCats, setOpenCats] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = (await api.get("/api/agent/policy")) as { policy: Policy; riskClasses: string[]; autonomyLevels: Autonomy[]; safePreset?: Record<string, Autonomy> };
      setPolicy(r.policy);
      setClasses(r.riskClasses);
      setLevels(r.autonomyLevels);
      setPreset(r.safePreset ?? null);
      setPrinciples((r.policy.principles ?? []).join("\n"));
      try {
        const c = (await api.get("/api/app-literacy/cards")) as { cards: AppCardLite[] };
        setCards(c.cards ?? []);
      } catch { /* kartlar yoksa per-app bölümü gizli — sınıf paneli yine çalışır */ }
    } catch {
      onNotify?.("Politika okunamadı", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const post = async (patch: Record<string, unknown>, msg: string, tone: "success" | "info" = "success") => {
    setSaving(true);
    try {
      const r = (await api.post("/api/agent/policy", patch)) as { policy: Policy };
      setPolicy(r.policy);
      onNotify?.(msg, tone);
    } catch {
      onNotify?.("Kaydedilemedi", "error");
    } finally {
      setSaving(false);
    }
  };

  const setClass = (cls: string, level: Autonomy) =>
    post({ classes: { [cls]: level } }, `${CLASS_INFO[cls]?.title ?? cls} → ${LEVEL_INFO[level].label}`, level === "auto" ? "info" : "success");

  const applyPreset = () => {
    if (!preset) return;
    void post({ classes: preset }, "Güvenli preset uygulandı — dışa-iletim/sistem kapalı kaldı", "info");
  };

  // --- Per-app ---
  const appClasses = (c: AppCardLite): string[] => uniq(c.ops.map((o) => o.riskClass));

  /** app'in override seviyesi: apps[app] tüm sınıflarına tek seviye set edildiyse o; yoksa null (miras). */
  const appOverride = (c: AppCardLite): Autonomy | null => {
    const o = policy?.apps?.[c.app];
    if (!o || !Object.keys(o).length) return null;
    const vals = appClasses(c).map((cl) => o[cl]).filter(Boolean) as Autonomy[];
    return vals.length && vals.every((v) => v === vals[0]) ? vals[0] : null;
  };

  const setAppLevel = (c: AppCardLite, level: Autonomy | "inherit") => {
    const over = level === "inherit" ? {} : Object.fromEntries(appClasses(c).map((cl) => [cl, level]));
    void post({ apps: { [c.app]: over } },
      level === "inherit" ? `${c.app} → sınıf varsayılanı (miras)` : `${c.app} → ${LEVEL_INFO[level].label}`,
      level === "auto" ? "info" : "success");
  };

  const setGroupLevel = (category: string, level: Autonomy | "inherit") => {
    const group = cards.filter((c) => c.category === category);
    const apps = Object.fromEntries(group.map((c) =>
      [c.app, level === "inherit" ? {} : Object.fromEntries(appClasses(c).map((cl) => [cl, level]))]));
    void post({ apps }, `${category}: ${group.length} app → ${level === "inherit" ? "miras" : LEVEL_INFO[level].label}`,
      level === "auto" ? "info" : "success");
  };

  const catGroups = useMemo(() => {
    const m = new Map<string, AppCardLite[]>();
    for (const c of [...cards].sort((a, b) => a.rank - b.rank)) {
      (m.get(c.category) ?? m.set(c.category, []).get(c.category)!).push(c);
    }
    return [...m.entries()];
  }, [cards]);

  const toggleCat = (cat: string) =>
    setOpenCats((s) => { const n = new Set(s); n.has(cat) ? n.delete(cat) : n.add(cat); return n; });

  if (loading && !policy) {
    return <div className="p-6 flex items-center gap-2 text-slate-400"><Loader2 className="animate-spin" size={16} /> yükleniyor…</div>;
  }

  const autoCount = policy ? Object.values(policy.classes).filter((v) => v === "auto").length : 0;
  const overrideCount = policy?.apps ? Object.keys(policy.apps).length : 0;

  return (
    <section aria-label="agent-policy-panel" className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck size={20} className="text-emerald-400" />
          <h2 className="text-lg font-semibold">Ajan İzinleri</h2>
        </div>
        <div className="flex items-center gap-3">
          {preset && (
            <button onClick={applyPreset} disabled={saving}
              title="inspect/launch/read=Otonom · mutate=Onaylı · dışa-iletim/sistem=Kapalı"
              className="flex items-center gap-1 rounded bg-emerald-600/80 px-3 py-1.5 text-sm hover:bg-emerald-600 disabled:opacity-50">
              <Zap size={14} /> güvenli preset
            </button>
          )}
          <button onClick={() => void load()} className="flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200">
            <RefreshCw size={14} /> yenile
          </button>
        </div>
      </header>

      <p className="text-sm text-slate-400">
        ollamas · eCym · odysseus'un bu Mac'teki uygulamalar üzerindeki yetkisi.
        Varsayılanda hiçbir sınıf otonom değildir — otonomiyi siz açarsınız. Önce sınıf
        varsayılanını seçin; sonra tek tek app'ler için istisna tanımlayın (opsiyonel).
      </p>

      {autoCount > 0 && (
        <div className="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{autoCount} sınıf otonom{overrideCount > 0 ? `, ${overrideCount} app istisnası` : ""}. Bu komutlar size sormadan çalışır.</span>
        </div>
      )}

      {/* --- SINIF-DÜZEYİ VARSAYILAN --- */}
      <div className="space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sınıf varsayılanı (tüm uygulamalar)</div>
        {classes.map((cls) => {
          const info: { title: string; example: string; caution?: string } = CLASS_INFO[cls] ?? { title: cls, example: "" };
          const cur = policy?.classes[cls] ?? "deny";
          return (
            <div key={cls} className="rounded border border-slate-700 p-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-medium">{info.title}</div>
                  <div className="text-xs text-slate-400 mt-0.5 break-words">{info.example}</div>
                  {info.caution && <div className="text-xs text-amber-300/90 mt-1">⚠ {info.caution}</div>}
                </div>
                <div className="flex gap-1 shrink-0">
                  {levels.map((lv) => (
                    <button key={lv} disabled={saving} onClick={() => setClass(cls, lv)} title={LEVEL_INFO[lv].desc}
                      className={`px-2 py-1 text-xs rounded border ${levelBtnClass(lv, cur === lv)}`}>
                      {LEVEL_INFO[lv].label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* --- PER-APP İSTİSNA (kategori-gruplu) --- */}
      {catGroups.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Uygulama istisnaları (opsiyonel · app sınıftan miras alır)
          </div>
          <p className="text-xs text-slate-500">
            Bir app'i sınıf varsayılanından ayırın. Grup başlığındaki toplu-tik kategorinin
            hepsini set eder; tek app satırından override edin. <b>Miras</b> = istisnayı kaldır.
          </p>
          {catGroups.map(([category, group]) => {
            const open = openCats.has(category);
            const overridden = group.filter((c) => appOverride(c) !== null).length;
            return (
              <div key={category} className="rounded border border-slate-700">
                <div className="flex items-center justify-between gap-2 p-2">
                  <button onClick={() => toggleCat(category)} className="flex items-center gap-1 text-sm font-medium text-slate-200">
                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    {category} <span className="text-xs text-slate-500">({group.length}{overridden ? ` · ${overridden} istisna` : ""})</span>
                  </button>
                  <div className="flex gap-1 shrink-0">
                    {(["auto", "gated", "deny"] as Autonomy[]).map((lv) => (
                      <button key={lv} disabled={saving} onClick={() => setGroupLevel(category, lv)} title={`Grup: hepsi ${LEVEL_INFO[lv].label}`}
                        className={`px-2 py-0.5 text-[11px] rounded border ${levelBtnClass(lv, false)}`}>
                        {LEVEL_INFO[lv].label}
                      </button>
                    ))}
                    <button disabled={saving} onClick={() => setGroupLevel(category, "inherit")} title="Grup: hepsi miras"
                      className="px-2 py-0.5 text-[11px] rounded border border-slate-700 text-slate-500 hover:text-slate-300">
                      Miras
                    </button>
                  </div>
                </div>
                {open && (
                  <div className="border-t border-slate-800 divide-y divide-slate-800">
                    {group.map((c) => {
                      const ov = appOverride(c);
                      return (
                        <div key={c.app} className="flex items-center justify-between gap-3 px-3 py-2">
                          <div className="min-w-0">
                            <div className="text-sm">{c.app} {ov && <span className="text-[10px] text-amber-300">istisna</span>}</div>
                            <div className="text-[11px] text-slate-500">{appClasses(c).map((cl) => CLASS_INFO[cl]?.title ?? cl).join(" · ")}</div>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <button disabled={saving} onClick={() => setAppLevel(c, "inherit")} title="Sınıf varsayılanını kullan"
                              className={`px-2 py-0.5 text-[11px] rounded border ${ov === null ? "bg-slate-700/40 border-slate-500 text-slate-200" : "border-slate-700 text-slate-500 hover:text-slate-300"}`}>
                              Miras
                            </button>
                            {(["deny", "gated", "auto"] as Autonomy[]).map((lv) => (
                              <button key={lv} disabled={saving} onClick={() => setAppLevel(c, lv)} title={LEVEL_INFO[lv].desc}
                                className={`px-2 py-0.5 text-[11px] rounded border ${levelBtnClass(lv, ov === lv)}`}>
                                {LEVEL_INFO[lv].label}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* --- İLKELER --- */}
      <div className="space-y-2">
        <label className="block text-sm font-medium">İlkeler</label>
        <p className="text-xs text-slate-400">
          Her satır bir ilke. Bunlar brain'e öğretilir ve ajanlar bunları bilir —
          ama yetkiyi yukarıdaki matris belirler, ilkeler tek başına izin vermez/almaz.
        </p>
        <textarea value={principles} onChange={(e) => setPrinciples(e.target.value)} rows={5}
          placeholder={"örn. üçüncü kişilere toplu mesaj atma\nörn. mali işlemde her zaman bana sor"}
          className="w-full rounded border border-slate-700 bg-slate-900 p-2 text-sm font-mono" />
        <button
          onClick={() => { const list = principles.split("\n").map((s) => s.trim()).filter(Boolean); void post({ principles: list }, "İlkeler kaydedildi"); }}
          disabled={saving}
          className="flex items-center gap-1 rounded bg-emerald-600/80 px-3 py-1.5 text-sm hover:bg-emerald-600 disabled:opacity-50">
          <Save size={14} /> ilkeleri kaydet
        </button>
      </div>

      {policy && (
        <div className="text-xs text-slate-500">
          son güncelleme: {policy.updatedAt ? new Date(policy.updatedAt).toLocaleString("tr-TR") : "—"}
        </div>
      )}
    </section>
  );
};

export default AgentPolicyPanel;
