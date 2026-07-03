# ORACLE.md — Doğruluk Oracle'ı: çalışma prensipleri (tek sayfa)

Evrensel/nesnel **doğru/yanlış**ı *görüşle değil hesaplayarak/çalıştırarak* karara bağlayan deterministik
sistem. Etik/estetik/öznel → **çekimser (UNDECIDABLE)**. Öğreti: [[TRUTH.md]] · Algoritma: [[ALGORITHM.md]].

**Sağlam ilke:** *abstain her zaman sağlamdır; tek gerçek hata sağlam-olmayan TRUE/FALSE'tur.* Belirsiz her
kenar → UNDECIDABLE. **Determinizm:** aynı girdi → aynı verdict **ve aynı tanık** (RNG yok; makineler-arası tekrarlanabilir).

## 6 kategori
| # | Kategori | Algoritma | Karmaşıklık | Kanıt | Doğru/Yanlış/Çekimser |
|---|----------|-----------|-------------|-------|------------------------|
| 1 | aritmetik | tam-kesin **Rational** (BigInt; eval YOK) | O(n) | SOL/SAĞ değeri | `2+2=4`✓ · `0.1+0.2=0.3`✓ · dev-üs→çekimser |
| 2 | sıra/ardıl | ardıl(n)=n+1 | O(1) | n+1 | `2'den sonra 3`✓ |
| 3 | mantık | **CDCL** (Tseitin CNF + 1-UIP + backjump + VSIDS) | tipik-poli | totoloji=¬F UNSAT / çelişki=F UNSAT + tanık | `A∨¬A`✓ · `A∧¬A`çelişki |
| 4 | code-functional/output | **taze izole subprocess**'te çalıştır + tam-eşit/karşı-örnek; env-pin + iki-kez (nondeterminizm→çekimser) | O(exec) | stdout / karşı-örnek | doğru çıktı✓ · `Math.random`→çekimser |
| 5 | code-rule | **CWE AST-lite** (89/95/78/703) + tanınan doğru kalıp | O(R·n) | ihlal+CWE / güvenli-kalıp / çekimser | concat→YANLIŞ · parametreli/execFile→DOĞRU · tanınmayan→çekimser |
| 6 | öznel/gelecek | değer/estetik imzası | O(n) | gerekçe | etik/estetik→çekimser |

## Runtime (en verimli — ölçülmüş)
- **Memoizasyon** (içerik-adresli LRU; dosya=içerik-hash) → tekrar O(1)
- **Kalıcı daemon** (Unix socket NDJSON) → tsx cold-start 0 · **soğuk CLI→daemon 9×, memo-hit 5588×**
- **Paralel batch** `verifyMany` → **13.9×** verim · kod-exec taze izole subprocess kalır
- **Mantık benchmark:** ⋁(Xᵢ∧¬Xᵢ)@25 DPLL bütçe-aştı → **CDCL 0ms**; PHP(5,4) brute 950ms → CDCL 0ms

## Komutlar
```
npm run oracle:verify      # tsc + 58 güven testi + CDCL adopt-gate (tek kapı, exit 0)
npm run oracle:test        # vitest tests/truth-oracle.test.ts (58/58)
npm run oracle:algobench   # truth-table vs DPLL vs CDCL + adopt-gate
npm run oracle:bench       # runtime (cold/daemon/memo/batch)
npx tsx orchestration/bin/oracle.ts "2+2=4"                 # tek-atış CLI
npx tsx orchestration/bin/oracle-serve.ts                   # kalıcı daemon
```

## Dosyalar
`orchestration/oracle/{index,logic,cdcl}.ts` · `orchestration/bin/oracle{,-serve}.ts` ·
`scripts/oracle-{algo-bench.ts,bench.mjs,client.mjs,verify-agent.mjs}` · `tests/truth-oracle.test.ts`.
truth-table + DPLL + CDCL üçü de korunur (engine flag; truth-table = CDCL'nin diferansiyel oracle'ı).
