# LLM Mission Control: Distributed Mesh

LLM Mission Control, kişisel bilgisayarların GPU/RAM kaynaklarını birleştirerek devasa modelleri (70B+) yerel ağınızda çalıştırmanıza olanak tanıyan, şeffaf ve gönüllülük esasına dayalı bir dağıtık çıkarım (inference) ağıdır.

## Teknik Şartname & Güvenlik (Hard Laws)
- **Güvenlik (§0-§6):** Tüm yabancı kodlar WASM sandbox içerisinde çalışır.
- **Gizlilik:** Kişisel veriler asla makineden çıkmaz. Sadece model katman aktivasyonları mesh üzerinden iletilir.
- **Gönüllülük:** Hiçbir makine izinsiz katılamaz, "opt-out" bir tıkla gerçekleşir.

## Kurulum ve Çalıştırma (macOS M4 Pro Max / ARM64)

Bu proje macOS (ARM64) üzerinde en yüksek performans için optimize edilmiştir.
M4 Pro Max için "Master" seviyesi ince ayarlar:

### 1. E2E Master Workflow (iTerm2 / Terminal)

1. **Ön Hazırlık:**
   ```bash
   chmod +x setup.sh
   ./setup.sh
   ```

2. **Server Başlatma:**
   ```bash
   npm run dev
   # Port 3000 üzerinde orchestrator aktif olur.
   ```

3. **Cluster Mesh'e Dahil Olma:**
   - Web arayüzünden informed consent onayını verin.
   - Orchestrator M4 Pro Max çip mimarisini otomatik olarak kalibre edecektir (`./bin/hardware_orchestrator` üzerinden).

4. **Doğrulama Görevleri:**
   - `G-Cluster` ve `G-Sandbox` testlerini `G-Gates` panelinden tetikleyin.
   - Şüpheli bir durumda `project_cortex.md` dosyasını `tail -f project_cortex.md` komutuyla izleyin, tüm hatalar buraya düşer.

### 2. İnce Performans Ayarları (M4 Pro Max için):
   - Cluster ayarlarından `Performance Flags` kısmına şunu girmenizi öneririz:
     `--metal --threads 12 --batch-size 512`
   - Bu, Apple Metal hızlandırmasını tetikler ve M4'ün yüksek-performans çekirdeklerini optimize eder.

## Doğrulama Kapıları (G-Gates)
Sistemin dürüstlüğünü kanıtlayan kapılar:
- **G-Cluster:** İletişim testi.
- **G-Sandbox:** WASM/WASI izolasyon testi.
- **G-Governor:** CPU/VRAM kaynak kısıtlama testi.
- **G-Durability:** Düğüm arızasında Pause-Replicate-Retry testi.
