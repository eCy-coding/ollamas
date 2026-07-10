# ODYSSEY-DESIGN — Panel: Settings + 2FA/RBAC/Güvenlik (Claude Design yürütme planı)

> **Belge:** `docs/odyssey/design-execution/panels/settings-2fa.md`
> **Odak:** Settings + güvenlik paneli — 2FA/TOTP kurulum + RBAC rol-yönetimi + tool-policy + tema/dil. Mevcut `SecurityPolicies` + `SaaSAdmin` → **odysseus-parity `SettingsPanel`**'e evrimleşme.
> **KRİTİK KISIT (plan KN ui-K6):** 2FA/RBAC UI mock **kolay**; ama TOTP time-window + RBAC enforcement **backend'de** sağlam olmazsa **SAHTE-GÜVENLİK**. **Backend-önce TDD** — `totp.test.ts` + `rbac.test.ts` yeşil olmadan UI ship **YASAK** (bkz. `07-security.md` §4). Bu belge yalnız **UI-brief** üretir; güvenlik sınırını backend kurar.
> **Claude Design mekaniği:** `claude.ai/design` chat-prompt canvası; prompt template `[GOAL][LAYOUT][CONTENT][BRAND][CONTEXT: 4-state + responsive]`; iterasyon chat + inline-comment; handoff `Export` + `Handoff to Claude Code` bundle = HTML + screenshot + README; **statik-HTML** (backend/API/localhost YOK). Design-system-first: `01-design-system.md` ön-koşuldur.
> **Kardeş desen:** `panels/00-shell-nav.md` 9-bölüm yapısına hizalı; bu panel shell'in `SETTINGS` grubundaki `settings (2FA/RBAC)` hedefine mount olur.
> **Dil:** TR (kod/id/yol EN).
> **Üretim tarihi:** 2026-07-10.

---

## 1. Mevcut Settings/Güvenlik Durumu (koda karşı DOĞRULANMIŞ)

> Kaynak: `Read` ile `/Users/emrecnyngmail.com/Desktop/ollamas` okundu (2026-07-10). Backend gerçeği: `docs/odyssey/07-security.md` §2 (kanıt-temelli).

### 1.1 Mevcut güvenlik/settings bileşenleri

| Bileşen | Dosya | Ne VAR | Ne YOK |
|---|---|---|---|
| **`SecurityPolicies`** | `src/components/SecurityPolicies.tsx` | Permission-toggle kartları (`fileRead/fileWrite/commandExec` `:88-125`) + real-time security event log (`:130-169`, kategori-filtreli) + `handleToggle` `POST /api/security/permissions` (`:46`) + hata yüzeyleme (ApiError revert `:50-55`) | 2FA/TOTP yok · RBAC rol tablosu yok · tema/dil ayarı yok |
| **`SaaSAdmin`** | `src/components/SaaSAdmin.tsx` | `X-Admin-Token` (`SAAS_ADMIN_TOKEN`) admin yüzeyi (`:16`) + tenant/key/plan CRUD + `allowed_tiers` görünür (`Plan.allowed_tiers` `:8`) + audit okuma | Tenant **`role` kolonu yok** (`:9` `Tenant` interface'inde rol alanı yok) → gerçek RBAC değil |
| **`KeyVault`** | `src/components/KeyVault.tsx` | Provider key vault + doctor/scan + mask (`…last4`, asla raw `:53`) + AES-vault (`db.encrypt`) | (settings kapsamı dışı — sadece kategori-komşu) |
| **`CapabilityGate`** | `src/components/CapabilityGate.tsx` | Deny-by-default UX gate (`useCapability` `:21`) | **Açık yorum (`:5-7`): "UX reflection of the backend grant, NOT a security boundary"** — bu RBAC DEĞİL |

### 1.2 Backend gerçeği (özet — kaynak `07-security.md` §2)

- **Auth katmanı VAR ve olgun:** `authMiddleware` (Bearer/API-key/OAuth), `adminGuard` (`X-Admin-Token` + `timingSafeEqual` + per-IP brute-force throttle), `requireScope`, `rateLimitMiddleware`. Tool-policy **KISMİ VAR**: `ToolTier = safe|host|privileged|host_upstream` + tek choke-point `ToolRegistry.execute()` her tool'u gate'ler.
- **EKSİK (O6'nın işi):** ❌ 2FA/TOTP hiç yok (grep `totp|otplib|otpauth` → 0) · ❌ `role` kolonu yok (`tenants` schema'da rol alanı yok; "admin" = ayrı token, rol değil) · ❌ threat-model.md yok · ❌ prompt-injection guard yok.
- **Sonuç:** UI'nin 2FA/RBAC göstermesi için **backend'in O6.1 (TOTP) + O6.2 (role kolonu) + O6.3 (role-aware tool-policy) adımları önce yeşil olmalı.** UI, bu backend grant'lerinin **yansımasıdır** (CapabilityGate deseni gibi), güvenlik sınırı değil.

---

## 2. Hedef Settings Paneli — odysseus-parity evrimi

**Değişmez kısıt (Claude Design):** panel **statik-HTML** olarak tasarlanır; TOTP doğrulama, RBAC enforcement, toggle-persist **Claude Code handoff** aşamasında mevcut backend'e (O6.1-O6.3) bağlanır. Claude Design yalnız **görsel iskeleti + 4 mock durumu** üretir.

**Sol kategori-nav (settings-içi 5 kategori):**

```
┌─ SETTINGS PANELİ ────────────────────────────────
│  ◧ Sol kategori-nav (~200px)      ◨ Sağ içerik (fluid)
│
│  ● Genel        → theme dark/light + dil TR/EN + workspace path
│  ● Güvenlik     → 2FA/TOTP kurulum akışı (QR + backup-code + doğrulama)
│  ● Modeller     → provider key özeti (KeyVault'a köprü, read-only kart)
│  ● Modüller     → tool-policy toggle'ları (.env config-driven switch listesi)
│  ● Vault        → KeyVault özeti (mask …last4, köprü)
│  ├─ Erişim (RBAC) → rol-yönetimi tablosu (admin/user × tool-tier matrisi)
```

**Not:** RBAC matrisi görsel olarak "Modüller" (tool-policy) ile bitişik; ikisi birlikte **rol × tool-tier** enforcement yüzeyini kaplar. Mevcut `SecurityPolicies` permission-toggle kartları **"Modüller"** kategorisine taşınır (mevcut davranış korunur, görsel yeniden konumlanır — K-koruma).

---

## 3. Claude Design PROMPT — tam taslak (kopyala-yapıştır)

> Aşağıdaki blok `claude.ai/design` chat kutusuna yapıştırılır. `[BRAND]` token'ları `01-design-system.md`'den gelir (ön-koşul). Token seti `00-shell-nav.md` §3 ile birebir aynı (shell-parity).

```
[GOAL]
Design the SETTINGS + SECURITY panel for a self-hosted, local-first AI workspace
("ollamas", odysseus-parity). This panel lives inside the app-shell's SETTINGS
group. It bundles: general prefs (theme/language), a 2FA/TOTP enrollment flow,
an RBAC role-management table, tool-policy toggles, and a vault/models summary.
This is a SECURITY-CRITICAL surface — the UI must make the trust model legible
(what is enforced by the backend vs. what is a convenience toggle).

[LAYOUT]
- 2-column: left CATEGORY NAV (fixed ~200px) + right CONTENT (fluid).
- CATEGORY NAV (vertical, single-select, aria-current on active):
    General · Security (2FA) · Access (RBAC) · Models · Modules · Vault
  Each row = lucide icon + label; Security row shows a small status dot
  (green = 2FA active, grey = disabled).
- GENERAL pane: theme toggle (dark/light segmented) + language toggle (TR/EN
  segmented) + read-only workspace path row.
- SECURITY (2FA) pane — the centerpiece, a stepped enrollment flow:
    • Step 0 (disabled): a shield-off illustration + "Two-factor auth is OFF"
      + primary CTA "Enable 2FA".
    • Step 1 (setup): a QR code placeholder (square, monospace secret shown
      below as `base32` with a copy button) + "Scan with your authenticator app"
      + a 6-digit code input (6 segmented boxes) + "Verify" button.
    • Step 2 (backup codes): a 2-column grid of 10 one-time recovery codes in
      mono, each masked-by-default with a reveal toggle, a "Copy all" + "Download"
      + a REQUIRED "I've saved these codes" checkbox gating the Done button.
    • Step 3 (active): green "2FA is ACTIVE" state + "Regenerate backup codes"
      + "Disable 2FA" (destructive, confirm).
  A horizontal stepper (0→1→2→3) shows progress.
- ACCESS (RBAC) pane: a role × tool-tier matrix table.
    Rows = tool tiers: safe · host · privileged · host_upstream
    Columns = roles: admin · user
    Cells = a checkbox (checked = role may run that tier). admin column is
    all-checked and read-only (admin always permitted). A note reads
    "Enforced by the backend tool-registry choke-point — this reflects policy,
    it does not create it."
- MODULES pane: config-driven toggle list (.env style) — each row = a switch +
  mono key name + one-line description:
    Workspace File Read · Workspace File Write · Local Command Execution ·
    Deny tiers for non-admin (TOOL_POLICY_DENY_TIERS) · Require confirm for
    privileged (TOOL_POLICY_REQUIRE_CONFIRM) · Prompt-injection guard (MCP_POISON_GUARD).
  Each toggle shows its backing env var name in dim mono (config-driven cue).
- MODELS + VAULT panes: compact read-only summary cards that link ("Manage →")
  to the existing Keys/Vault panel — do NOT re-design the vault here.

[CONTENT]
Use these exact labels. 2FA secret mock: `JBSW Y3DP EHPK 3PXP` (grouped base32).
6-digit input mock: empty boxes for setup, "1 2 3 · 4 5 6" filled for verify.
Backup codes mock (10, mono, masked as `••••-••••` with reveal):
  a1b2-c3d4, e5f6-g7h8, ... (show 10 rows, 2-col).
RBAC matrix mock: safe=[admin✓ user✓], host=[admin✓ user☐], privileged=[admin✓
user☐ locked], host_upstream=[admin✓ user☐]. Show `run_command` + `macos_terminal`
as example privileged tools in a tooltip.
Modules toggles mock: File Read ON, File Write OFF, Command Exec ON, Deny-tiers
"host,privileged", Require-confirm OFF, Poison-guard ON.

[BRAND]
Immersive dark developer-cockpit. Tokens (from ollamas design-system, identical
to the shell):
  bg-base #050608 · sidebar #08090d · panel #0a0b10 · inset #04050a
  border rgba(255,255,255,.05) · text-bright #f8fafc · text-muted #94a3b8 · text-dim
  accent-indigo #6366f1 · status-ok #34d399 · warn #fbbf24 · err #fb7185 · info #22d3ee
  font sans = Inter, mono = JetBrains Mono. radius sm 3 / md 8 / lg 12.
Dark is primary; ALSO produce a light variant (token-driven, no dark: prefixes).
Security cues: the QR + secret + backup-code surfaces get a subtle amber "handle
with care" hairline border. Motion: fade-in 0.25s; respect prefers-reduced-motion.

[CONTEXT — 4 states × responsive]
Design ALL FOUR security-flow states of the SECURITY (2FA) pane:
  1. 2FA DISABLED — shield-off, "Enable 2FA" CTA (Step 0).
  2. QR SETUP — QR placeholder + secret + empty 6-box code input (Step 1).
  3. VERIFY ERROR — code entered but wrong: the 6 boxes get a rose error ring +
     inline "Invalid or expired code — try again" + a subtle shake; secret still
     shown, Verify re-enabled.
  4. 2FA ACTIVE — green active state + backup-codes-saved confirmation (Step 3).
Responsive:
  • DESKTOP (≥1024px): 2-column (category nav + content).
  • TABLET (768–1023px): category nav collapses to a top horizontal tab-bar;
    content full-width; the RBAC matrix scrolls horizontally inside its own
    overflow-x container (never breaks the page).
Accessibility: role="navigation" on category nav, aria-current on active category,
the 6-digit input is a labeled group (aria-label "verification code"), backup
codes are behind an explicit reveal (not auto-shown), RBAC checkboxes have
aria-label "{role} may run {tier}", focus-visible rings, contrast AA.
```

---

## 4. 4-STATE Mock (Claude Design canvas'ında üretilecek — kabul çıtası)

> Dört durum **Güvenlik (2FA) akışının** kritik anlarıdır (odysseus 2FA UX-parity). RBAC/Modüller/Genel her durumda arka-planda sabit kalır.

| Durum | 2FA-pane görünümü | Kritik detay |
|---|---|---|
| **1. 2FA kapalı** | Shield-off illüstrasyon + `Two-factor auth is OFF` + primer CTA `Enable 2FA` (Step 0) | Boş-durum; enrollment henüz başlamadı |
| **2. QR kurulum** | QR placeholder + `base32` secret (kopya butonu) + boş 6-kutu kod girişi + `Verify` (Step 1) | **Secret amber "handle with care" hairline** — güvenlik-görsel-ipucu; secret tek-sefer gösterilir |
| **3. Doğrulama hatası** | 6 kutu rose error-ring + inline `Invalid or expired code — try again` + hafif shake; secret hâlâ görünür, Verify tekrar aktif | Yanlış/expired token UX; backend `verifyTotp` ±1 window reddini yansıtır (`07-security.md` §4 O6.1-adım1) |
| **4. 2FA aktif** | Yeşil `2FA is ACTIVE` + backup-code-kaydedildi onayı + `Regenerate` / `Disable` (Step 3) | happy-path referans; `totp_enabled=1` durumu |

**Her durum için:** desktop + tablet ekran görüntüsü + dark + light = state başına **4 görsel** (2 viewport × 2 tema). **Ek 2 sabit-frame:** RBAC-matris (dolu) + Modüller-toggle-listesi (dolu) — 2FA-akışından bağımsız kabul-görselleri.

---

## 5. Responsive (desktop + tablet)

| Viewport | Kategori-nav | RBAC matrisi | Not |
|---|---|---|---|
| **Desktop (≥1024px)** | Sol dikey nav, tam-etiketli (~200px), 2-kolon | Tam genişlik tablo, satır=tier / kolon=rol | Mevcut panel-body grid deseni baz (`shell content mount`) |
| **Tablet (768–1023px)** | Üst yatay tab-bar'a daralır | **`overflow-x: auto` konteyner içinde yatay kaydırma** — sayfa gövdesi asla yatay kaymaz | 6-kutu kod girişi tablet'te tek-satır sığar; QR max-width kısıtlı |

Mobil (<768px) bu belgenin kapsamı DIŞI — `03-claude-design-ui.md` §2.8 "mobil bozulmayan grid" genel kriteri geçerli (Kör-Nokta ui-KN5).

---

## 6. İterasyon Adımları (Claude Design chat + inline-comment)

1. **PROMPT yapıştır** (§3) → canvas ilk settings iskeletini üretir (muhtemel: düz form, stepper yok).
2. **İnline-comment #1:** "Sol kategori-nav'ı 6 tek-seçim satıra böl (Genel / Güvenlik / Erişim / Modeller / Modüller / Vault); Güvenlik satırına 2FA-durum dot'u (yeşil/gri) ekle."
3. **Chat iterasyon #2:** "Güvenlik panesini 4-adımlı stepper akışına çevir: kapalı → QR-kurulum → backup-kodlar → aktif. QR placeholder + base32 secret (kopya) + 6-kutu segmented kod girişi."
4. **İnline-comment #3:** "Backup-code adımını ekle: 10 kod, 2-kolon, mask-by-default + reveal toggle + 'I've saved these' zorunlu checkbox (Done gate'ler). Amber 'handle with care' hairline."
5. **Chat iterasyon #4:** "Erişim (RBAC) panesini rol×tool-tier matris tablosu yap: satır=tier (safe/host/privileged/host_upstream) × kolon=rol (admin/user); admin kolonu all-checked+read-only; 'backend choke-point enforces' notu."
6. **İnline-comment #5:** "Modüller panesini .env-config-driven toggle listesi yap; her switch'in backing env-var adını dim-mono göster (File Read/Write/Exec + TOOL_POLICY_DENY_TIERS + REQUIRE_CONFIRM + MCP_POISON_GUARD)."
7. **Chat iterasyon #6:** "2FA panesinin 4 durumunu ayrı frame üret: kapalı / QR-kurulum / doğrulama-hatası (rose ring + shake) / aktif."
8. **İnline-comment #7:** "Light varyantı token-driven üret (dark: prefix yok). Tablet'te kategori-nav'ı üst yatay tab-bar'a, RBAC matrisini overflow-x konteynere al."
9. **Kalibrasyon:** ilk export'u yapıp handoff-bundle şemasını doğrula (ui-K1 azaltma).

---

## 7. Handoff-Bundle İçeriği (`Export` + `Handoff to Claude Code`)

Çıktı `docs/odyssey/design-execution/handoff/settings-2fa/` altına:

```
settings-2fa/
  PROMPT.md               # §3'teki tam brief (token + mock + 4-state)
  settings.html           # Claude Design export (self-contained, inline CSS)
  screenshot-2fa-off.png      # 4 durum × dark
  screenshot-2fa-qr.png
  screenshot-2fa-error.png
  screenshot-2fa-active.png
  screenshot-*-light.png  # her durumun light varyantı
  screenshot-rbac.png     # RBAC matris (sabit-frame)
  screenshot-modules.png  # Modüller toggle listesi (sabit-frame)
  screenshot-tablet.png   # kategori-nav → yatay tab-bar + RBAC overflow-x
  HANDOFF.md              # ↓ zorunlu içerik
  tokens.snippet.css      # src/styles/tokens.css alt-kümesi (brief'e gömülü)
  TOTP_SETUP.spec.md      # enrollment akış prop imzası + state machine (0→3)
  RBAC_MATRIX.spec.md     # rol×tool-tier matris prop imzası + read-only admin kuralı
  TOGGLE_LIST.spec.md     # .env config-driven toggle → env-var map
```

**HANDOFF.md zorunlu içeriği:**
- Component ağacı: `SettingsPanel` → `CategoryNav` / `GeneralPane` / `SecurityPane(TotpFlow)` / `AccessPane(RbacMatrix)` / `ModulesPane(ToggleList)` / `ModelsPane` / `VaultPane`.
- **Mevcut→yeni map:** `SecurityPolicies.tsx` permission-toggle kartları (`:78-127`) → `ModulesPane`; security-log (`:130-169`) → korunur (Modüller-alt veya ayrı log-drawer); `SaaSAdmin` admin-yüzeyi ayrı panel kalır (settings'e gömülmez). `onNotify` + `permissions` + `onPermissionsChange` prop kontratı KORUNUR.
- **Backend-bağı sözleşmesi (KRİTİK):** her UI durumu hangi backend endpoint/state'e bağlanır:
  - 2FA-akışı → `POST /api/security/2fa/enroll` → `{secret, otpauthUrl, qrDataUri}`; `POST /api/security/2fa/verify {token}` → `totp_enabled=1` + 10 recovery code (`07-security.md` §4 O6.1). **UI bu endpoint'ler backend'de yeşil olmadan mock-veri ile ship EDİLMEZ.**
  - RBAC matris → `tenants.role` kolonu + `ToolRegistry.execute()` role-gate (`07-security.md` §4 O6.2/O6.3). Matris **okur/yansıtır**, enforce ETMEZ.
  - Modüller toggle → `POST /api/security/permissions` (mevcut) + `.env` `TOOL_POLICY_*` (config-driven, read-only görünüm).
- i18n anahtar listesi: yeni `settings.category.{general,security,access,models,modules,vault}`, `settings.2fa.{enable,scan,verify,backupCodes,active,disable}`, `settings.rbac.{tier,role,note}`, `settings.modules.*` — hepsi EN+TR çift.
- a11y kontratı: 6-kutu kod girişi labeled-group; backup-code reveal explicit (auto-show yok); RBAC checkbox aria-label; kategori-nav aria-current.

---

## 8. Kabul Kriteri (bu settings/2FA brief'i için)

- [ ] Claude Design PROMPT `[GOAL][LAYOUT][CONTENT][BRAND][CONTEXT]` beş bölümlü, kopyala-yapıştır hazır. **(§3 = ✅)**
- [ ] Sol **kategori-nav 6 tek-seçim satır** (Genel / Güvenlik / Erişim / Modeller / Modüller / Vault) — aria-current + 2FA-durum dot.
- [ ] **2FA/TOTP akışı** 4-adımlı stepper: QR placeholder + base32 secret (kopya) + 6-kutu segmented kod girişi + 10 backup-code (mask+reveal, "saved" zorunlu checkbox).
- [ ] **RBAC matris**: rol (admin/user) × tool-tier (safe/host/privileged/host_upstream); admin kolonu read-only all-checked; "backend choke-point enforces" notu.
- [ ] **Tool-policy toggle listesi**: .env config-driven, her switch backing env-var adını dim-mono gösterir.
- [ ] **4 güvenlik-durumu** (2FA-kapalı / QR-kurulum / doğrulama-hata / 2FA-aktif) ayrı frame + RBAC & Modüller sabit-frame.
- [ ] **Tema dark/light + dil TR/EN** Genel panesinde; token-driven parity (`dark:` prefix yok).
- [ ] **Responsive:** desktop 2-kolon + tablet yatay-tab-bar; RBAC matris `overflow-x` konteyner (sayfa gövdesi yatay kaymaz).
- [ ] a11y: `role="navigation"`, `aria-current`, 6-kutu labeled-group, backup-code explicit-reveal, RBAC checkbox aria-label, focus-visible, kontrast AA.
- [ ] Handoff-bundle §7 dosyaları + HANDOFF.md `mevcut→yeni map` + **backend-bağı sözleşmesi** + `onNotify/permissions` prop koruma notu.
- [ ] **KRİTİK-GATE:** HANDOFF.md'de "UI mock ≠ güvenlik; `totp.test.ts`+`rbac.test.ts` yeşil olmadan bu panel prod'a ship EDİLMEZ" ibaresi açıkça yazılı (ui-K6).

---

## 9. Kör-Nokta Ledger

| # | Tip | Kayıt | Etki | Azaltma |
|---|---|---|---|---|
| **ui-K6** | **RİSK (SAHTE-GÜVENLİK)** | 2FA/RBAC UI mock kolay; TOTP time-window + RBAC enforcement backend'de sağlam olmazsa panel **sahte güvenlik** hissi verir (kullanıcı korunduğunu sanır, değildir). Backend gerçeği: 2FA **hiç yok**, `role` kolonu **yok** (`07-security.md` §2.3). | Güvenlik açığı — kritik | **Backend-önce TDD:** `totp.test.ts` (O6.1) + `rbac.test.ts` (O6.2) + `tool-registry` role-gate (O6.3) yeşil olmadan UI **ship YASAK**. HANDOFF.md'de gate ibaresi zorunlu (§8 son madde). Bu belge yalnız UI-brief. |
| **ui-KN1** | **VARSAYIM (QR-mock)** | Claude Design statik-HTML'de gerçek QR üretemez; QR **placeholder** (kare desen görseli) mock'lanır. Gerçek `qrDataUri` backend `qrcode` dep'iyle handoff'ta üretilir (`07-security.md` §4 O6.1-adım2). | QR görsel drift | Placeholder açıkça "mock QR" etiketli; gerçek QR = backend `POST /api/security/2fa/enroll` yanıtı; UI sadece `<img src={qrDataUri}>` bağlar. |
| **ui-KN2** | **RİSK (backup-code güvenli-gösterim)** | Backup kodlar tek-sefer gösterilir + hassastır. UI otomatik açık gösterirse (shoulder-surf), log'a düşerse veya kopya-panoda kalırsa sızıntı. Backend kuralı: TOTP secret/recovery **asla plaintext loglanmaz** (`07-security.md` §4 O6.1 "console çağrısı yasak"). | Bilgi sızıntısı | UI: mask-by-default + explicit reveal-toggle + "saved" zorunlu checkbox; amber handle-with-care hairline; kopya sonrası pano-temizleme notu HANDOFF.md'de. Kod asla `console`/analytics'e gönderilmez. |
| **ui-KN3** | **KORUMA (RBAC-backend-bağlı)** | RBAC matris UI'de checkbox toggle **enforce ETMEZ** — sadece `tenants.role` + `ToolRegistry.execute()` role-gate'i **yansıtır**. Kullanıcı matrisi UI'de değiştirebiliyormuş gibi görünürse ama backend uygulamıyorsa yanıltıcı. | Yanıltıcı yetki illüzyonu | Matris varsayılan **read-only reflection**; düzenlenebilirse yalnız admin + değişiklik `POST` → backend policy günceller, aksi halde disabled. "Enforced by backend choke-point" notu görünür (§3 CONTENT). |
| **ui-KN4** | **VARSAYIM (kategori üyeliği)** | 6 kategori (Genel/Güvenlik/Erişim/Modeller/Modüller/Vault) + mevcut permission-toggle'ların "Modüller"e yerleşmesi UX kararı — varsayım. odysseus tam eşleme yok. | Yanlış gruplama = kötü keşfedilebilirlik | Emre onayı (T0); kategori üyeliği HANDOFF.md'de açık; iterasyonda ayarlanabilir. Mevcut `SecurityPolicies` prop-kontratı korunur (regresyon yok). |
| **ui-KN5** | **KAPSAM (mobil)** | Bu belge desktop + tablet kapsar; mobil (<768px) 2FA-akışı + RBAC-matris dar-ekranda ayrı tasarım işi. | Mobilde bozulma riski | `03-claude-design-ui.md` §2.8 genel kriteri geçerli; mobil detay ayrı panel işi (kardeş `00-shell-nav.md` KN3 paraleli). |
| **ui-KN6** | **VARSAYIM (design-system ön-koşul)** | `01-design-system.md` tam kabul edildi; token'lar shell (`00-shell-nav.md` §3) ile birebir. | Token drift → görsel tutarsızlık | `tokens.snippet.css` brief'e gömülür; ilk export'ta token-remap denetimi; shell-parity zorunlu (aynı token seti). |
| **ui-KN7** | **BİLİNMEYEN (lokal-mod 2FA)** | Lokal mod (SAAS_ENFORCE≠1) owner'a 2FA uygulanır mı belirsiz (`07-security.md` BIL-1). UI "Enable 2FA" lokal-owner'a gösterilmeli mi? | Lokal UX bozulması veya güvenlik boşluğu | Emre kararı (T0); varsayılan plan: 2FA yalnız SAAS_ENFORCE=1 admin işlemlerde; lokal-mod'da panel "2FA (SAAS modunda)" olarak bilgilendirici gösterilir. |

---

**Sonraki adım:** Emre onayı (T0) + **backend O6.1/O6.2/O6.3 TDD yeşil** (ön-koşul gate) → §3 PROMPT'u `claude.ai/design`'a yapıştır → §6 iterasyonlar → §7 handoff-bundle → Claude Code `SettingsPanel.tsx` implementasyonu (backend endpoint'lerine bağlı) TDD ile. Bu belge **UI-brief kaynağıdır, implementasyon değil**; **güvenlik sınırı backend'de** (ui-K6 gate).
