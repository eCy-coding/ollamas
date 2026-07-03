# TRUTH.md — Evrensel Doğru/Yanlış Çerçevesi (Deterministik Doğruluk Oracle'ı)

> Bu doküman, "doğru" ve "yanlış"ın **insan etiğine göre değil**, evrensel/nesnel olarak
> kararlaştırılabilir anlamını tanımlar ve `orchestration/oracle/` modülünün bu kavramı
> nasıl **hesaplayarak/çalıştırarak** (görüş bildirmeden) uyguladığını anlatır.

## 1. Neden deterministik bir kıstas?
Canlı bir çapraz-incelemede (2026-06-28) bir LLM (qwen3:8b), hatalı bir `factorial` koduna
"**eksik parantez**" tanısı koydu — kod sorunsuz parse oluyordu; gerçek hata bir **off-by-one**'dı.
Ders nettir: **LLM bir oracle değildir** — kendinden emin biçimde yanılır. Güvenilir bir
doğru/yanlış sistemi yer-gerçeğini **tahmin etmemeli, hesaplamalı/çalıştırmalı**.
Bu, test-oracle literatürünün de sonucudur: güvenilir oracle deterministiktir
([The Oracle Problem in Software Testing](https://web.eecs.umich.edu/~weimerw/2025-481F/readings/testoracles.pdf),
[Perfect is the enemy of test oracle](https://arxiv.org/abs/2302.01488)).

## 2. Ne zaman bir önerme "nesnel olarak" doğru/yanlıştır?
Bir önerme **evrensel doğru/yanlış kapsamındadır** ANCAK VE ANCAK doğruluğu, herhangi bir
öznenin görüş/duygu/tercihinden **bağımsız** olarak sonlu bir prosedürle saptanabiliyorsa.
İki kaynak:

1. **Analitik / zorunlu doğru** — anlam ve kurallar gereği doğru. Hesapla/türetme ile kesinleşir.
   - `2 + 2 = 4` · `ardıl(2) = 3` · `¬(A ∧ ¬A)` (çelişki) · `A ∨ ¬A` (totoloji)
   - Dayanak: [analitik–sentetik ayrımı](https://en.wikipedia.org/wiki/Analytic%E2%80%93synthetic_distinction);
     tüm zorunlu/a priori doğrular analitiktir.
2. **Biçimsel olarak doğrulanabilir** — bir program spesifikasyonunu sağlıyorsa "doğru"dur;
   **çalıştırılıp** bir test-oracle ile bakılır. "Doğru kodlama yöntemi" = davranışsal olarak
   spesifikasyonu sağlayan + nesnel güvenlik/doğruluk kurallarını ihlal etmeyen yöntem.

> Karşıtlık: [Objectivity – IEP](https://iep.utm.edu/objectiv/) — nesnel doğruluk, doğruluk
> koşulları bir özneye bağlı olmadan sağlandığında vardır.

## 3. Sınır — neyin doğru/yanlışı YOKTUR (güvenin özü)
Şunlar **kararlaştırılamaz** ve sistem bunlara **TRUE/FALSE DEMEZ**, `UNDECIDABLE` döner:
- **Etik/ahlaki** ("hırsızlık yanlıştır"), **estetik** ("bu güzel"), **tercih** ("çikolata daha iyi"),
- **gelecek-olumsal** ("yarın yağmur yağacak"), **muğlak/öznel** ifadeler.

Bu çekimserlik bir zayıflık değil, **güvenilirliğin tanımıdır**: oracle yalnızca kanıtlayabildiğini
iddia eder. Halüsinasyonun panzehiri budur.

## 4. Üç verdict — her zaman KANITLA
| Verdict | Anlam | Kanıt biçimi |
|--------|-------|--------------|
| `TRUE` | nesnel olarak doğru | hesap sonucu / totoloji / tüm-vakalar-geçti |
| `FALSE` | nesnel olarak yanlış | karşı-örnek (somut girdi+çıktı) / kural-ihlali (CWE) |
| `UNDECIDABLE` | evrensel kapsam dışı | "öznel / gelecek / kapsam-dışı" gerekçesi |

Asla çıplak görüş yoktur; her sonuç `{verdict, proof, basis}` taşır.

## 5. Altı kararlayıcı (`orchestration/oracle/index.ts`)
1. **arithmetic** — `2+2=4`. **Tam-kesin Rational** (BigInt pay/payda); float kullanılmaz, bu
   yüzden `0.1+0.2=0.3` matematiksel olarak **TRUE** çıkar. Güvenli ayrıştırıcı: yalnız sayı+operatör,
   **eval/isim/çağrı YOK**.
2. **ordering** — "2'den sonra 3 gelir" / "after 9 comes 10": ardıl(n)=n+1.
3. **logic** — `and/or/not/→/↔` üzerinden **doğruluk tablosu**: totoloji→TRUE, çelişki→TRUE
   ("always false" iddiası için), olumsal→karşı-örnek.
4. **code-functional** — adayı **sandboxed alt-süreçte ÇALIŞTIR**, referans değerlerle karşılaştır;
   ilk uyumsuzlukta **somut karşı-örnek** döner. (Buggy `factorial(5)=24≠120` ⇒ FALSE, n=5.)
5. **code-rule** — **AST-lite** (yorum/string-duyarlı) + 3-yönlü sağlam semantik: yüksek-güven anti-pattern
   (SQL string-concat CWE-89, `eval/exec(dinamik)` CWE-95, shell-interpolation CWE-78, `except: pass` CWE-703)
   → **YANLIŞ yöntem** + doğru yöntem; tanınan güvenli kalıp (parametreli sorgu, `execFile`/arg-list, `with`)
   → **DOĞRU yöntem**; ikisi de değilse → **UNDECIDABLE** (kötü kalıbın yokluğu doğruluğu kanıtlamaz).
6. **subjective/undecidable** — değer/estetik/gelecek → `UNDECIDABLE` (çekimser).

**Mimari ilke — deterministik-önce:** karar verilebilen 5 kategoride kesin sonuç döner; yalnızca
`UNDECIDABLE`'da çağıran taraf (ör. implementer-verifier hattı) LLM-verifier'a düşebilir.

## 6. Kullanım
```bash
tsx orchestration/bin/oracle.ts "2+2=4"                      # ✓ DOĞRU
tsx orchestration/bin/oracle.ts "2+2=5"                      # ✗ YANLIŞ  (SOL=4)
tsx orchestration/bin/oracle.ts "2'den sonra 3 gelir"        # ✓ DOĞRU
tsx orchestration/bin/oracle.ts "A and not A is always false"# ✓ DOĞRU  (çelişki)
tsx orchestration/bin/oracle.ts "chocolate is better"        # ○ KARARSIZ (öznel)
# kod (çalıştırarak):
echo '{"kind":"code-functional","lang":"js","entry":"factorial",
 "code":"function factorial(n){let r=1;for(let i=1;i<n;i++)r*=i;return r;}",
 "cases":[{"args":[5],"expect":120}]}' | tsx orchestration/bin/oracle.ts --request
# → ✗ YANLIŞ  Karşı-örnek: factorial(5) = 24, beklenen 120.
```

## 7. Güven testleri
`tests/truth-oracle.test.ts` — 6 kategori + düşmanca factorial + öznel-çekimserlik vakaları;
`npm test -- truth-oracle` ile **%100** geçer. Belirleyicilik gereği sonuç makineden bağımsızdır:
aynı CLI Windows'ta da Mac'te de **aynı** verdict+karşı-örneği üretir (LLM'in aksine).

## 8. Gerçek agent — kapalı implementer-verifier döngüsü
`scripts/oracle-verify-agent.mjs`: **implementer = gerçek model** (qwen3:8b @ Windows RTX 3060 Ti,
HTTP `/api/generate`) bir program yazar; **verifier = deterministik oracle** (Mac'te) o programı
**çalıştırıp** stdout'u **tam-eşitlikle** notlar (`code-output`); YANLIŞ ise oracle'ın karşı-örneği
prompt'a geri verilir, model düzeltir (MAX_ROUNDS'a kadar).

Oracle, modelin "şu çıktıyı aldım" iddiasına **güvenmez** — kendisi çalıştırır. combo-bench'in
`blob.includes(answer)` substring notlamasından **sıkıdır** (tam eşitlik).

**Canlı kanıt (combo-bench 4 görev, 4/4 DOĞRU):** `overflow.fib`'de model ilk turda
`console.log(a)` ile BigInt'i `12586269025n` (sonda `n`) bastı → oracle YANLIŞ (substring olsa
geçerdi); karşı-örnek geri verildi → model `Number(a)` ile düzeltti → tur 2 DOĞRU. Diğer üç görev
1 turda geçti. Implementer Windows GPU'da ~41 tok/s; verifier Mac'te çalıştırır → **iki makine, tek
deterministik hakem**.

> Not: ollamas'ın tam host-tool ReAct agent'ı (`agent-dispatch.mjs` → `macos_terminal`) iTerm2 GUI
> gerektirir ve başsız SSH oturumunda bloke olur; bu yüzden implementer doğrudan GPU üretimine
> (gerçek model çıktısı) bağlandı. Verifier mantığı (deterministik oracle) aynıdır.

## 9. ollamas ile bağ
`orchestration/MODEL_SELECTION.json`'daki verifier bir **LLM**'dir; `scripts/combo-bench.mjs`'in
doğruluk notu ise dar bir `blob.includes(answer)`'dır. Bu oracle, **genel + kanıt üreten +
deterministik** katmanı ekler: implementer-verifier hattında LLM'e gitmeden önce çağrılır;
karar verilebilen her şeyi ucuz ve kesin keser, yalnız gerçekten öznel/kapsam-dışı olanı LLM'e bırakır.
