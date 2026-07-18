# BRAIN-ECOSYSTEM — ollamas · eCym · odysseus Senkron Sözleşmesi (2026-07-18)

## Roller ve portlar
| Sistem | Rol | Erişim |
|---|---|---|
| ollamas | Mission Control + BRAIN (kalıcı hafıza, ask, teach) | :3000, launchd `com.ollamas.server` |
| eCym | $0 kişisel model (qwen3:8b+persona) + terminal-komut beyni | `~/ecy-model/terminal-dataset.json` → `ecy-brain` auto-rebuild |
| odysseus | uzak-yürütme halkası | :7860 API (`ecy-io odysseus ...`), panel :4777 |
| ecy-io | doğrulanmış köprü | input/output/read/write/agent/odysseus op'ları |

## SENKRON PRENSİBİ (her işlemde uygulanır)
`make brain-teach` her koşuşta `make ecosystem-sync`'i zincirler:
1. **brain** ← odysseus canlı durumu superseding fact (`odysseus status ...`) + ekosistem dataset'i tazelenir.
2. **eCym** ← brain-erişim komutları (`brain-sor`, `brain-durum`, `brain-panel`, `brain-ogret`, `ody-durum`) idempotent iner — YEDEKLİ (`.bak-<ts>`), `source:"ollamas-sync"` işaretli (Emre onay-ilkesi: eklenenler görünür/geri-alınabilir). `ecy-brain` dataset-mtime ile vektörünü kendisi tazeler.
3. **odysseus** ← yalnız READ-ONLY health probe (görev gönderilmez — yan-etki yasağı).

## Çalışma prensipleri (brain'e de öğretildi — teach:eco:prensip-*)
$0-yerel öncelik · evidence-before-claims · choke-point yasası · daemon-işlemleri Emre-gated · izole worktree + tarih yeniden yazılmaz · karşı-sistem dosyasına yedekli+idempotent yazım · her işlemde ekosistem senkronu.
