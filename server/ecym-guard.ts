// eCym'in `risky()` reddetme listesi denetimi — GUI otomasyonu körlüğü.
//
// ÖLÇÜLEN AÇIK (2026-07-20): `~/.local/bin/ecym:37` şu listeyi kullanıyor —
//   sudo|(^| )rm |dd |mkfs| > |>>|chmod|chown|kill|pkill|curl…|wget…| mv |
//   shutdown|reboot|launchctl (unload|bootout|disable)|defaults write|>\s*/
// Liste KABUK komutları için yazılmış ve `osascript` ile `open -a` İÇERMİYOR.
// Oysa AppleScript operatörün adına mail gönderebilir, kişilere mesaj atabilir ve
// Finder üzerinden dosya silebilir — ki bu son işlem ` rm ` desenine HİÇ uğramaz.
// Yani mevcut koruma, en tehlikeli yüzeye tam olarak kör.
//
// Bu modül SAF ve salt-okunurdur: ecym dosyasını OKUR, regex'i çıkarır, eksik
// token'ları raporlar. Dosyayı DEĞİŞTİRMEZ — `~/.local/bin/ecym` deponun dışında,
// operatörün kişisel CLI'ıdır; yamayı o çalıştırır (scripts/ecym-risky.patch.sh).

/** GUI otomasyon yüzeyini kapatmak için `risky()` içinde bulunması gereken token'lar.
 *  Her biri operatör adına geri alınamaz bir eylem üretebilen bir kapıdır. */
export const REQUIRED_TOKENS = [
  "osascript",      // AppleScript'in tamamı — mail, mesaj, Finder silme
  "tell app",       // doğrudan uygulama komutu (osascript olmadan da çağrılabilir)
  "System Events",  // GUI scripting: tuş/tık simülasyonu, her şeyi yapabilir
  "shortcuts run",  // Shortcuts kısayolu — içeriği görünmez, her şeyi sarabilir
  "automator",      // Automator iş akışı — aynı şekilde opak
  "tccutil",        // gizlilik izinlerini sıfırlar/değiştirir
  "screencapture",  // ekran içeriği = kimlik bilgisi sızıntısı yüzeyi
  "empty trash",    // kalıcı silme, rm desenine uğramaz
] as const;

export interface GuardReport {
  /** ecym dosyası bulundu ve regex çıkarılabildi mi. */
  found: boolean;
  /** Çıkarılan ham regex (varsa). */
  regex: string | null;
  /** Listede OLAN gerekli token'lar. */
  present: string[];
  /** Listede OLMAYAN gerekli token'lar — kapatılması gereken açık. */
  missing: string[];
  ok: boolean;
}

/**
 * SAF: ecym kaynak metninden `risky()` regex'ini çıkar.
 *
 * İÇERİK-ÇIPALI: satır numarasına güvenmez (dosya operatörün, her an değişebilir).
 * `risky(){ ... grep -qiE '<regex>' ... }` kalıbını arar.
 */
export function extractRiskyRegex(source: string): string | null {
  const src = String(source ?? "");
  const fn = src.indexOf("risky()");
  if (fn < 0) return null;
  // Fonksiyon gövdesindeki ilk tek-tırnaklı grep desenini al.
  const after = src.slice(fn, fn + 2000);
  const m = after.match(/grep\s+-[a-zA-Z]*E?\s+'([^']+)'/);
  return m ? m[1] : null;
}

/** SAF: bir token regex içinde geçiyor mu (büyük/küçük harf duyarsız, ham metin araması). */
export function hasToken(regex: string, token: string): boolean {
  return String(regex ?? "").toLowerCase().includes(String(token ?? "").toLowerCase());
}

/** SAF: denetim raporu. `source` null ise dosya yok demektir (CI'da normal). */
export function auditGuard(source: string | null): GuardReport {
  if (source === null || source === undefined) {
    return { found: false, regex: null, present: [], missing: [...REQUIRED_TOKENS], ok: false };
  }
  const regex = extractRiskyRegex(source);
  if (!regex) return { found: false, regex: null, present: [], missing: [...REQUIRED_TOKENS], ok: false };
  const present = REQUIRED_TOKENS.filter((t) => hasToken(regex, t));
  const missing = REQUIRED_TOKENS.filter((t) => !hasToken(regex, t));
  return { found: true, regex, present, missing, ok: missing.length === 0 };
}

/**
 * SAF: bir komut, GEREKLİ token'lardan birine göre riskli mi.
 *
 * Bu, ecym'in listesinden BAĞIMSIZ ikinci bir kontroldür: kart doğrulama harness'i
 * bunu kullanır, böylece operatör yamayı henüz uygulamamış olsa bile hiçbir kart
 * `auto` olarak işaretlenip GUI otomasyonu çalıştıramaz.
 */
export function isGuiRisky(cmd: string): boolean {
  const c = String(cmd ?? "");
  return REQUIRED_TOKENS.some((t) => c.toLowerCase().includes(t.toLowerCase()))
    // `open -a "App" <belge/URL>` — argümanlı açış, uygulamaya veri enjekte eder.
    // Çıplak alternatif tırnak İÇERMEZ: aksi halde `\S+` tırnaklı adın ilk parçasını
    // (`"DaVinci`) yakalayıp kalanını (`Resolve"`) argüman sanıyordu.
    || /\bopen\s+-a\s+(?:"[^"]*"|'[^']*'|[^\s"']+)\s+\S/.test(c)
    // `open https://…`, `open mailto:…` — dış dünyaya çıkış.
    || /\bopen\s+(https?|mailto|tel|sms|facetime):/i.test(c);
}

/** İnsan-okur rapor — sıfat yok, eksik token listesi var. */
export function renderGuardReport(r: GuardReport): string {
  if (!r.found) {
    return [
      "ecym risky() denetimi: DOSYA/REGEX BULUNAMADI",
      "  ~/.local/bin/ecym yok ya da risky() kalıbı değişmiş.",
      "  GUI otomasyon koruması DOĞRULANAMADI.",
    ].join("\n");
  }
  if (r.ok) return `ecym risky() denetimi: TAMAM — ${r.present.length}/${REQUIRED_TOKENS.length} token mevcut.`;
  return [
    `ecym risky() denetimi: ${r.missing.length} TOKEN EKSİK`,
    ...r.missing.map((t) => `  eksik: ${t}`),
    "",
    "  Bu token'lar olmadan AppleScript ile mail gönderme, mesaj atma ve",
    "  Finder üzerinden silme, onay kapısına UĞRAMADAN çalışabilir.",
    "  Yamayı uygulamak için: bash scripts/ecym-risky.patch.sh",
    "  (yedek alır, idempotenttir, dosyanız size aittir — otomatik çalışmaz)",
  ].join("\n");
}
