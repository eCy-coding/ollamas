# MATH — formal specification of the ollamas $0 conductor (TR/EN)

The system core is a set of **pure functions**. This document formalizes each as sets + functions + invariants
+ theorems; every claim is machine-checked by `orchestration/tests/math-properties.test.ts` (exhaustive
enumeration — the state spaces are small enough that ∀ is decidable). Notation is EN; prose is TR.

---

## 1. FSM — the conductor loop (`lib/orchestra-fsm.ts`)

**Kümeler / Sets.** Σ = PHASES = {BOOTSTRAPPING, COUNCIL_DEBATE, BENCHMARK_VALIDATION, REPAIR, DEPLOYMENT,
MONITORING, ESCALATE}, |Σ| = 7. Tier = {RED, SECURITY, CONTRACT, DRIFT, REGRESSION, COMPLETENESS, STALE,
ROADMAP}. Blocking B = {RED, SECURITY, CONTRACT, REGRESSION} ⊂ Tier. Signal space
S = (Tier ∪ {⊥}) × 𝔹(hasTask) × 𝔹(converged) × 𝔹(retryExceeded).

**Geçiş fonksiyonu / Transition.** δ : Σ × S → Σ (`nextPhase`). Kilit dal (gate):
> δ(BENCHMARK_VALIDATION, (a, t, c, ·)) = DEPLOYMENT ⟺ (c ∧ a∉B ∧ ¬t), else REPAIR.

TR: "yakınsadı ∧ bloklayan-sinyal-yok ∧ bekleyen-görev-yok" ise sevk (DEPLOYMENT); aksi halde onar (REPAIR).
Açık bir görev (t) daima REPAIR'e gider — sevkten önce ÇALIŞTIRILIR.

**Değişmezler / Invariants.**
- (I1) **Totality:** ∀ s∈S, ∀ p∈Σ · δ(p,s) ∈ Σ. *(Kanıt: 1260-kombinasyon sayımı.)*
- (I2) **Determinism:** δ saf → aynı girdi aynı çıktı.
- (I3) **Bounded retry:** retry_count ≤ RETRY_MAX = 3, `bumpRetry` monoton, `exceeded ⟺ n ≥ 3`.
- (I4) **Bounded history:** |pruneHistory(h)| ≤ HISTORY_MAX = 20 (∀ giriş uzunluğu).
- (I5) **Normalize retraction:** `normalizeState` toplam + idempotent (bozuk blob → geçerli state; iki kez = bir kez).

**Sonlanma teoremi / Termination.**
> Kalıcı bloklayan gate altında (converged=false, a∈B), REPAIR ⟳ BENCHMARK döngüsü **≤ RETRY_MAX** bump'ta
> ESCALATE'e ulaşır; toplam adım ≤ 2·RETRY_MAX+2. Daemon açık kalır (ESCALATE bir "park" durumu).

TR: Sistem sonsuz onarım-spiraline giremez; N=3 denemeden sonra insana/park'a eskale eder.

---

## 2. Council — weighted-majority quorum (`lib/council.ts`)

Lane ℓ için: participating_ℓ = |{yanıt veren seat}|, agreeing_ℓ = |{≥1 TASK/RISK üreten seat}|,
confidence_ℓ = agreeing_ℓ / participating_ℓ (participating=0 ⇒ 0).

> decision_ℓ = EXECUTE ⟺ confidence_ℓ > **COUNCIL_QUORUM = 0.6**  (eşik DIŞLAYICI).
> global decision = EXECUTE ⟺ ∃ℓ · decision_ℓ = EXECUTE, else HOLD.

**Değişmezler:** (a) confidence'ta **monoton** (agreeing↑ ⇒ decision EXECUTE'a doğru). (b) tam 0.6 (3/5) → HOLD.
(c) katılımcı-yok / sessizlik → HOLD (güvenli Orchestrator-override — sessizlik üzerine asla ACT etme).

---

## 3. Joker — failover policy (`lib/joker.ts`)

Şef c, sağlık h∈𝔹, joker j. resolveJoker: sağlıklı-set H, tercih DEFAULT_JOKER=qwen3:8b → yoksa roster → yoksa "".

> **swap ⟺ ¬h ∧ j≠"" ∧ j≠c**  (`shouldFailover`, 2·2·2 doğruluk tablosu ile kanıtlı).
> **no-thrash:** sağlıklı-alternatif yoksa (resolveJoker="") swap YOK → ölü modele geçiş imkânsız.
> **return-to-preferred:** benchmark-tercihi pref sağlıklıysa (pref∈H) ve c≠pref → c ← pref (joker geçici, ev değil).
> **applyFailover:** failover_count += 1 (tam bir kez), history'ye `[FAILOVER] c→j`.

TR: Model düşerse jokere geç; alternatif yoksa yerinde kal (kilitlenme yok); yerel tercih dönünce $0'a geri dön.

---

## 4. Resolver — task→target (`lib/task-catalog.ts`)

tokens(x) = {|w|>2 · w ∈ x'in alfasayısal parçaları}. resolveTask öncelik zinciri (ilk eşleşen kazanır):

> 1. **exact id:** ∃t · id(t)=q  →  t
> 2. **substring:** ∃t · q ⊇ id(t) ∨ id(t) ⊇ q  →  t
> 3. **token-overlap:** argmax_t |tokens(q) ∩ tokens(id·target·goal of t)|, skor≥1 (tie → ilk); yoksa **null**

**Değişmez:** deterministik (saf); çözülemeyen serbest-metin → null (asla crash, güvenli-skip).

---

## 5. Ledger — completion progress (`lib/task-progress.ts`)

Status = {pending, proposed, done}; Progress : Id ⇀ Status (tanımsız id = pending).

> **statusOf ∘ mark = id** işaretlenen id'de. **Σ(done,proposed,pending) = |catalog|** (partition).
> **nextPending** = katalogdaki ilk pending; **null ⟺ tüm görev done/proposed** (drain sonlanır).
> **done-monoton:** tekrar mark(done) idempotent; ilerleme geri gitmez (drain katalogu sonlu adımda tüketir).

TR: İlerleme kaydı; drain her adımda bir pending çeker → ilerleme monoton → sonlu (N görev → ≤N drain).

---

## 6. Deps — dependency classification (`lib/deps.ts`)

Tier partition'ı Brewfile'ın `# === TIER: x ===` başlıklarından parse edilir.
> **severity(t) = BLOCK ⟺ t = core**, else WARN (toplam fonksiyon). binName = formula → probe-CLI override
> (librsvg→rsvg-convert, imagemagick→magick, wireguard-tools→wg, docker-desktop→docker).

TR: core-eksik = boot-blocker; diğer eksik = uyarı. `deps-doctor` presence (command -v) = gerçek kapı.

---

## 7. Key-autonomy loop — self-heal cooldown (`server/key-health.ts`, `server/provider-errors.ts`)

API-anahtar havuzu ($0 açısından kritik: cloud düşerse yerel Ollama'ya iner) kendini iyileştiren bir
saf-çekirdek loop ile yönetilir. Her seat için durum: `live | cooled | invalid | absent`.

**Hata sınıflandırma (typed ⊐ message):** `classifyKeyError(e) ∈ {quota, auth, generic}`. Öncelik TYPED
HTTP status'tur — mesaj-substring'i değil:
> status=429 → quota · status∈{401,403} → auth · başka-typed-status (5xx/400) → **generic**. Yalnız
> untyped (network) hata mesaj-sezgisine düşer (`/429|quota|exceeded/`→quota, `/401|403|unauthorized/`→auth).
> **Teorem (yanlış-6h önlenir):** typed 5xx gövdesinde "exceeded" geçse bile generic → 30s bench, 6h quota DEĞİL.

**Cooldown TTL:** `quotaCooldownTtl(isQuota, retryAfter)`:
> quota → retryAfter>0 ? retryAfter : 6h · auth → 24h · generic → `FAILURE_COOLDOWN_MS = 30s`.
> Monoton+sınırlı: 30s ≤ TTL ≤ 24h. Cooldown biten anahtar sweep'te live-pool'a **geri katılır** (monoton geri-dönüş).

**Sweep zamanlaması:** `nextTickDelay(nextExpiry, base, now, floor=1s)` = expiry base'den önce dolacaksa
sweep'i tam-sonrasına çeker (ε=250ms), floor-guard hot-loop'u önler:
> nextExpiry=null → base · untilExpiry≥base → base · else → max(floor, untilExpiry). **1s ≤ delay ≤ base.**

**Circuit-breaker backoff:** `nextBackoffMs(fails, base, max) = min(base·2^min(fails,6), max)` — geometrik,
6-kat cap + max-cap → kalıcı-hatada hot-spin YOK, sonlu backoff.

TR: Anahtar-loop always-on = server içi `setTimeout` + iter-16 fleet-KeepAlive (server çökse launchd/watch
ayağa kaldırır). Auto-failover (`generate()`): quota/auth → cooldown → havuzda sıradaki live anahtara döner →
yoksa provider-chain → hepsi cooled ise keyless+yerel. Terminal (`ollamas keys`) == web (`/api/keys/health`)
aynı `getKeyHealth()` snapshot'ı okur (parite).

## 8. Panel loop'ları — $0-default + pipeline FSM (`ReactAgentTab`, `MultiAgentPipeline`)

**$0-yerel default:** `firstUsableModel(list)` = placeholder-olmayan ilk model (`/not set|API key|not installed/`
elenir), yoksa list[0], boşsa "". Panel mount → provider=`ollama-local` + firstUsableModel → key-siz out-of-box.

**Pipeline FSM:** sıralı 3-aşama `architect → coder → reviewer`, her biri `ProviderRouter.generate` (joker
failover chain'i miras alır). Self-improve: `retry ≤ maxIterations` (justdoit N-cap, sonsuz-loop YOK).
Write: `FILE:`+fenced-blok parse → `writeCount` + `writeErrors[]` (hata **görünür**, sessiz-swallow YOK).

**ReAct verifier gate:** opt-in `verify` → bağımsız verifier model (implementer≠verifier) nihai yanıtı
inceler → `VERDICT: PASS|FAIL` emit → UI gate. Yanıtı değiştirmez (additive), best-effort (verifier hatası
yanıtı bozmaz). FAIL → retry (ReAct step-cap ≤ maxSteps, sonlu).

Kanıt: `classifyKeyError`/`quotaCooldownTtl`/`nextTickDelay`/`nextBackoffMs`/`firstUsableModel` property-test'li
(`tests/provider-errors-classify.test.ts`, `tests/ui/localModel.test.ts`, `tests/key-health*.test.ts`).

---

## 9. Fallback-chain ordering — $0-landing garantisi (`providers.ts getFallbackChain/orderRestByLatency`)

Bir istek başarısız olursa router bir provider-zinciri dener. §7 (key-pool) tek provider içini yönetir; bu
bölüm zincir SIRASINI formalize eder — §7'nin $0-garantisinin eksik yarısı.

Σ = provider'lar. `getFallbackChain(initial) = front(initial) ++ orderRestByLatency(rest)` where
front(gemini)=[gemini,gemini-cli], front(gemini-cli)=[gemini-cli,gemini], else [initial].

`orderRestByLatency`: TERMINAL-erken `E={fleet, ollama-local}` başta, `demo` sonda, cloud-orta **kararlı**
latency-sort (`lat(p)=getLatency(p)<0 ? +∞ : getLatency(p)`), gemini-ailesi bitişik.
> **Değişmezler:** (I9a) `fleet, ollama-local ∈ chain ∧ index düşük` — $0-yerel daima erken. (I9b) `demo` son.
> (I9c) ölçülmemiş (lat=−1→+∞) → orijinal-sıra korunur (soğuk-cache 0-davranış-değişimi). (I9d) gemini,
> gemini-cli bitişik. **Teorem ($0-landing):** chain daima bir $0-yerel tier içerir ve ona ulaşılır (cloud
> tükenirse) → sistem asla "hiç provider yok" durumuna düşmez. Kanıt: order-rest-latency/provider-fleet testleri.

Karmaşıklık: O(n log n) (tek sort), n=|providers|.

## 10. Chain-policy filter — non-empty + monoton (`chain-policy.ts filterChain`)

`filterChain(chain, opts)` zinciri kısıtlara göre süzer. `TERMINAL ⊆ result` DAİMA (terminal p → koşulsuz true).
> **Teorem (non-empty):** TERMINAL∩chain ≠ ∅ olduğundan `filterChain(chain,·) ⊇ TERMINAL∩chain ≠ ∅` — süzme
> asla boş bırakmaz ($0-landing korunur). **Monotonluk:** her koşul (privateMode/estTokensIn>maxContext/
> needTools∧toolCalling=none∨learned=false) yalnız ELER, eklemez → opts daha-kısıtlı ⇒ result ⊆. Learned-verdict
> catalog-default'u override eder. Kanıt: chain-policy.test.

## 11. SSRF host-guard — totality + no-bypass (`mcp/host-guard.ts classifyIp/blockedVerdict`) [güvenlik-core]

`classifyIp: Host → Verdict ∪ {"reject","null"}` — **total** (her string bir sonuç). Verdict =
{linklocal,loopback,rfc1918,cgnat,ula,wildcard,public}. Katı dotted-quad olmayan ama numeric-görünen →
`reject` (encoded-IP bypass savunması); IP-olmayan → null (DNS'e bırak).
> **Değişmezler:** (I11a) totality — tanımsız girdi yok. (I11b) `looksNumeric(host) ∧ ¬strictQuad ⇒ reject`
> (0x/8-bit-overflow/decimal-encoded bypass kapalı). (I11c) `blockedVerdict(linklocal,·)=true` DAİMA
> (metadata/fe80 asla erişilmez). (I11d) saas(multi-tenant) ⇒ yalnız `public` geçer; local-tek-kullanıcı ⇒
> linklocal-dışı her şey (localhost/private-upstream meşru). Kanıt: upstream-guard + §11 property.

## 12. Telemetry rollup — percentile + zero-leak (`telemetry.ts rollup/pct/redact*`)

`pct(sorted, p)` = nearest-rank (1-tabanlı, boş→0). `rollup(events, now)` 60s-pencere üzerinde p50/p95
(total,ttft), errorRate, tokPerSec, reqPerMin, costPerHr, provider-leaderboard.
> **Değişmezler:** (I12a) pXX ∈ [min,max] ∧ monoton (p50≤p95). (I12b) pencere-filtre: yalnız `now−ts ≤ 60s`.
> (I12c) `costPerHr = Σcost · 3.6e6 / windowMs` (exact extrapolation). (I12d) leaderboard tokPerSec-azalan sıralı.
> **Zero-leak:** `redactDeep` idempotent + fixpoint (`redactDeep∘redactDeep = redactDeep`), her secret-alan
> maskeli → prompt/completion/key browser'a ULAŞMAZ. Kanıt: telemetry.test + telemetry-zeroleak.test.

## 13. Rate-limit headroom — proaktif rotasyon (`key-limits.ts pctOfLimit/approaching`)

`pctOfLimit(counts, limit) = max(perMin>0 ? counts.perMin/perMin : 0, perDay>0 ? counts.perDay/perDay : 0)` —
**en-sıkı limit bağlar** (max). `approaching(pct, θ=0.8) = pct ≥ θ`.
> **Değişmezler:** (I13a) limitsiz-boyut (limit=0) → 0-katkı (bilinmeyen limit engellemez). (I13b) pct ≥ 0;
> her iki-limitin max'ı → en-erken-dolan pencere tetikler. (I13c) approaching eşik-gate (θ'da proaktif
> rotasyon, tükenmeden). Sliding perMin/perDay pencere monoton-decay (`key-usage.ts keyWindows`). Kanıt:
> **YENİ** key-limits-math.test (bu tur — daha önce testsiz saf-fn).

---

## Kompozisyon / Composition

Tick = HEALTH-GATE (§3) ∘ OBSERVE ∘ SIDE-EFFECT ∘ δ (§1) ∘ DRAIN (§5) ∘ PERSIST. Her tick saf-çekirdek
(§1-6) + sınırlı IO; bir alt-adım hatası **nötr sinyale** iner (daemon asla çıkmaz — I1 totality bunu garantiler).
Doğruluk-garantisi = gate (tsc+test) + revert-on-red; sistem-değişmezleri = §1-6 (property-test'le kanıtlı).

> **Ana teorem:** Sistem her tick'te (a) geçerli bir state üretir (I1,I5), (b) sonsuz-spirale girmez (§1
> termination + §5 drain sonlanma), (c) repo'yu bozmaz (gate+revert), (d) $0-yerel kalır (§3 return-to-preferred).

Kanıt: `vitest --project orchestra` → `math-properties.test.ts` 19/19.
