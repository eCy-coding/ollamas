# LLM Mission Control: Distributed Mesh

LLM Mission Control, kişisel bilgisayarların GPU/RAM kaynaklarını birleştirerek devasa modelleri (70B+) yerel ağınızda çalıştırmanıza olanak tanıyan, şeffaf ve gönüllülük esasına dayalı bir dağıtık çıkarım (inference) ağıdır.

## Teknik Şartname & Güvenlik (Hard Laws)
- **Güvenlik (§0-§6):** Tüm yabancı kodlar WASM sandbox içerisinde çalışır.
- **Gizlilik:** Kişisel veriler asla makineden çıkmaz. Sadece model katman aktivasyonları mesh üzerinden iletilir.
- **Gönüllülük:** Hiçbir makine izinsiz katılamaz, "opt-out" bir tıkla gerçekleşir.

## Kurulum ve Çalıştırma (macOS M4 Pro Max / ARM64)

Bu proje macOS (ARM64) üzerinde en yüksek performans için optimize edilmiştir.
M4 Pro Max için "Master" seviyesi ince ayarlar:

1. **Ön Gereksinimler:**
   - **Ollama:** [ollama.com](https://ollama.com) adresinden indirin.
   - **Geliştirme:** `brew install rust go`
   - **Orchestrator:** `cd bin && go build -o hardware_orchestrator .`

2. **İnce Performans Ayarları (M4 Pro Max için):**
   - Cluster ayarlarından `Performance Flags` kısmına şunu girmenizi öneririz:
     `--metal --threads 12 --batch-size 512`
   - Bu, Apple Metal hızlandırmasını tetikler ve M4'ün yüksek-performans çekirdeklerini optimize eder.

3. **Mesh Ağına Katılım:**
   - **Terminal/iTerm2'yi açın:**
     ```bash
     chmod +x join-cluster.sh
     ./join-cluster.sh
     ```
   - **Onay:** Ekrana gelen "Terms of Service" metnini okuyun ve `y` ile onaylayın.

## Doğrulama Kapıları (G-Gates)
Sistemin dürüstlüğünü kanıtlayan kapılar:
- **G-Cluster:** İletişim testi.
- **G-Sandbox:** WASM/WASI izolasyon testi.
- **G-Governor:** CPU/VRAM kaynak kısıtlama testi.
- **G-Durability:** Düğüm arızasında Pause-Replicate-Retry testi.
