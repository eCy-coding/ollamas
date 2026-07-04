# ALGORITHM.md — Doğruluk Oracle'ının Uçtan-Uca Algoritması & Runtime

Sistemin "doğru/yanlış" karar prosedürünün formal tanımı, her aşamanın karmaşıklığı ve
en-verimli runtime (memoizasyon + kalıcı daemon + paralel batch). Felsefi temel: [[TRUTH.md]].

## 1. Karar prosedürü `verify(input)`
```
verify(input):                                                               # toplam
  1. NORMALIZE   canonicalize(input): trim + unicode operatör katlama → key  O(n)
  2. CACHE       key ∈ memo ?  →  memo[key]            (saf fn → güvenli)     O(1) beklenen
  3. CLASSIFY    tek-geçiş, önceden-derlenmiş regex süpürmesi → kategori      O(n)
  4. DECIDE      (deterministik; kategoriye göre):
       arithmetic     tokenize → recursive-descent → EXACT Rational → compare O(n)
       ordering       ardıl(n) = n+1                                          O(1)
       logic          parse → Tseitin CNF → CDCL: totoloji=¬F UNSAT, çelişki=F UNSAT   (DPLL/brute selectable)
       code-func/out  TAZE izole subprocess → çalıştır → karşılaştır          O(exec)
       code-rule      önceden-derlenmiş CWE kural süpürmesi → ilk ihlal       O(R · n)
       subjective     değer/gelecek imzası → çekimser                         O(n)
       unknown        hiçbiri → çekimser                                      O(1)
  5. PROOF       kanıt iliştir: değer | karşı-örnek | CWE | çekimser-gerekçe
  6. MEMOIZE     memo[key] = result  (LRU evict, MEMO_MAX)                     O(1)
  return result
```
`n` = girdi uzunluğu, `v` = mantık formülündeki değişken sayısı (≤ küçük), `R` = CWE kural sayısı.

**Verdict ∈ {TRUE, FALSE, UNDECIDABLE}** — her biri `{category, proof, basis}` taşır; çıplak görüş yok.

## 2. Neden bu algoritmalar "doğru"?
- **arithmetic:** float değil **tam-kesin Rational** (BigInt pay/payda) → `0.1+0.2=0.3` matematiksel
  doğru karara bağlanır. Ayrıştırıcı yalnız sayı+operatör; **eval/isim/çağrı YOK** (güvenli).
- **logic (CDCL):** keyfi formül → **Tseitin** ile eşit-doğrulanabilir CNF (lineer) → **CDCL**
  (two-watched-literals BCP + 1-UIP conflict learning + non-chronological backjump + VSIDS). **F totoloji
  ⟺ ¬F UNSAT; F çelişki ⟺ F UNSAT.** Tanık (SAT modeli) **deterministik** (RNG yok, sabit indeks tie-break +
  sabit faz → makine-bağımsız). Plain-DPLL'i patlatan ⋁(Xᵢ∧¬Xᵢ)@25 (135s) ve PHP CDCL'de **anında** —
  aynı çatışma bir kez öğrenilir, ilgisiz kararların üstünden atlanır. **DPLL ve truth-table korunur**
  (engine flag ile seçilir); truth-table CDCL'nin **diferansiyel oracle'ıdır** (600+ rastgele formülde
  cdcl==brute). Worst-case güvenlik: conflict tavanı aşılırsa ≤22 değişkende brute. ([CDCL](https://en.wikipedia.org/wiki/Conflict-driven_clause_learning),
  [two-watched-literals](https://people.mpi-inf.mpg.de/~mfleury/sat_twl.pdf), [Tseytin](https://en.wikipedia.org/wiki/Tseytin_transformation))
- **code:** test-oracle ilkesi — modelin *iddiasına* değil, programın **çalıştırılmış çıktısına** bakılır;
  tam-eşitlik (`code-output`) veya karşı-örnek (`code-functional`). İzolasyon için **taze subprocess**
  (`vm` güvenlik sınırı değildir; `child_process` OS-düzeyi izole — [kaynak](https://offensive360.com/blog/nodejs-vm-module-security-risks/)).
- **kararlanabilirlik sınırı:** analitik/zorunlu doğrular (matematik/mantık) ve biçimsel-doğrulanabilir
  (kod) kararlanabilir → TRUE/FALSE. Etik/estetik/gelecek **kararlanamaz** → **UNDECIDABLE** (çekimser).
  Bu sınır güvenilirliğin tanımıdır.

## 3. Kapalı implementer-verifier döngüsü (`scripts/oracle-verify-agent.mjs`)
```
solve(task):
  prompt ← base(task.spec)
  repeat r = 1..MAX_ROUNDS:
     code   ← IMPLEMENTER(prompt)            # gerçek model (qwen3:8b @ Windows GPU)
     verdict ← verify({code-output, code, expect=task.answer})   # DETERMİNİSTİK oracle
     if verdict = TRUE: return PASS(r)
     prompt ← base + counterexample(verdict.proof)   # karşı-örnek geri besleme
  return FAIL
```
**Sonlanma:** ≤ MAX_ROUNDS turda biter (sınırlı). Verifier **deterministik+sağlam** olduğundan TRUE ⇒
çıktı gerçekten spesifikasyonu sağlar (yanlış-pozitif yok). Kanıt: `overflow.fib` t1 `12586269025n`
(BigInt) → FALSE → t2 `Number()` düzeltmesi → TRUE.

## 4. En-verimli runtime
Oracle **saf + deterministik** ⇒ kazançlar algoritmik:
| Teknik | Ne kazandırır | Nasıl |
|--------|---------------|-------|
| **Memoizasyon** (içerik-adresli LRU) | tekrar eden doğrulama → O(1) | key=kanonik hash; `file:` için **dosya içeriği** hash'i (bayat cache yok) ([Memoization](https://grokipedia.com/page/Memoization)) |
| **Kalıcı daemon** (Unix socket NDJSON) | **tsx+modül cold-start (~1–2s) → 0** | süreç sıcak kalır; satır başına istek/yanıt |
| **Paralel batch** `verifyMany` | bağımsız doğrulamalar eşzamanlı | async `execFile`, sınırlı eşzamanlılık (CPU−2); izolasyon korunur (taze subprocess) |
| **Önceden-derlenmiş regex + tek-geçiş classify** | çağrı başına derleme yok | modül-düzeyi sabit regex |

**Ölçüm:** `node scripts/oracle-bench.mjs` → soğuk CLI vs sıcak daemon, memo-hit, batch hızlanması.

## 5. Değişmezler (invariants)
- **Determinizm:** aynı girdi → aynı verdict (RNG/saat/locale yok) → cache & makineler-arası tekrarlanabilir.
- **Sağlamlık:** TRUE yalnız kanıtla verilir (hesap/çalıştırma); şüphede **UNDECIDABLE**.
- **Güven testleri:** `tests/truth-oracle.test.ts` — 6 kategori + runtime pariteleri **%100** geçer.
