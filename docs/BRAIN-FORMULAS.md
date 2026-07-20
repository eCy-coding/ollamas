# BRAIN-FORMULAS — formüller.md ↔ gerçek kod eşlemesi (2026-07-20)

Kaynak: `~/Desktop/formüller.md` (ortak-brain: RAG + MoE + kişiselleştirme).

| Formül | Anlamı | Kod karşılığı |
|---|---|---|
| `v_i = E_θ(c_i)`, `B = {(c_i,v_i)}` | vektör-indeks / non-parametric memory | `server/brain.ts` (sqlite-vec `brain_vec` + FTS5 `brain_fts`) |
| `q = E_θ(x)` | sorgu gömme | `resolveEmbedder()` → `recall()` içi embed (write-behind bütçeli) |
| `p_ret(z\|x) = softmax(qᵀd(z))` | retrieval olasılığı | `retrievalProbabilities(scores, T)` — `server/brain-formulas.ts` |
| `R_k(x) = TopK p_ret` | top-k belge | `recall()` hybrid RRF (vektör ∪ BM25) + rerank + `gatherContext()` |
| `p_j(y\|x)` | uzman-başı üretim | `askShared` → `experts.{ollamas,ecym,odysseus}` (aynı R_k(x)) |
| `w_j(x) = softmax(W_g q + b_g)` | MoE gate | `gateLogits` + `gateWeights` + `heuristicBias` (soğuk başlangıç) |
| `p_final = Σ_j w_j p_j` | karışım | `expectedMixture` (saf matematik) · `mixtureSelect` (çalışan biçim) |
| `p_u = E_ψ(historik)`, `q* = q + λp_u` | kişiselleştirme | `profileVector` + `personalizeQuery` (λ = `BRAIN_PERSONALIZE_LAMBDA`, 0.2) |
| gate öğrenimi | online kalibrasyon | `updateGate` (perceptron-benzeri; loop her turda çağırır, `~/.llm-mission-control/gate.json`) |

## Dürüstlük notu (yaklaşım nerede)
Tam `p_final = Σ_j w_j p_j(y|x)` token-logprob ister; yerel/keyless sağlayıcılar logprob
vermiyor. Çalışan biçim `mixtureSelect`: erişilebilir uzmanlar üzerinden ağırlık
renormalize edilir ve en yüksek `w_j`'li cevap seçilir. `expectedMixture` matematiğin
kendisidir; logprob eriştiğimiz gün doğrudan devreye girer. Formül kılık değiştirmiyor —
yaklaşım işaretli.

## Sonsuz loop (`scripts/brain-loop.ts`, `make brain-loop`)
```
her tur (launchd 15 dk):
  GPU meşgul? → ATLA          (yerel model chat ile yarışmaz)
  zayıf nokta seç             (hiç recall edilmemiş knowledge kaydı → soru)
  askShared                   (TEK retrieval → 3 uzman → gate → seçim)
  kalite kapısı               (abstain değil + ≥2 kaynak + anlamlı uzunluk)
  brain'e yaz                 (ns=loop, learned, conf 0.7)
  gate kalibre                (kazanan uzman bu sorgu yönünde güçlenir)
  her 4 turda ekosistem-sync  (odysseus fact + eCym komutları)
```
**Emniyet:** uzman-başı 25s (`BRAIN_EXPERT_TIMEOUT_MS`), tur bütçesi 90s
(`BRAIN_LOOP_BUDGET_MS`), günlük yazım tavanı 40 (`BRAIN_LOOP_MAX_WRITES`), tekrar-soru
koruması (hash), tek-örnek pid kilidi (10 dk bayat eşiği), acil durdurma `BRAIN_LOOP=0`,
iş bitince süreç kapanır (asılı fetch'ler launchd'de süreç biriktirmesin).

**Mimari:** loop bir İSTEMCİdir — brain.db'yi doğrudan açmaz, canlı :3000 API'sini
kullanır (`/api/brain/recall`, `/api/brain/remember`). Paylaşımlı checkout'ta başka
lane'in WIP'i (embed provider-id fingerprint geçişi) loop'u düşürmez; WAL kilidi ve
provider-mismatch yüzeyi sıfırdır.

**Kurulum (Emre onaylı):** `make brain-loop` tek tur · `make brain-loop-install` sonsuz
(launchd `com.ollamas.brain-loop`, 15 dk, nice 10, log `/tmp/ollamas-brain-loop.log`).
