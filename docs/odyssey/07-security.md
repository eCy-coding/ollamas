# ODYSSEY O6 — Security: 2FA/TOTP + RBAC + Tool-Policy + Threat-Model + Prompt-Injection Guard

> **Odyssey planı** — ollamas'ı odysseus-kalitesinde self-hosted AI-workspace'e evrimleştirme.
> Bu dosya **O6 (Security)** kapsamını kaplar. Dil: TR · kod/komut/dosya-yolu: EN.
> **Doğrulama disiplini:** her iddia `/Users/emrecnyngmail.com/Desktop/ollamas` gerçek koduna karşı Read/Grep ile doğrulandı (aşağıda dosya:satır referansları).

---

## 1. Kapsam ve Hedef

**O6 = 5 alt-modül:**

| # | Alt-modül | odysseus emsali | ollamas mevcut | Δ (delta) |
|---|-----------|-----------------|----------------|-----------|
| O6.1 | **2FA / TOTP** | TOTP enrollment + login step-up | **YOK** | Sıfırdan |
| O6.2 | **RBAC (admin / non-admin)** | admin vs non-admin user rolü | **Kısmi** — token-tipi ayrımı var, `role` yok | Rol modeli ekle |
| O6.3 | **Tool-Policy (tehlikeli-op kısıtlama)** | `tool_policy` / `tool_security` (admin-only tehlikeli tool) | **Kısmi** — `ToolTier` + `allowedTiers` + `tools:<tier>` scope | Policy'yi role'e bağla + explicit-confirm |
| O6.4 | **threat-model.md** | (implicit, docs) | **YOK** | Yaz |
| O6.5 | **Prompt-Injection Guard (Şef-3 poison-guard)** | tool-output untrust + injection sanitize | **Kısmi** — secret-redaction interceptor + verifier | Poison-guard interceptor ekle |

**Kabul kriteri (üst düzey):** SAAS_ENFORCE=1 çok-kiracılı modda, admin-olmayan bir kiracının hiçbir `privileged`-tier tool'u çağıramaması + step-up 2FA olmadan admin işlem yapamaması + upstream tool çıktısındaki enjeksiyon talimatlarının conductor'a sızmaması.

---

## 2. Mevcut Durum (kanıt-temelli, kod okundu)

### 2.1 Auth katmanı — VAR ve olgun

> **Dosya-yolu netliği:** Ana Express sunucusu **repo-kökündeki `server.ts`** (163k, `package.json` `dev: tsx server.ts`) — `server/server.ts` DEĞİL. Aşağıdaki `server.ts:NNN` referansları kök dosyaya, `server/…` referansları `server/` alt-dizinine aittir. Tüm satır no'ları 2026-07-10 kod-okumasıyla doğrulandı.

- **`localOwnerGuard`** (`server.ts:276-294`): `SAAS_ENFORCE=1` iken tek-owner DASHBOARD yüzeyini (`/api/terminal`, `/api/pipeline`, `/api/workspace`, `/api/agent`, `/api/generate`, `/api/security`, `/api/cluster` …) fail-closed 403 yapar. Lokal modda (enforce yok) geçirir.
- **`authMiddleware(required)`** (`server/middleware/auth.ts:99-124`): Bearer/X-API-Key → tenant+plan+scopes çözer, `req.tenant`'a ekler. 3 kimlik yolu:
  1. Opaque API key `olm_*` → `resolveKey` (SHA-256 store lookup).
  2. Opaque OAuth token `ot_*` → `resolveOAuth` + RFC 8707 resource/audience eşleşmesi (`auth.ts:60-71`).
  3. Harici OAuth 2.1 JWT → JWKS ile `jwtVerify` (`auth.ts:74-92`), sadece `OAUTH_ISSUER` set iken.
- **`adminGuard`** (`server.ts:2566-2593`): `X-Admin-Token` (`SAAS_ADMIN_TOKEN`). `crypto.timingSafeEqual` (uzunluk + sabit-zaman karşılaştırma, `:2578-2580`) + **per-IP brute-force throttle** (`adminFailures` Map `:2563`, `ADMIN_MAX_FAILS=5` `:2564`, `ADMIN_LOCK_MS=15dk` `:2565`, kilitli IP → 429 + `Retry-After` `:2572-2574`, başarı → sayaç sıfırla `:2587`). `SAAS_ENFORCE=1` + token yoksa fail-closed 403 (`:2588-2590`). Korunan rotalar: `/api/saas/*` (tenant/key/plan/audit CRUD, `:2594-2625`) + contract lane (`:2629`).
- **`requireScope(scope)`** (`server.ts:2670-2673`): `req.tenant.scopes` içinde scope yoksa 403 `insufficient_scope`. Self-serve rotalarında kullanılıyor (`usage:read`, `keys:write`, `webhooks:write`).
- **`rateLimitMiddleware`** (`server/middleware/rate-limit.ts`): per-tenant token-bucket + aylık kota; Redis opsiyonel, bellek fallback + DoS-guard bucket eviction.

### 2.2 Tool-policy — KISMİ VAR (tier tabanlı, choke-point'te)

- **`ToolTier = "safe" | "host" | "privileged" | "host_upstream"`** (`server/tool-registry.ts:43`).
- **Tek choke-point `ToolRegistry.execute()`** (`tool-registry.ts:882-961`) her tool çağrısını gate'ler, sırayla:
  1. Bilinmeyen tool → reddet (`:888`).
  2. **Per-tenant ownership** (`:895-899`): sahipli upstream tool'u başka kiracı çağıramaz (deny-by-default, Faz 24).
  3. **Per-tenant allowlist** (`:901-904`): `ctx.allowedTiers` içinde tier yoksa reddet.
  4. **OAuth scope enforcement** (`:907-910`): scope varsa, `safe`-dışı tool `tools:<tier>` scope ister.
  5. abort → PRE-interceptor (cache) → invoke → outputSchema → POST-interceptor (redact).
- **`privileged` tier tehlikeli tool örnekleri**: `macos_terminal` "no sandbox/allowlist — full host privileges" (`tool-registry.ts:339-342`), `run_command` (privileged, `:359`).
- **Plan → allowedTiers**: `plans.allowed_tiers` kolonu default `'safe'` (`server/store/index.ts` schema).
- **`tool-interceptors.ts`**: `redactionInterceptor` (gitleaks/secretlint pattern'leri, `:62-107`) + `cacheInterceptor` (read-only, `:113-144`). Choke-point'e `runPre`/`runPost` ile takılıyor.

### 2.3 EKSİK olanlar (O6'nın gerçek işi)

- ❌ **2FA/TOTP hiç yok.** Grep: `totp|speakeasy|otplib|otpauth|authenticator` → 0 sonuç. Sadece `jose@6` var (JWT için, TOTP değil).
- ❌ **`role` kolonu yok.** `tenants` schema (`store/index.ts`): `id, name, plan_id, stripe_customer_id, created_at` — rol alanı yok. "Admin" ≠ rol; sadece ayrı `SAAS_ADMIN_TOKEN` mekanizması. Admin-olmayan bir kiracı = admin token'ı olmayan kiracı (implicit).
- ❌ **threat-model.md yok** (`docs/` altında dosya yok).
- ❌ **Prompt-injection / poison-guard yok.** "Şef-3 poison-guard" mevcut kodda YOK (grep: `poison|sef-3|injection` council/orchestration'da eşleşmedi). Var olan: `server.ts:1626` "independent verifier" deseni + `redactionInterceptor` (secret maskeleme, enjeksiyon-talimatı tespiti değil).
- ⚠️ **İki ayrı denetim kanalı VAR, genişletilebilir:**
  - `audit_events` tablosu (`server/store/index.ts:119-122`: `tenant_id, tool, tier, ok, ts` + `idx_audit_tenant` index) — `recordAudit` (`server.ts:1553`, `:2400`) `safe`-dışı tool çağrılarını yazar; `GET /api/saas/audit` (`server.ts:2621`) adminGuard'lı okur. 2FA/role-deny olayları buraya (veya kardeş `auth_events` tablosuna) eklenecek → Repudiation mitigasyonu.
  - `db.logSecurity(category, what, how, decision)` (`server/db.ts:346`) — `ToolDeps.db.logSecurity` üzerinden choke-point'e enjekte (`tool-registry.ts:54`). Güvenlik-kararı (deny/allow) günlüğü için ikinci kanal.

---

## 3. odysseus Referans Modeli

odysseus (FastAPI+VanillaJS+SQLite) güvenlik deseni:
- **2FA**: TOTP enrollment (QR + secret), login sonrası step-up doğrulama, recovery codes.
- **RBAC**: `admin` / non-admin ikili rolü; admin panelinden user+tool yönetimi.
- **`tool_policy` / `tool_security`**: tehlikeli tool'lar (shell, filesystem-write, network) admin-only; non-admin allowlist'i config-driven (`.env` toggle).
- **Extensibility sırrı**: MCP-as-extension + config-driven policy → policy koda gömülü değil, veriyle sürülür.

**ollamas avantajı**: choke-point (`execute()`) + tier modeli zaten odysseus'un `tool_policy`'sinin yapısal karşılığı. O6, bu choke-point'e **role-farkındalık + poison-guard interceptor + step-up gate** eklemekten ibaret — sıfırdan mimari değil.

---

## 4. Hedef Plan (TDD-adımlı, test-önce)

> Her adımın sırası: **RED (test yaz, fail)** → **GREEN (min implement)** → **REFACTOR**. Değişmez kural: implementer ≠ verifier; type-check + lint + fresh vitest yeşil olmadan commit yok.

### O6.1 — 2FA / TOTP

**Bağımlılık:** `otplib` (MIT, RFC 6238 TOTP) + `qrcode` (enrollment QR). `jose` zaten var (recovery JWT gerekmez).

**Schema (yeni migration, `server/store/migrations.ts`):**
```
ALTER TABLE tenants ADD COLUMN totp_secret TEXT;          -- AES-encrypted (db.masterKey)
ALTER TABLE tenants ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
CREATE TABLE totp_recovery_codes (tenant_id TEXT, code_hash TEXT, used INTEGER DEFAULT 0);
```

**TDD adımları:**
1. **RED** `server/__tests__/totp.test.ts`: `generateTotpSecret()` 32-char base32 üretir; `verifyTotp(secret, token)` ±1 window kabul eder, replay (aynı token 2×) reddeder.
   **GREEN** `server/security/totp.ts`: otplib wrapper, secret `db.encrypt()` ile AES-encrypt saklanır. **Doğrulanmış API (GAP-1 KAPALI):** `db.ts:312` `public encrypt(plaintext: string): string` → AES-256-GCM, çıktı `iv:tag:ciphertext` (hex), `authTagLength=16` (kısa-tag forgery reddi, Node #52327); simetrik `db.ts:326` `public decrypt(ciphertext): string`. Master-key fail-closed (`db.ts:199-273`, `masterKeyStatus()` `db.ts:283`). Yani TOTP secret için sıfır-yeni-crypto — mevcut vault primitivi yeterli.
2. **RED** enrollment testi: `POST /api/security/2fa/enroll` → `{ secret, otpauthUrl, qrDataUri }` döner, `totp_enabled=0` kalır (doğrulanana dek).
   **GREEN** rota + `qrcode` data-URI.
3. **RED** activation testi: `POST /api/security/2fa/verify {token}` → geçerli token `totp_enabled=1` yapar + 10 recovery code (hash'lenmiş) döner.
   **GREEN** rota + recovery-code SHA-256 store.
4. **RED** step-up gate testi: `totp_enabled=1` iken admin-tier işlem `X-TOTP` header'sız → 401 `totp_required`; geçerli token → geçer; recovery-code tek-kullanımlık.
   **GREEN** `requireTotp()` middleware, `adminGuard` sonrası zincirlenir.

**Kritik:** TOTP secret'ı ASLA plaintext loglanmaz/dönmez — `redactionInterceptor` ASSIGN_RE zaten `secret=...` maskeler ama enrollment yanıtı bilinçli tek-sefer gösterilir; log'a düşmesin diye `console` çağrısı yasak (test: log-capture'da secret yok).

### O6.2 — RBAC (admin / non-admin)

**Schema:**
```
ALTER TABLE tenants ADD COLUMN role TEXT NOT NULL DEFAULT 'user';  -- 'admin' | 'user'
```
`ResolvedKey` interface'ine (`server/store/index.ts`) `role: "admin" | "user"` eklenir; `resolveKey`/`resolveOAuth`/`verifyJwt` (`server/middleware/auth.ts:60-92`) rolü doldurur (JWT'de `role` claim; API-key/OAuth'ta tenant satırından). **Wiring noktası doğrulandı (GAP-2 KAPALI):** `role` iki ToolCtx-inşa noktasından MCP yüzeyinde `mcpCtxFactory` (`server.ts:2385-2394`) içine `role: t?.role` olarak eklenir — `allowedTiers`/`scopes`/`tenantId`'nin zaten `req.tenant` (`t`, `:2386`) satırından doldurulduğu aynı yer. Lokal agent-loop çağrısı (`server.ts:1546-1548`, `tenantId:"local"`) için `role:"admin"` sabitlenir (lokal-owner = tam yetki).

**TDD adımları:**
1. **RED** `server/__tests__/rbac.test.ts`: `resolveKey` çözümünde `role` alanı gelir; migration öncesi eski kayıtlar `'user'` default alır.
   **GREEN** migration + `resolveKey` SELECT'e `role` ekle.
2. **RED** `requireRole("admin")` middleware testi: `req.tenant.role !== "admin"` → 403 `forbidden_role`.
   **GREEN** `server/middleware/rbac.ts`.
3. **RED** entegrasyon: admin-olmayan token ile admin-only rota → 403; admin token → geçer. `adminGuard` (X-Admin-Token) korunur ama artık `role='admin'` tenant'lar da self-serve admin API'ye erişebilir (ikili yol: platform-admin token VEYA tenant-role admin).

**Not (blind-spot azaltıcı):** `SAAS_ADMIN_TOKEN` (platform süper-admin) ≠ tenant `role='admin'` (kiracı-içi admin). İkisi ayrı katman — karıştırma. Threat-model'de net ayrım (§5).

### O6.3 — Tool-Policy (role-aware, tehlikeli-op kısıtlama)

**Mevcut choke-point'i genişlet — YENİ dosya yerine `execute()`'a ek gate.**

**TDD adımları:**
1. **RED** `tool-registry.execute` testi: `ctx.role !== "admin"` iken `privileged` tier tool → `{ ok:false, error:"tool_not_permitted: privileged requires admin role" }`. `ToolCtx`'e `role?: "admin"|"user"` eklenir (`tool-registry.ts:75` civarı interface).
   **GREEN** execute'a scope-gate'ten SONRA (`:910` sonrası) role-gate:
   ```ts
   if (ctx.role && ctx.role !== "admin" && (tool.tier === "privileged")) {
     emit(false);
     return { ok:false, output:{error:`tool_not_permitted: '${name}' (tier=privileged) requires admin role`}, diff:"", applied:false, halt:false };
   }
   ```
2. **RED** config-driven policy testi (odysseus-parity: `.env` toggle): `TOOL_POLICY_DENY_TIERS="host,privileged"` env → non-admin bu tier'ları çağıramaz; boş → mevcut davranış.
   **GREEN** `server/tool-policy.ts`: env-parse + `isTierAllowed(role, tier)` pure fn (test edilebilir, choke-point'ten çağrılır).
3. **RED** explicit-confirm testi: `privileged` tool admin-tarafından da olsa `ctx.confirmToken` yoksa → `halt:true` "pending authorization" (mevcut `write_file` deseni, `tool-registry.ts:272` ile simetrik).
   **GREEN** opsiyonel `TOOL_POLICY_REQUIRE_CONFIRM=1` altında halt.

**Kabul:** `run_command` + `macos_terminal` (privileged) non-admin kiracıya kapalı; policy koda gömülü değil, `.env` ile sürülür (config-driven).

### O6.4 — threat-model.md

**Yeni dosya:** `docs/odyssey/07-security-threat-model.md`. STRIDE tablosu + trust-boundary diyagramı (metin).

**İçerik (min):**
- **Trust boundaries**: (a) localhost owner (lokal mod, tam yetki) · (b) tenant caller (SAAS_ENFORCE=1, scoped) · (c) platform admin (X-Admin-Token) · (d) upstream MCP server çıktısı (**untrusted**, SSRF+injection yüzeyi).
- **STRIDE** her boundary için: Spoofing (TOTP+timingSafeEqual), Tampering (HMAC webhook `bridge-hmac.ts`), Repudiation (`audit_events` tablosu), Info-disclosure (redactionInterceptor), DoS (rate-limit + adminFailures + bucket-eviction), Elevation (tier+role gate).
- **Bilinen kalıntı riskler**: lokal mod owner = tam host yetkisi (kabul edilen tasarım); privileged-residue manuel gate (`SEYIR_DEFTERI_ORCHESTRATION.md:563` .claude/settings.json hook).

**TDD:** doküman → test yok; ama **her STRIDE satırına karşılık bir mevcut/planlı test** eşlenir (traceability tablosu). Kanıt: her mitigation'ın test dosyası:satır referansı.

### O6.5 — Prompt-Injection Guard (Şef-3 poison-guard)

**Yeni interceptor** — mevcut `tool-interceptors.ts` çerçevesine takılır (choke-point re-edit yok, §2.2 deseni).

**Tasarım:** upstream/untrusted tool çıktısındaki enjeksiyon talimatlarını (`ignore previous instructions`, `system:`, `you are now`, tool-call spoofing, exfil URL'leri) tespit + nötrle. "Şef-3" = orchestration'daki üçüncü doğrulama katmanı (conductor'a beslemeden önce).

**TDD adımları:**
1. **RED** `server/__tests__/poison-guard.test.ts`: `detectInjection(text)` bilinen payload'ları (prompt-injection corpus, DATA olarak) flag'ler; benign metni flag'lemez (false-positive < eşik).
   **GREEN** `server/security/poison-guard.ts`: pattern seti + heuristic (imperative-override cümleleri, gizli unicode, base64-encoded talimat).
2. **RED** interceptor testi: `poisonGuardInterceptor.post` `host_upstream`-tier tool çıktısında injection bulursa → çıktıyı `⚠️ [POISON-GUARD: N talimat nötrlendi]` ile sarar + `halt` opsiyonel. Built-in `safe`-tier tool'a dokunmaz (false-pos minimizasyonu).
   **GREEN** `registerInterceptor(poisonGuardInterceptor)` — `redactionInterceptor`'dan SONRA (redact edilmiş metinde tara).
3. **RED** conductor-entegrasyon: verifier deseniyle (`server.ts:1626`) simetrik — flag'lenmiş çıktı bir sonraki agent-loop turuna "quarantined" olarak girer, ham talimat değil.
   **GREEN** `MCP_POISON_GUARD=1` (default ON `host_upstream` için) toggle.

**Kabul:** `::ffff:` SSRF (mevcut `host-guard.ts` kapsar) + injection-in-tool-output (yeni guard) birlikte upstream saldırı yüzeyini kapatır.

---

## 5. Uygulama Sırası ve Bağımlılıklar

```
O6.2 (RBAC role kolonu) ─┬─→ O6.3 (role-aware tool-policy)
                         └─→ O6.1 step-up gate (requireTotp admin-only)
O6.1 (TOTP)  ─── bağımsız başlar (schema + otplib)
O6.5 (poison-guard) ─── tamamen bağımsız (interceptor, paralel)
O6.4 (threat-model) ─── EN SON (diğerlerinin mitigation'larını referanslar)
```

**Paralel-güvenli:** O6.1 (TOTP core) ve O6.5 (poison-guard) aynı anda kodlanabilir (ayrı dosya, ortak-state yok). O6.3, O6.2'nin `role` kolonuna bağlı → O6.2 bitmeden başlama.

**Kalite kapısı (her adım):** `npm run typecheck` (tsc 0) + `eslint` + `vitest` fresh-run yeşil. Yeni deps için `.gitleaks.toml`/`.trivyignore` etkilenmez; `otplib`+`qrcode` supply-chain audit (mevcut `tob-supply-chain-risk-auditor` deseni).

---

## 6. odysseus-Parity Kabul Kriterleri

| Kriter | Ölçüm (test/komut) | Parity durumu |
|--------|--------------------|---------------|
| TOTP enrollment + verify + recovery | `totp.test.ts` yeşil; `POST /api/security/2fa/*` E2E | **=** odysseus |
| Step-up 2FA admin işlemde | `totp_enabled=1` iken `X-TOTP`'siz admin → 401 | **=** odysseus |
| RBAC admin/non-admin | `rbac.test.ts`; non-admin → 403 admin rotada | **=** odysseus |
| Tehlikeli tool non-admin'e kapalı | `execute()` privileged+non-admin → `tool_not_permitted` | **=** odysseus `tool_policy` |
| Config-driven policy (.env) | `TOOL_POLICY_DENY_TIERS` env testi | **=** odysseus config-driven |
| Prompt-injection nötrleme | `poison-guard.test.ts`; upstream payload flag | **≥** odysseus (interceptor-native) |
| threat-model dokümante | `07-security-threat-model.md` + STRIDE traceability | **=** odysseus (implicit→explicit) |
| Auth event audit | `audit_events` 2FA/role-deny olaylarını kaydeder | **≥** odysseus |

**Parity tanımı:** odysseus'un `2FA/RBAC + tool_policy/tool_security` yeteneklerinin fonksiyonel eşdeğeri + ollamas'ın choke-point avantajıyla injection-guard'da üstü.

---

## 7. Kör-Nokta Ledger

> Bilinmeyenler, varsayımlar, riskler — açıkça listelenir (gizleme yasağı).

### Varsayımlar (VAR-)
- **VAR-1:** "Şef-3 poison-guard" adı görevden geldi; mevcut kodda karşılığı YOK (grep boş). Bunu orchestration'ın 3-katman verifier deseninin (`server.ts:1626` verifier) uzantısı olarak yorumladım. **Emre onayı gerek:** "Şef-3" spesifik bir mevcut bileşen mi, yoksa yeni-inşa mı?
- **VAR-2:** RBAC'ın `role` kolonu `tenants` tablosunda konumlanmalı varsaydım. Alternatif: ayrı `users` tablosu (odysseus user-merkezli). ollamas **tenant-merkezli** (users tablosu yok) — tenant=user eşlemesi varsayıldı. Çok-kullanıcılı-tek-tenant senaryosu bu planda YOK.
- **VAR-3 (DOĞRULANDI → varsayım değil):** TOTP secret'ı `db.encrypt()` ile şifrelenir. `server/db.ts:312-344` okundu: `encrypt`/`decrypt` public, AES-256-GCM, `iv:tag:ciphertext` (hex), `authTagLength=16`. Yeni crypto yazılmaz; mevcut vault primitivi kullanılır. → GAP-1 ile birlikte kapandı.

### Bilinmeyenler (BIL-)
- **BIL-1:** Lokal mod (SAAS_ENFORCE≠1) owner'a 2FA uygulanmalı mı? odysseus self-hosted'da genelde uygulanır. Varsayılan planım: **2FA sadece SAAS_ENFORCE=1 admin işlemlerde** (lokal-owner UX bozulmasın). Emre kararı gerek.
- **BIL-2:** `otplib` vs `otpauth` — hangisi supply-chain açısından tercih? İkisi de MIT. `otpauth` daha küçük dep-tree; O6.1 öncesi `tob-supply-chain-risk-auditor` ile teyit.
- **BIL-3:** Poison-guard false-positive eşiği — `host_upstream` çıktısında meşru "system:" kelimesi (ör. bir log satırı) flag'lenirse UX bozulur. Eşik kalibrasyonu için gerçek upstream-tool çıktı korpusu gerek (şu an yok).
- **BIL-4:** `redactionInterceptor`+`poisonGuardInterceptor` sıralaması: redact SONRA tara dedim, ama redaction bir injection payload'ını maskeleyip guard'ı köreltebilir mi? Sıralama testle doğrulanmalı (O6.5 adım-2 edge-case).

### Riskler (RISK-)
- **RISK-1 (orta):** RBAC `role` migration eski kayıtlara `'user'` default verir → mevcut tek-owner deployment'ta owner yanlışlıkla non-admin olabilir. **Mitigasyon:** migration'da "eğer tek tenant varsa role='admin'" backfill; test: migration idempotent + owner admin kalır.
- **RISK-2 (orta):** Step-up 2FA gate yanlış zincirlenirse (`adminGuard` ÖNCE mi SONRA mı) ya kilitler ya bypass eder. **Mitigasyon:** `authMiddleware → requireRole → requireTotp` sırası testle sabitlenir; sıra-bağımlılığı E2E'de kanıtlanır.
- **RISK-3 (düşük):** In-memory `adminFailures`/rate-limit çok-replica'da paylaşılmaz (`server.ts:2561` yorumu kabul ediyor). 2FA replay-koruması da in-memory olursa aynı sorun. **Mitigasyon:** replay penceresi store-backed (Redis/pg) — çok-replica prod için O6.1 adım-1'de not.
- **RISK-4 (orta):** Poison-guard bir güvenlik-teatro olabilir (regex ile injection tam çözülmez — LLM-tabanlı saldırılar pattern'i atlatır). **Dürüst kabul:** bu bir defense-in-depth katmanı, tam çözüm değil. Asıl savunma = tool çıktısını hiç "talimat" olarak yorumlamayan agent-loop mimarisi (verifier izolasyonu). Guard = ikincil.
- **RISK-5 (düşük):** `docs/odyssey/05-features/` boş → başka odyssey dosyası format-emsali yok. Bu dosyanın başlık/bölüm yapısı ileride yazılacak O1-O5 dosyalarıyla tutarsız kalabilir. **Mitigasyon:** O-serisi bir şablon-header standardı belirlensin.

### Doğrulama açığı (GAP-)
- **GAP-1 (KAPALI):** `server/db.ts:312-344` okundu — `db.encrypt`/`db.decrypt` public, AES-256-GCM, `iv:tag:ciphertext`, `authTagLength=16`. TOTP secret şifreleme buna oturur. Yeni kanıt O6.1 adım-1'e işlendi.
- **GAP-2 (KAPALI):** `ToolCtx` iki noktada inşa edilir: (a) MCP yüzeyi `mcpCtxFactory` (`server.ts:2385-2394`) — `allowedTiers`/`scopes`/`tenantId` `req.tenant`'tan; `role: t?.role` buraya eklenir. (b) Lokal agent-loop `ToolRegistry.execute(..., { tenantId:"local" })` (`server.ts:1546-1548`) — `role:"admin"` sabitlenir. `confirmToken` (O6.3 adım-3, opsiyonel) MCP request `_meta`'dan veya header'dan aynı factory'de doldurulur.
- **GAP-3:** O6 `docs/odyssey/PROGRESS.md`'de İZLENİYOR (P.07 = **DONE** plan-düzeyinde; SECURITY(O6) satırı = **PLANNED** uygulama-düzeyinde; `görev-id` şeması `SEC.O6.1.totp`). Ancak `orchestration/TASKS.json` (gerçek dispatch kuyruğu) O6'yı henüz içermiyor → uygulama başlamadan Emre onayıyla oraya `SEC.O6.*` görevleri eklenmeli. (`MASTER_TASKLIST.md` repo'da yok — kaynak-of-truth `PROGRESS.md` + `orchestration/TASKS.json`.)
