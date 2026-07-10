# Email MCP Server — ODYSSEY Feature Plan

> ODYSSEY / 05-features / email-mcp
> Hedef: odysseus `email_server.py` (IMAP/SMTP MCP + triage/summary/reply-draft) paritesini,
> ollamas'ın mevcut Node MCP + ToolRegistry choke-point mimarisine **native tool-tier'ları** olarak taşımak.
> Dil: TR (anlatı) · kod/komut/dosya-yolu: EN.

---

## 0. Yönetici Özeti (TL;DR)

- **ollamas'ta sunucu-tarafı e-posta modülü YOK.** Kod tabanında `imap` / `smtp` / `nodemailer` / `mailparser` **hiç geçmiyor**; `package.json`'da bu bağımlılıkların **hiçbiri yok**. Var olan tek e-posta teması **tamamen frontend + salt-okunur**: `src/components/GmailBrowser.tsx` (175 satır) → tarayıcıdan doğrudan `https://gmail.googleapis.com/gmail/v1/users/me/messages` çağırır, Firebase Google sign-in token'ını (`useAuth`) kullanır, **yalnızca From/Subject/Date header'ları** çeker (`format=metadata`, gövde ASLA istenmez — dosyanın başında "privacy hard law" yorumu). `src/App.tsx:336` `"gmail"` tab'ında render edilir. Kimlik doğrulama `src/lib/firebase.ts:50`'deki `gmail.readonly` scope'u ile. **Hiçbir şey ollamas server'ına dokunmaz** — bu bir REST-API penceresi, IMAP/SMTP protokol istemcisi **değildir** ve gönderme/triage/parse yeteneği yoktur.
- **020ccfa7 Gmail MCP ≠ ollamas backend'i.** `020ccfa7-...` bir **claude.ai harici connector**'ı (bu oturumun deferred tool listesinde: `mcp__020ccfa7__search_threads`, `get_message`, `create_draft`, `list_labels`, `apply_sensitive_thread_label`, …). Bu araçlar **Claude'un çalıştığı harness'e** bağlıdır; ollamas'ın kendi `/mcp` choke-point'ine (`http://127.0.0.1:8090/mcp`, `.mcp.json`) **bağlı DEĞİL**. Dolayısıyla ollamas'ın kendi email yeteneği için bir şey **sağlamaz** — ancak "Gmail-özel triage'a alternatif, sağlayıcı-agnostik IMAP/SMTP" tasarım gerekçesini güçlendirir (Karar D1'e bkz).
- **Plan:** `server/tools/email/` altında sağlayıcı-agnostik bir IMAP/SMTP istemcisi + triage/summary/reply-draft katmanı; bunları `ToolRegistry` choke-point'ine **yeni tool-tier `host_upstream` benzeri "email" araçları** olarak kaydet; sırlar mevcut **encrypted vault** (`db.encrypt`) pattern'i ile saklansın; `.env` toggle ile kapalı-varsayılan (opt-in). MCP'ye expose otomatik (registry → `/mcp`).

---

## 1. Mevcut Durum — Kanıt Tabanlı (ollamas)

Aşağıdakiler `/Users/emrecnyngmail.com/Desktop/ollamas` içinde **Read/Grep ile doğrulanmıştır**.

### 1.1 E-posta ile ilgili NE VAR
| Kanıt | Dosya | Anlamı |
|---|---|---|
| **`GmailBrowser` bileşeni** — `fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?...&labelIds=INBOX")` + `format=metadata&metadataHeaders=From/Subject/Date` | `src/components/GmailBrowser.tsx:33-54` | **Frontend, salt-okunur, metadata-only** Gmail penceresi. Gövde ASLA çekilmez ("privacy hard law" yorumu). Server'a dokunmaz. |
| `<GmailBrowser/>` `"gmail"` tab'ında | `src/App.tsx:15,119,336` | UI'de aktif bir Gmail sekmesi (`Mail` ikonu). Drive/Sheets/Calendar ile **aynı** Google sign-in consent'i. |
| `provider.addScope('.../auth/gmail.readonly')` | `src/lib/firebase.ts:50` | Frontend Google OAuth, **salt-okunur Gmail** scope'u, IMAP/SMTP değil |
| `'app.tab.gmail': 'Gmail Inbox' / 'Gmail Gelen Kutusu'` | `src/locales/en.ts:14`, `src/locales/tr.ts:12` | Sekmenin i18n etiketi (yalnızca metin) |
| `email?: string` alanları | `server/revenue.ts`, `server/contract.ts`, `server/db.ts:82` | Yalnızca **adres alanı** (storefront/üyelik). Posta gönderme/okuma DEĞİL |

> **Kritik ayrım:** Var olan Gmail yüzeyi bir **Google REST API'ye read-only tarayıcı penceresidir** (odysseus'un `GmailBrowser` benzeri değil). odysseus'un `email_server.py`'sinin yaptığı **sağlayıcı-agnostik IMAP/SMTP + triage/summary/reply-draft + gönderme** yeteneğinin **hiçbiri** yoktur. Bu plan, GmailBrowser'ı bozmadan (o bir sunum yüzeyi olarak kalır) sunucu-tarafı e-posta çekirdeğini kurar.

### 1.2 E-posta ile ilgili NE YOK (eksik)
- **IMAP istemcisi yok** — `grep -riE "imap"` → yalnızca eşleşmeyen kelime parçaları.
- **SMTP/gönderim yok** — `nodemailer` / `smtp` bağımlılığı ve kodu yok.
- **Mail ayrıştırma yok** — `mailparser` yok.
- **MCP catalog'unda email server yok** — `server/mcp/catalog.ts` CATALOG'u: `memory, filesystem, everything, git, fetch, time, sequential-thinking, playwright`. Email entry'si yok. (Not: catalog "official modelcontextprotocol/servers only, MIT, stdio, zero-account" kuralı ve arşivlenenleri (`slack/postgres/...`) dışlıyor — email dışarıda.)
- **Triage/summary/reply-draft yok.**

### 1.3 Yeniden kullanılacak MEVCUT altyapı (planın dayanağı)
| Yetenek | Dosya / Sembol | Nasıl kullanılacak |
|---|---|---|
| **Choke-point tool kaydı** | `server/tool-registry.ts` → `const TOOLS: Record<string, ToolDef>` (satır 195), `ToolRegistry.register()` (852), `ToolRegistry.execute()` (choke-point) | Yeni `email_*` araçlarını buraya ekle |
| **Tool şema helper'ı** | `tool-registry.ts` `fn(name, desc, params, outputSchema?)` + `ToolSchema` | Her email tool'unun inputSchema'sı |
| **Tier modeli** | `type ToolTier = "safe" | "host" | "privileged" | "host_upstream"` (satır 43) | `email_search/get` → `safe`; `email_send` → `privileged` (RBAC gate) |
| **Bootstrap kayıt hook'u** | `server.ts:102` → `try { registerHostScripts(ToolRegistry, TOOL_DEPS); } catch {...}` (best-effort, kök `server.ts`, 3191 satır) | `registerEmailTools(ToolRegistry, deps)` **aynen buraya** koşullu (env-gated) eklenir — bu, host-script kayıt deseninin birebir eşi |
| **MCP expose (otomatik)** | `server/mcp/server.ts` `buildServer()` (252 satır) → `ListTools/CallTool` registry'den okur; `server.ts:2548` `ToolRegistry.list(MCP_EXPOSE_TIERS)` | Registry'e eklenen `email_*` araçları `/mcp`'de **otomatik** görünür (tier expose süzgecinden geçerek) |
| **Encrypted secret vault** | `server/integrations.ts:38-39` `db.data.keys["github"] = db.encrypt(token)` + `server/db.ts:326` `public decrypt(ciphertext): string` (AES, master-key fail-closed) | IMAP/SMTP kimlik bilgileri `db.encrypt` ile şifreli yazılır, `db.decrypt` ile okunur; asla log/return edilmez |
| **Config-driven toggle** | `.env` / `.env.example` (40+ toggle) + `server/integrations.ts` pattern | `EMAIL_MCP_ENABLED=0` varsayılan; opt-in |
| **SSRF/host güvenliği** | `server/mcp/host-guard.ts` `classifyV4/parseStrictV4` | IMAP/SMTP host'unu doğrula (aşağıda Kör-Nokta R3) |
| **Per-tenant sahiplik & allowlist** | `tool-registry.ts` `OWNERS` map + `allowedTiers` | Çok-kiracılıda email araçları kiracıya özel |
| **MCP SDK** | `package.json` `@modelcontextprotocol/sdk ^1.29.0`, `zod ^3.25.76` | Zaten mevcut — ek MCP altyapısı gerekmez |
| **Test koşucusu** | `vitest ^4.1.8` (`npm test` = `vitest run`) | TDD adımları vitest'e yazılır |

> **Sonuç:** ollamas'a ayrı bir stdio "email_server" **eklemeye gerek yok**. odysseus ayrı bir Python süreci (`email_server.py`) çalıştırır; ollamas'ta doğru mimari, e-postayı **ToolRegistry choke-point'ine native araçlar** olarak koymak ve mevcut `/mcp` üzerinden expose etmektir. Bu, tüm güvenlik/RBAC/metering/audit garantilerini bedavaya verir.

---

## 2. odysseus Referansı (Parite Kaynağı)

odysseus `email_server.py` (MCP-as-extension deseni) sağlar:

| odysseus yeteneği | Davranış | ollamas karşılığı (hedef) |
|---|---|---|
| **IMAP bağlan/listele** | Gelen kutusu, klasör, arama (UID/kriter) | `email_search`, `email_list_folders` (tier `safe`) |
| **Mesaj oku** | Header + gövde (text/html) + ekler | `email_get` (tier `safe`) |
| **SMTP gönder** | To/cc/bcc, ek, reply-to | `email_send` (tier `privileged`, RBAC) |
| **Taslak** | Gönderilmeden taslak üret | `email_draft_reply` (tier `safe` — sadece taslak metni döner, göndermez) |
| **Triage** | Öncelik/etiket/kategori sınıflandırma | `email_triage` (tier `safe`, $0-local qwen3:8b) |
| **Summary** | Thread/mesaj özeti | `email_summarize` (tier `safe`, $0-local qwen3:8b) |
| **Config-driven** | `.env` IMAP/SMTP host/port/user/pass, TLS | `.env` `EMAIL_MCP_*` + encrypted vault |

**Extensibility sırrı (odysseus):** MCP-as-extension + modular-services + config-driven. ollamas'ta bu → ToolRegistry'e modüler `email_*` araç grubu + `.env` toggle + vault. **Parite korunur, mimari ollamas-native olur.**

---

## 3. Hedef Mimari

```
.env (EMAIL_MCP_ENABLED, EMAIL_IMAP_*, EMAIL_SMTP_*)   ← config-driven toggle (kapalı-varsayılan)
        │
        ▼
server/tools/email/
  ├─ config.ts        loadEmailConfig(): env + vault (db.encrypt/decrypt) → EmailConfig | null
  ├─ imap-client.ts   connect/search/fetch/listFolders  (imapflow)   ← pure, injectable transport
  ├─ smtp-client.ts   sendMail(...)                      (nodemailer) ← privileged
  ├─ parse.ts         parseMessage(raw) → {from,to,subject,date,text,html,attachments[]}  (mailparser)
  ├─ triage.ts        triageEmail(msg, aiCall) → {priority, category, labels[]}  ($0 qwen3:8b)
  ├─ summarize.ts     summarizeThread(msgs, aiCall) → string          ($0 qwen3:8b)
  └─ register.ts      registerEmailTools(ToolRegistry, deps)  ← choke-point kaydı
        │
        ▼
server/tool-registry.ts  TOOLS{}  (email_search/get/list_folders/triage/summarize/draft_reply = safe;
        │                          email_send = privileged)
        ▼
server/mcp/server.ts  buildServer() → /mcp   (araçlar OTOMATİK expose)
```

**Yeni bağımlılıklar (öneri):** `imapflow` (modern IMAP, MIT, TS-native, promise-based), `nodemailer` (SMTP, MIT), `mailparser` (MIME, MIT). Üçü de saf-Node, host-yalın. (Kör-Nokta R1: sürüm/lisans doğrulaması gerekli.)

**Güvenlik ilkeleri (mevcut pattern'lerden miras):**
1. Sırlar **yalnızca** `db.encrypt` ile vault'ta; env sadece bootstrap. Token/parola **asla** return/log edilmez (`integrations.ts` disiplini).
2. IMAP/SMTP host'u `host-guard.ts` ile sınıflandır — loopback/RFC1918/link-local hedefler reddedilebilir olmalı (SSRF; ama meşru self-hosted mail sunucuları için **allowlist opt-in**, bkz Kör-Nokta R3).
3. `email_send` → tier `privileged` → RBAC/scope gate (`scopes: ["tools:privileged"]`) + audit (`db.logSecurity`).
4. Kapalı-varsayılan: `EMAIL_MCP_ENABLED` set değilse `registerEmailTools` **hiç çağrılmaz** → araçlar registry'de görünmez.

---

## 4. Uygulama Planı — TDD Adımlı (test-önce)

> Kural: her adımda **önce test yaz (RED), sonra implement (GREEN), sonra refactor**. Testler `server/tools/email/__tests__/*.test.ts` altında, `vitest`. Ağ/IMAP/SMTP **inject edilebilir** (gerçek sunucu gerektirmeyen saf birim testleri) — `integrations.ts`'in `ExecTokenFn` inject pattern'i ve `catalog.ts`'in `exec`/`mkdir` inject pattern'i örnek alınır.

### Adım 0 — Bağımlılık + iskele (parite ön-koşulu)
- **Test:** `deps.test.ts` — `import('imapflow')`, `import('nodemailer')`, `import('mailparser')` çözülür; `package.json`'da MIT lisans + pinlenmiş sürüm.
- **Impl:** `npm i imapflow nodemailer mailparser` + `@types/nodemailer`; `server/tools/email/` iskelesi.
- **Gate:** `npm run typecheck` temiz.

### Adım 1 — Config yükleme (env + vault, kapalı-varsayılan)
- **RED:** `config.test.ts` — (a) `EMAIL_MCP_ENABLED` yokken `loadEmailConfig()` → `null`; (b) env + vault set iken tam `EmailConfig` döner; (c) döndürülen objede parola **maskeli/last4** dışında düz-metin **yok**.
- **GREEN:** `config.ts` — env okur, vault'tan `db.decrypt` ile parola çeker; `db.encrypt` ile yazma yardımcı fonksiyonu (`integrations.ts` `autoconnectGitHub` deseni).
- **Refactor:** saf fonksiyon + inject edilebilir `db`.

### Adım 2 — MIME parse (saf, ağsız)
- **RED:** `parse.test.ts` — sabit bir `.eml` fixture → `{from,to,subject,date,text,html,attachments[]}` beklenen alanlar; çok-parçalı + ek içeren mesaj; bozuk MIME → hata değil, kısmi/güvenli sonuç.
- **GREEN:** `parse.ts` (`mailparser` sarmalayıcı).

### Adım 3 — IMAP istemci (transport inject)
- **RED:** `imap-client.test.ts` — sahte imapflow transport ile `searchInbox(criteria)` doğru UID listesi; `fetchMessage(uid)` ham RFC822 döner; bağlantı hatası → `ok:false` (throw etmez, choke-point normalize eder). Gerçek ağ **yok**.
- **GREEN:** `imap-client.ts` — `imapflow` sarmalayıcı, `ImapTransport` interface ile inject edilebilir.

### Adım 4 — SMTP gönderim (privileged, transport inject)
- **RED:** `smtp-client.test.ts` — sahte `nodemailer` transport ile `sendMail({to,subject,text})` doğru zarf; TLS zorunlu; gönderim başarısız → `ok:false`. `email_send` çağrısı **RBAC gate** olmadan reddedilir (tier `privileged`).
- **GREEN:** `smtp-client.ts` + registry'de `email_send` tier `privileged`.

### Adım 5 — Triage + Summary ($0-local qwen3:8b)
- **RED:** `triage.test.ts` — sahte `aiCall` ile `triageEmail(msg)` → `{priority ∈ {high,normal,low}, category, labels[]}`; deterministik parse (JSON dönüşü bozuksa güvenli fallback). `summarize.test.ts` — thread → tek string özet; boş thread → boş/anlamlı mesaj.
- **GREEN:** `triage.ts`, `summarize.ts` — mevcut yerel AI çağrı yolunu (server/ai.ts / providers) `aiCall` olarak inject et; **varsayılan model qwen3:8b (0-token)**.

### Adım 6 — Reply-draft (safe, göndermez)
- **RED:** `draft.test.ts` — `draftReply(msg, instruction, aiCall)` → taslak metin döner; **hiçbir SMTP çağrısı yapılmaz** (mock çağrı sayısı 0).
- **GREEN:** `email_draft_reply` tool (tier `safe`).

### Adım 7 — Choke-point kaydı + tier'lar
- **RED:** `register.test.ts` — `registerEmailTools(ToolRegistry, deps)` sonrası `ToolRegistry.has("email_search")` true; `email_send` tier `privileged`; `email_*` şemaları `ToolRegistry.schemas()`'da; `EMAIL_MCP_ENABLED` yokken **hiç kayıt yok**.
- **GREEN:** `register.ts` + `server.ts` bootstrap'te koşullu çağrı.

### Adım 8 — MCP expose smoke (uçtan uca, registry→/mcp)
- **RED:** `email-mcp.expose.test.ts` — `buildServer(ctx)` + `ListTools` çağrısı sonucunda `email_search`, `email_get`, `email_send`, `email_triage`, `email_summarize`, `email_draft_reply` görünür; `CallTool email_search` (mock IMAP) sonucu MCP `content`'e normalize olur.
- **GREEN:** gerekiyorsa `mcp/server.ts` tarafında değişiklik yok (registry-driven) — sadece kayıt.
- **Gate:** `npm test` yeşil + `npm run typecheck` + lint.

### Adım 9 — SSRF/host guard entegrasyonu
- **RED:** `host-guard email` — IMAP host'u loopback/RFC1918 iken `EMAIL_ALLOW_INTERNAL_HOST` olmadan **reddedilir**; toggle ile self-hosted meşru sunucuya izin verilir.
- **GREEN:** `config.ts` bağlanmadan önce `host-guard.ts` `classify` çağrısı.

### Adım 10 — `.env.example` + docs
- `.env.example`'a `EMAIL_MCP_ENABLED`, `EMAIL_IMAP_HOST/PORT/USER/SECURE`, `EMAIL_SMTP_HOST/PORT/SECURE`, `EMAIL_ALLOW_INTERNAL_HOST` (yorumlu, kapalı-varsayılan) ekle. `INTEGRATIONS.md`'ye kısa bölüm.

---

## 5. Parite Kabul Kriteri (odysseus email_server.py)

Aşağıdakilerin **tamamı** yeşil olduğunda parite kabul edilir:

- [ ] **IMAP okuma:** `email_search` + `email_get` gerçek bir IMAP hesabına karşı (manuel/canlı smoke) gelen kutusunu listeler ve bir mesajı header+gövde+ek olarak döner.
- [ ] **SMTP gönderim:** `email_send` (privileged, RBAC-gated) gerçek bir test hesabından bir e-posta gönderir; audit kaydı `db.logSecurity` ile düşer.
- [ ] **Triage:** `email_triage` bir mesajı `{priority, category, labels}` ile sınıflar; **$0 qwen3:8b** ile 0-token maliyet (varsayılan).
- [ ] **Summary:** `email_summarize` çok-mesajlı thread'i tek özete indirger.
- [ ] **Reply-draft:** `email_draft_reply` göndermeden taslak üretir (SMTP çağrısı = 0).
- [ ] **Config-driven:** `EMAIL_MCP_ENABLED=0` iken araçlar registry'de/`/mcp`'de **görünmez**; `=1` + kimlik bilgileri ile görünür.
- [ ] **MCP-as-extension pariti:** araçlar mevcut `/mcp` (`http://127.0.0.1:8090/mcp`) üzerinden, ollamas ayrı bir email süreci başlatmadan, otomatik expose olur.
- [ ] **Güvenlik pariti:** IMAP/SMTP parolası vault'ta şifreli; log/return'de düz-metin sızıntısı **yok** (grep ile doğrulanır); `email_send` scope gate'siz reddedilir.
- [ ] **Kalite kapısı:** `npm run typecheck` ✓ · `lint` ✓ · `npm test` (fresh) ✓ — hepsi email suite dahil yeşil.

**Parite DIŞI (kapsam dışı, bilinçli):** odysseus'un SearXNG/deep-research, calendar, RBAC-2FA gibi modülleri bu dosyanın kapsamında **değil** (ayrı feature dosyaları). Gmail API-spesifik davranış (label semantiği vb.) hedeflenmez — sağlayıcı-agnostik IMAP/SMTP hedeflenir (Karar D1).

---

## 6. Kör-Nokta Ledger (bilinmeyen / varsayım / risk)

### Varsayımlar
**Kalanlar (doğrulanması gereken):**
- **A1** — `imapflow` / `nodemailer` / `mailparser` MIT ve host-yalın; catalog'un "MIT, zero-account, local" kuralına uyar. **Doğrula:** `npm view <pkg> license` + boyut + `npm audit`. (Bu, kod-tabanı-dışı bir doğrulama olduğu için açık.)

**Kapatılanlar (koda karşı doğrulandı — 2026-07-10):**
- ✅ **A2** — Yerel AI çağrı yolu **inject edilebilir**. `server/ai.ts:116` `export async function generateText(prompt: string, opts: AiOptions = {}): Promise<string>` — tam `aiCall(prompt) → Promise<string>` imzası. Varsayılan yerel model `server/ai.ts:35` `MAC_MODEL_CHAMPION = process.env.MAC_MODEL_CHAMPION || "qwen3:8b"` ($0). Triage/summary bunu `aiCall` olarak inject eder.
- ✅ **A3** — `db.encrypt` **ve** `db.decrypt` çift-yönlü **doğrulandı**: `server/db.ts:326` `public decrypt(ciphertext: string): string` (AES, master-key fail-closed); yazma tarafı `integrations.ts:39` `db.data.keys[...] = db.encrypt(token)`. `keys` map'i string→string (`server/db.ts:60` `keys: Record<string, string>`). Varsayım değil, gerçek.
- ✅ **A4** — Bootstrap kayıt hook'u **bulundu**: kök `server.ts:102` `registerHostScripts(ToolRegistry, TOOL_DEPS)` (best-effort try/catch). `registerEmailTools` bunun hemen yanına, `EMAIL_MCP_ENABLED` env-gate'i ile eklenir. (`server.ts:44` zaten `ToolRegistry`+`TOOL_DEPS` import eder; `server.ts:2548` expose süzgecini kanıtlar.)

### Riskler
- **R1 (bağımlılık yüzeyi):** 3 yeni npm paketi supply-chain yüzeyi ekler. **Azaltım:** pin + `tob-supply-chain-risk-auditor` / `npm audit`; catalog'un stdio-spawn yerine in-process kullanımı zaten daha sıkı.
- **R2 (kimlik bilgisi yönetimi):** IMAP/SMTP **parola** (OAuth değil) hassas. App-password/OAuth2 XOAUTH2 tercih edilmeli. **Azaltım:** vault + Gmail app-password/OAuth2 dokümante; düz parola için uyarı.
- **R3 (SSRF vs self-hosted çelişkisi):** `host-guard.ts` internal host'ları bloklar ama meşru self-hosted mail sunucusu RFC1918'de olabilir. **Azaltım:** `EMAIL_ALLOW_INTERNAL_HOST` opt-in toggle (kapalı-varsayılan) + tek-kiracı modda gevşetme.
- **R4 (uzun IMAP çağrıları):** büyük gelen kutusu fetch'i MCP timeout/progress gerektirir. **Azaltım:** `ToolCtx.onProgress` + `abortSignal` (choke-point'te zaten var) kullan; sayfalama/limit parametreleri.
- **R5 (020ccfa7 karışıklığı):** Kullanıcı "Gmail MCP zaten var" sanabilir. **Netleştirildi:** 020ccfa7 claude.ai connector'ı, ollamas backend'i değil — bu plan ollamas'ın **kendi** sağlayıcı-agnostik email yeteneğini kurar.
- **R6 (HTML e-posta / ek güvenliği):** HTML gövde XSS/tracker, ek dosyaları zararlı olabilir. **Azaltım:** frontend render'da sanitize (bu backend planı kapsam-dışı bırakır ama not düşer); ekler base64 döner, otomatik açılmaz.

### Açık Kararlar (Emre onayı bekleyen)
- **D1** — **Sağlayıcı-agnostik IMAP/SMTP** mi (odysseus-parite, önerilen) yoksa **Gmail API + XOAUTH2** mi? Öneri: IMAP/SMTP baz + opsiyonel XOAUTH2 kimlik doğrulama.
- **D2** — Triage/summary **varsayılan model**: qwen3:8b ($0) doğrulandı; cloud katalog fallback opsiyonel mi?
- **D3** — Bu araçlar **çok-kiracı** modda per-tenant vault mı gerektirir (SAAS_ENFORCE=1)? `OWNERS` map ile evet — ama tek-kiracı (Emre) için gereksiz karmaşa. Öneri: tek-kiracı önce, tenant-scoping Faz-2.

---

## 7. Sonraki Adım
A2/A3/A4 varsayımları **koda karşı kapatıldı** (bkz §6): `generateText` inject imzası, `db.encrypt/decrypt` çifti, `server.ts:102` bootstrap hook'u hazır. Kalan tek kod-dışı doğrulama **A1** (bağımlılık lisans/boyut/audit). Emre onayı + A1 doğrulaması sonrası **Adım 0'dan TDD ile** başlanır (test-önce; ağ inject edilir, gerçek IMAP/SMTP sunucusu gerektirmez).
