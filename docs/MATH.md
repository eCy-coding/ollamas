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

## Kompozisyon / Composition

Tick = HEALTH-GATE (§3) ∘ OBSERVE ∘ SIDE-EFFECT ∘ δ (§1) ∘ DRAIN (§5) ∘ PERSIST. Her tick saf-çekirdek
(§1-6) + sınırlı IO; bir alt-adım hatası **nötr sinyale** iner (daemon asla çıkmaz — I1 totality bunu garantiler).
Doğruluk-garantisi = gate (tsc+test) + revert-on-red; sistem-değişmezleri = §1-6 (property-test'le kanıtlı).

> **Ana teorem:** Sistem her tick'te (a) geçerli bir state üretir (I1,I5), (b) sonsuz-spirale girmez (§1
> termination + §5 drain sonlanma), (c) repo'yu bozmaz (gate+revert), (d) $0-yerel kalır (§3 return-to-preferred).

Kanıt: `vitest --project orchestra` → `math-properties.test.ts` 19/19.
