# LLM Mission Control: Distributed Mesh

LLM Mission Control, kişisel bilgisayarların GPU/RAM kaynaklarını birleştirerek devasa modelleri (70B+) yerel ağınızda çalıştırmanıza olanak tanıyan, şeffaf ve gönüllülük esasına dayalı bir dağıtık çıkarım (inference) ağıdır.

## Teknik Şartname & Güvenlik (Hard Laws)
- **Güvenlik (§0-§6):** Tüm yabancı kodlar WASM sandbox içerisinde çalışır.
- **Gizlilik:** Kişisel veriler asla makineden çıkmaz. Sadece model katman aktivasyonları mesh üzerinden iletilir.
- **Gönüllülük:** Hiçbir makine izinsiz katılamaz, "opt-out" bir tıkla gerçekleşir.

## Kurulum (Join the Mesh)
1. **Sistem Gereksinimleri:** Python 3.10+, Rust, Go ve Ollama.
2. **Derleme:**
   ```bash
   make all
   ```
3. **Katılım:**
   - **macOS/Linux:** `bash join-cluster.sh`
   - **Windows:** `powershell join-cluster.ps1`
   - *(Çalıştırıldığında onay istenir, "y" ile onaylayın).*

## Doğrulama Kapıları (G-Gates)
Sistemin dürüstlüğünü kanıtlayan kapılar:
- **G-Cluster:** İletişim testi (OpenAI-compatible endpoint).
- **G-Sandbox:** WASM/WASI izolasyon testi (Dosya sistemi kısıtlamaları).
- **G-Governor:** CPU/VRAM kaynak kısıtlama testi.
- **G-Durability:** Düğüm arızasında Pause-Replicate-Retry testi.
