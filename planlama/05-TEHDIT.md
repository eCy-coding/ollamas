# 05-TEHDIT — ollamas threat model

> Odysseus `THREAT_MODEL.md` + `SECURITY.md` pattern'i. Tohum: NEXT_TODO derin-audit
> [V]=doğrulanmış bulgular (2026-06-21 cycle-2). Bu doküman P2 fazının iş listesi kaynağı;
> her mitigasyon bir teste bağlanır (D18). Damga: 2026-07-10 · c5ac42d.

## §1 Varlıklar (korunacaklar)

| Varlık | Nerede |
|---|---|
| API key'ler / hardware-vault | `db.ts` AES-256-GCM vault, Secure-Enclave opt-in, key-health loop |
| Tenant workspace dosyaları | `server/files.ts` root-confinement |
| Host makine (RCE yüzeyi) | `server/commander.ts`, `/api/*terminal*`, host-bridge |
| Billing/usage kayıtları (Stripe) | `server/billing/`, `recordUsage/recordAudit` |
| Mesh/tunnel trafiği | `backend/mesh/`, `tunnel/`, contract federation (olm_ key) |
| CI/CD bütünlüğü | `.github/workflows/*` |

## §2 Güven modeli — TEK SUNUCU, İKİ DÜNYA

Kök tehdit (NEXT_TODO [V] CRITICAL): **local-dashboard (localhost-trust) + multi-tenant-SaaS
(untrusted internet) aynı server'da.** `SAAS_ENFORCE=1` + internet exposure ⇒ kimliksiz host RCE.
Tüm P2 kararları bu ayrıma göre verilir: bir route ya `authMiddleware`'lidir ya localhost-bind'dır
— üçüncü hal yok.

## §3 Saldırı yüzeyleri → mitigasyon → test matrisi

| ID | Yüzey | Tehdit | Mitigasyon (hedef durum) | Kanıt testi/komutu | Durum |
|---|---|---|---|---|---|
| T-01 | `/api/macos-terminal` (server.ts:960), `/api/terminal` (:924), `/api/pipeline` (:985), `/api/agent/chat`, `/api/workspace/*` | unauth host RCE + cross-tenant erişim (SaaS modda) | SaaS'ta authMiddleware zorunlu VEYA localhost-bind; route-tablosu testi "authsuz route listesi = onaylı allowlist" | `vitest run tests/server/auth-boundary*` (P2'de yazılır) | ✅ 2026-07-10 · localowner-guard 4/4 (SaaS 403) + M-001/M-002 invariant (canlı M-044) |
| T-02 | `server/commander.ts:41` | `execPromise(\`${cmd} ${args.join(' ')}\`)` — args'a `;\|$()` ⇒ RCE; allowlist yalnız binary'yi gate'liyor | `execFile` array-args; shell=false | `vitest run tests/server/commander*` injection case'leri | ✅ 2026-07-10 · commander.ts:46 execFile argv-array + commander-exec injection-red testi (M-003) |
| T-03 | `/api/pipeline` SSE-before-validate (:985-998) | validate'siz stream başlar; boş prompt ⇒ bozuk stream, 400 yok | setHeader öncesi validate (agent/chat kardeş fix'i pattern'i) | pipeline validate testi | ✅ 2026-07-10 · validate-order testi boot-harness'la (M-004, 06e27f4) |
| T-04 | adminGuard rate-limit yokluğu | zayıf/sızmış admin token brute-force | throttle + min-32-char token şartı | admin brute-force testi | ✅ 2026-07-10 · brute-force→lock testi (M-006, MAX_FAILS=5/15dk, timing-safe) |
| T-05 | `providers.ts` `JSON.parse(tc.function.arguments)` ×4 (288, 371, +2) | bozuk tool-JSON ⇒ throw ⇒ provider düşer | mevcut `safeParse(...) ?? {}` uygulanır | bozuk-JSON fixture testi | ✅ 2026-07-10 · safeParse sarımı + bozuk-JSON fallback testi (M-007) |
| T-06 | `.github/workflows/release-binary.yml:40,52` `${{ github.ref_name }}` | tag-adı üzerinden CI shell-injection (tag-push gerekir → P1) | `env:` ara değişken + `"$REF"` | workflow lint + `gh run` yeşil | ✅kod 2026-07-10 · yml:86 env-ara-değişken + lint (M-008); CI-koşusu default-branch'te YOK → Emre push-gate (D14) |
| T-07 | Cloud master-key (`db.ts:108-128`) | Cloud Run'da boot-başı `randomBytes(32)` ⇒ eski ciphertext çözülemez ⇒ sessiz billing/auth kesintisi | Secret Manager'dan yükle; `isCloud` + key yok ⇒ fail-closed | boot testi: key'siz cloud boot ⇒ exit non-zero | ✅ 2026-07-10 · fail-closed 16/16 + install.sh MASTER_KEY_B64 bootstrap (M-020, e5ebc1e) |
| T-08 | `recordUsage/recordAudit` unawaited (server.ts:655,685,1314) | DB-fail ⇒ yutulan rejection ⇒ sessiz billing/audit kaybı | `.catch(log)` + alarm sayacı | rejection-injection testi | ✅ 2026-07-10 · best-effort swallow testi (M-005) + M-049 unhandledRejection sayaç/alarm (db14cdb) |
| T-09 | docker-compose writable-filesystem ×2 | container kaçışında kalıcılık | `read_only: true` + tmpfs | compose config denetimi | ✅ 2026-07-10 · compose read_only+tmpfs (M-011) + `docker compose config -q` exit-0 (S-015) |
| T-10 | `colab_exec.py` dynamic-urllib ×2 | `file://` scheme ile lokal dosya okuma | scheme allowlist (http/https) | urllib guard testi | ✅ 2026-07-10 · urllib scheme-allowlist python 8/8 (M-010) |
| T-11 | dynamic-regexp ×18 (`detect-non-literal-regexp`) | user-controlled pattern ⇒ ReDoS | audit: gerçek user-input olanlara anchor/escape; kalanı gerekçeli nosemgrep | semgrep baseline diff = 0 yeni | ✅ 2026-07-10 · semgrep ERROR=0 canlı (M-044); threatfeed name-literal nosemgrep gerekçeli (M-009) |
| T-12 | Prompt-injection (tool çıktısı / dosya / LLM yanıtı) | agent'a talimat enjeksiyonu | 00-ANAYASA §4 untrusted-data kuralı; agent prompt'larında veri/talimat ayrımı; injection girişimi 09-SEYIR'e log | agent-loop injection fixture testi (mevcutsa referansla, yoksa P2 backlog) | ✅ 2026-07-10 · tests/agent-injection.test.ts 8/8 (role-escalation-yok ×3 provider, opaque-string, wire-body, markup→toolCall-yok, executor-spy-çağrısız, boundary-pin); artık-risk: model-eko → tier-gate+T0-onay katmanı (S-018) |

## §4 Doğrulanmış GÜÇLÜ yanlar (yeniden iş açma — YASAK)

Derin-audit gerekçeyle elemiş; bunlara P0 açmak stale-severity ihlalidir (00-ANAYASA §3.7):

- **Path-traversal `files.ts`/`commander.ts`:** `resolve` + `startsWith(root+sep)` guard MEVCUT → FP.
- **Vault AES-256-GCM:** 12-byte fresh IV, `authTagLength:16` pinli, short-tag reject → zayıflık yok.
- **MCP subscribe URI:** workspace-içi `resolveSafePath` + traversal testi kanıtlı (SEYIR).

## §5 Kabul edilen riskler (Emre onayı gerektirir)

| Risk | Gerekçe adayı | Onay |
|---|---|---|
| gcm-no-tag-length semgrep ×2 | FP DOĞRULANDI: setAuthTag mevcut + canlı semgrep ERROR=0 (M-044) | ✅ Emre onayı 2026-07-10 (S-018) |
| 3 moderate npm audit | canlı değer (2026-07-10); high/critical=0 | ✅ Emre onayı 2026-07-10 (S-018) |
| 13 skipped live-e2e | gerçek-infra gated; 21 gated skip docs/TESTING.md gerekçeli (M-014) | ✅ Emre onayı 2026-07-10 (S-018) |

## §6 Politika

- Yeni route eklerken: auth kararı (middleware/localhost-bind) PR açıklamasında zorunlu.
- Yeni tool eklerken: `ToolTier` (safe/host/privileged/host_upstream) ataması + tier gerekçesi.
- Key/kredensiyel repo'ya girmez; `git log -S` taraması 06-KOR-NOKTA #12'de periyodik.


## §6 Nihai imza

**§3 matrisi (T-01..T-12) + §5 kabul-edilen-riskler Emre (T0) tarafından onaylandı — 2026-07-10, GA-FINALIZE (S-018).** T-12 fixture-testi aynı oturumda eklendi; kalan tek koşul tag-CI kanıtı (D14).
