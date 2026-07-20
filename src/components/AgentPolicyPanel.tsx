// AJAN İZİN PANELİ — ollamas·eCym·odysseus'un macOS uygulamaları üzerindeki yetkisi.
//
// Bu panelin varlık sebebi: izinlerin kodda gömülü sabitler değil, operatörün
// işaretlediği VERİ olması. Sunucu güvenli varsayılanı tutar (hiçbir sınıf "auto"
// doğmaz); neyin otonomlaşacağına buradan karar verilir.
//
// Tasarım kuralı: her satır o sınıfın NE YAPABİLDİĞİNİ somut örnekle yazar.
// Operatör neyi açtığını tahmin etmek zorunda kalmamalı.
import React, { useEffect, useState } from "react";
import { ShieldCheck, RefreshCw, Loader2, AlertTriangle, Save } from "lucide-react";
import { api } from "../lib/apiClient";

type Autonomy = "deny" | "gated" | "auto";

interface Policy {
  version: 1;
  updatedAt: number;
  classes: Record<string, Autonomy>;
  apps?: Record<string, Partial<Record<string, Autonomy>>>;
  principles?: string[];
}

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

export const AgentPolicyPanel: React.FC<{ onNotify?: (m: string, t: "success" | "error" | "info") => void }> = ({ onNotify }) => {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [classes, setClasses] = useState<string[]>([]);
  const [levels, setLevels] = useState<Autonomy[]>([]);
  const [principles, setPrinciples] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = (await api.get("/api/agent/policy")) as { policy: Policy; riskClasses: string[]; autonomyLevels: Autonomy[] };
      setPolicy(r.policy);
      setClasses(r.riskClasses);
      setLevels(r.autonomyLevels);
      setPrinciples((r.policy.principles ?? []).join("\n"));
    } catch {
      onNotify?.("Politika okunamadı", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const setClass = async (cls: string, level: Autonomy) => {
    setSaving(true);
    try {
      const r = (await api.post("/api/agent/policy", { classes: { [cls]: level } })) as { policy: Policy };
      setPolicy(r.policy);
      onNotify?.(`${CLASS_INFO[cls]?.title ?? cls} → ${LEVEL_INFO[level].label}`, level === "auto" ? "info" : "success");
    } catch {
      onNotify?.("Kaydedilemedi", "error");
    } finally {
      setSaving(false);
    }
  };

  const savePrinciples = async () => {
    setSaving(true);
    try {
      const list = principles.split("\n").map((s) => s.trim()).filter(Boolean);
      const r = (await api.post("/api/agent/policy", { principles: list })) as { policy: Policy };
      setPolicy(r.policy);
      onNotify?.("İlkeler kaydedildi", "success");
    } catch {
      onNotify?.("İlkeler kaydedilemedi", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading && !policy) {
    return <div className="p-6 flex items-center gap-2 text-slate-400"><Loader2 className="animate-spin" size={16} /> yükleniyor…</div>;
  }

  const autoCount = policy ? Object.values(policy.classes).filter((v) => v === "auto").length : 0;

  return (
    <section aria-label="agent-policy-panel" className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck size={20} className="text-emerald-400" />
          <h2 className="text-lg font-semibold">Ajan İzinleri</h2>
        </div>
        <button onClick={() => void load()} className="flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200">
          <RefreshCw size={14} /> yenile
        </button>
      </header>

      <p className="text-sm text-slate-400">
        ollamas · eCym · odysseus'un bu Mac'teki uygulamalar üzerindeki yetkisi.
        Varsayılanda hiçbir sınıf otonom değildir — otonomiyi siz açarsınız.
      </p>

      {autoCount > 0 && (
        <div className="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{autoCount} sınıf otonom. Bu sınıflardaki komutlar size sormadan çalışır.</span>
        </div>
      )}

      <div className="space-y-3">
        {classes.map((cls) => {
          const info: { title: string; example: string; caution?: string } =
            CLASS_INFO[cls] ?? { title: cls, example: "" };
          const cur = policy?.classes[cls] ?? "deny";
          return (
            <div key={cls} className="rounded border border-slate-700 p-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-medium">{info.title}</div>
                  <div className="text-xs text-slate-400 mt-0.5 break-words">{info.example}</div>
                  {info.caution && (
                    <div className="text-xs text-amber-300/90 mt-1">⚠ {info.caution}</div>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  {levels.map((lv) => (
                    <button
                      key={lv}
                      disabled={saving}
                      onClick={() => void setClass(cls, lv)}
                      title={LEVEL_INFO[lv].desc}
                      className={`px-2 py-1 text-xs rounded border ${
                        cur === lv
                          ? lv === "auto" ? "bg-amber-500/20 border-amber-500 text-amber-200"
                            : lv === "gated" ? "bg-emerald-500/20 border-emerald-500 text-emerald-200"
                            : "bg-slate-600/30 border-slate-500 text-slate-300"
                          : "border-slate-700 text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      {LEVEL_INFO[lv].label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium">İlkeler</label>
        <p className="text-xs text-slate-400">
          Her satır bir ilke. Bunlar brain'e öğretilir ve ajanlar bunları bilir —
          ama yetkiyi yukarıdaki matris belirler, ilkeler tek başına izin vermez/almaz.
        </p>
        <textarea
          value={principles}
          onChange={(e) => setPrinciples(e.target.value)}
          rows={5}
          placeholder={"örn. üçüncü kişilere toplu mesaj atma\nörn. mali işlemde her zaman bana sor"}
          className="w-full rounded border border-slate-700 bg-slate-900 p-2 text-sm font-mono"
        />
        <button
          onClick={() => void savePrinciples()}
          disabled={saving}
          className="flex items-center gap-1 rounded bg-emerald-600/80 px-3 py-1.5 text-sm hover:bg-emerald-600 disabled:opacity-50"
        >
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
