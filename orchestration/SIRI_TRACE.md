# SİRİ TRACE RAPORU — gerçek-zamanlı test görevleri + iç-akış kanıtı

Her görev `siri-ask --trace` ile koştu; iç akış (normalize → oracle daemon/verdict VEYA deep+sentez backend) GERÇEK yürütmeden toplandı.

## Özet
- route doğruluğu: **%100** (10/10)
- verdict doğruluğu (oracle): **%100** (6/6)

## Görev akışları
### « 8 kere 9 eşittir 72 » → oracle (Doğru)  ✓
- normalize: input:8 kere 9 eşittir 72,normalized:8 * 9 = 72
- oracle: input:8 * 9 = 72,via:daemon,verdict:TRUE,ms:4
- final: route:oracle,verdict:TRUE,ms:11
- yanıt: Doğru. SOL = 72, SAĞ = 72 ⇒ (72 == 72) = true.
### « 2 üzeri 10 = 1024 » → oracle (Doğru)  ✓
- normalize: input:2 üzeri 10 = 1024,normalized:2 ** 10 = 1024
- oracle: input:2 ** 10 = 1024,via:daemon,verdict:TRUE,ms:3
- final: route:oracle,verdict:TRUE,ms:6
- yanıt: Doğru. SOL = 1024, SAĞ = 1024 ⇒ (1024 == 1024) = true.
### « 2+2=4 » → oracle (Doğru)  ✓
- oracle: input:2+2=4,via:daemon,verdict:TRUE,ms:3
- final: route:oracle,verdict:TRUE,ms:6
- yanıt: Doğru. SOL = 4, SAĞ = 4 ⇒ (4 == 4) = true.
### « 100 / 4 = 30 » → oracle (Yanlış)  ✓
- oracle: input:100 / 4 = 30,via:daemon,verdict:FALSE,ms:3
- final: route:oracle,verdict:FALSE,ms:6
- yanıt: Yanlış. SOL = 25, SAĞ = 30 ⇒ (25 == 30) = false.
### « 9'dan sonra 11 gelir » → oracle (Yanlış)  ✓
- oracle: input:9'dan sonra 11 gelir,via:daemon,verdict:FALSE,ms:2
- final: route:oracle,verdict:FALSE,ms:5
- yanıt: Yanlış. ardıl(9) = 10; iddia edilen = 11 ⇒ false.
### « A and not A is always false » → oracle (Doğru)  ✓
- oracle: input:A and not A is always false,via:daemon,verdict:TRUE,ms:2
- final: route:oracle,verdict:TRUE,ms:2
- yanıt: Doğru. "A and not A" bir çelişkidir (F UNSAT — tüm atamalarda yanlış).
### « yapay zeka nedir » → research  ✓
- oracle: input:yapay zeka nedir,via:daemon,verdict:UNDECIDABLE,ms:3
- deep: query:yapay zeka nedir,sources:3,chars:17999,ms:2731
- synth: backend:ollama_local,chars:198,demo:false,ms:5608,attempt:1
- fallback: to:extractive
- final: route:research,mode:extractive,ms:8343
- yanıt: Yapay Zeka Nedir? Temel Kavramlar ve Özellikleri. Yapay Zeka Nedir? Temel Kavramlar ve ÖzellikleriBilişim Teknolojileri 
### « Türkiye'nin başkenti neresi » → research  ✓
- oracle: input:Türkiye'nin başkenti neresi,via:daemon,verdict:UNDECIDABLE,ms:3
- deep: query:Türkiye'nin başkenti neresi,sources:3,chars:6412,ms:7353
- synth: backend:ollama_local,chars:66,demo:false,ms:2684,attempt:1
- fallback: to:extractive
- final: route:research,mode:extractive,ms:10044
- yanıt: Türkiye - Vikipedi. Vikipedi, özgür ansiklopedi Başlığın diğer anlamları için Türkiye (anlam ayrımı) sayfasına bakınız. 
### « RAG nedir » → research  ✓
- oracle: input:RAG nedir,via:daemon,verdict:UNDECIDABLE,ms:4
- deep: query:RAG nedir,sources:3,chars:18000,ms:3324
- synth: backend:ollama_local,chars:136,demo:false,ms:2695,attempt:1
- fallback: to:extractive
- final: route:research,mode:extractive,ms:6025
- yanıt: RAG (Almayla Artırılmış Üretim) nedir? - aws.amazon.com. RAG (Almayla Artırılmış Üretim) nedir? Bir AWS Hesabı oluşturun
### « çikolata vanilyadan iyi midir » → research  ✓
- oracle: input:çikolata vanilyadan iyi midir,via:daemon,verdict:UNDECIDABLE,ms:6
- deep: query:çikolata vanilyadan iyi midir,sources:3,chars:13147,ms:2359
- synth: backend:ollama_local,chars:110,demo:false,ms:2881,attempt:1
- fallback: to:extractive
- final: route:research,mode:extractive,ms:5250
- yanıt: Vanilya ve Çikolata: Mutfaktaki Uyumun İncelikleri. Vanilya ve Çikolata: Mutfaktaki Uyumun İncelikleriTarafındanSeda Kor