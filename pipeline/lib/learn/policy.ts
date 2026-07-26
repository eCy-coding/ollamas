// policy — the machine-actionable half of the tier: what each lesson FORBIDS, and what to do instead.
//
// WHY THIS FILE EXISTS
// The operator's correction: the tier must teach `eCym`, `ollamas`, `obsidian` and `claudecode`,
// not a human reader. A system is not taught by prose it can retrieve; it is taught when the
// knowledge reaches its decision loop as a rule it can apply, and when the effect is measurable.
// Each entry below is that rule: the anti-pattern, the fix, the reason, and the places where the
// anti-pattern is legitimately correct.
//
// WHY POLICIES LIVE HERE AND NOT INLINE IN track-*.ts
// A policy is a different kind of statement from a lesson: lessons explain, policies constrain.
// Keeping them in one file makes the whole rule set reviewable in a single read — which matters,
// because this is the file that will change what four systems are allowed to do. It merges onto
// the constructs in `index.ts` by id, so a policy for an id that does not exist is a build error.
//
// AUTHORING RULES (enforced by the validator in learnsite.ts)
//  * `detect` must NOT equal the lesson's `pattern`. The lesson pattern matches CORRECT usage;
//    the policy pattern matches the violation. Conflating them flags every good line as a defect.
//  * `fix` must be concrete enough for a code generator to follow — "be careful" is not a fix.
//  * every exception carries a written `reason`; an unexplained exemption is a hole in the rule.
//  * regexes must be valid in BOTH JavaScript and Python `re`: they are authored here and
//    executed by `learnkb lint` (Python) after serialisation. Lookahead is fine in both;
//    lookbehind and named groups are avoided.
import type { Policy } from "./types";

/** id → rule. The id must match an existing lesson. */
export const POLICIES: Record<string, Omit<Policy, "id">> = {
  /* ───────────────────────────────── python */
  "py-str-translate": {
    severity: "hata",
    detect: /\.lower\(\)/,
    files: /\.py$|(^|\/)(cckb|learnkb)$/,
    fix: "Türkçe metni katlarken önce `str.maketrans` tablosuyla çevir, sonra `.lower()` çağır (`fold()` yardımcısı).",
    why: "`'İ'.lower()` iki karakter üretir (i + birleşen nokta) ve terim eşleşmesi sessizce bozulur.",
    exceptions: [
      { path: /(cckb|learnkb|learn-capsules\.py|cc-capsules\.py|learn-verbatim\.py|learn-fingerprint\.py)$/, reason: "Bu dosyalarda `.lower()` yalnız `fold()`/`norm()` içinde, TR çeviri tablosundan SONRA çağrılıyor — kural zaten uygulanmış hâli." },
      // 2026-07-26: kapı bu dosyada regresyon yakaladı; bakınca `.lower()` yalnız `slug.lower()` /
      // `e["slug"].lower()` karşılaştırmasında çıktı. Slug'lar kebab-case ASCII kimliklerdir
      // (`learn-policy`, `kimlik`), Türkçe metin değil — yani kural burada uygulanamaz, ihlal yok.
      { path: /ecy-capsule\.py$/, reason: "`.lower()` yalnız slug/id karşılaştırmasında; slug'lar kebab-case ASCII, TR metin değil." },
    ],
  },
  "py-open-with": {
    severity: "hata",
    detect: /open\((?![^)]*encoding)[^)]*["'][rwa]/,
    files: /\.py$/,
    fix: "`open(path, encoding=\"utf-8\")` — okuma ve yazmada kodlamayı her zaman açıkça ver.",
    why: "Varsayılan kodlama ortama göre değişir; launchd altında koşan bir görev macOS'ta çalışan kodu `UnicodeDecodeError` ile düşürür.",
  },
  "py-subprocess": {
    severity: "hata",
    detect: /shell\s*=\s*True/,
    files: /\.py$/,
    fix: "`subprocess.run([\"komut\", \"arg\"])` — argümanları liste ver, kabuk açma.",
    why: "`shell=True` girdideki `;` ve `|` karakterlerini komut ayracına çevirir; bugün sabit olan girdi yarın yapılandırmadan gelir.",
  },
  "py-try-except": {
    severity: "uyarı",
    detect: /except\s+Exception\s*:/,
    files: /\.py$/,
    fix: "Beklenen hatayı ADIYLA yakala (`FileNotFoundError`, `json.JSONDecodeError`, `OSError`); sınıflandırma gerekiyorsa dalları ayır.",
    why: "Geniş yakalama, kapıların ihtiyacı olan ayrımı imkânsız kılar: bağlantı hatası SKIP, bozuk veri FAIL'dir.",
  },
  "py-sorted-key": {
    severity: "uyarı",
    detect: /\.most_common\(/,
    files: /\.py$/,
    fix: "`sorted(freq.items(), key=lambda kv: (-kv[1], kv[0]))` — eşit frekansta ikincil anahtar ver.",
    why: "`most_common` eşitlikte ekleme sırasına düşer; indeks iki koşuda farklı çıkar ve `git diff` anlamını kaybeder.",
  },

  /* ───────────────────────────────── js / ts */
  "node-child-process": {
    severity: "hata",
    detect: /\bexecSync\(\s*["'`]|(?<![\w.])exec\(\s*["'`][^"'`]* /,
    files: /\.(ts|mts|cts|js|mjs)$/,
    fix: "`execFile(binary, [args])` kullan; kabuk gerekiyorsa argümanı sökerek liste hâline getir.",
    why: "`exec` araya kabuk sokar ve metakarakterleri yorumlar; `execFile` argümanları doğrudan execve'ye geçirir, enjeksiyon yapısal olarak imkânsız olur.",
    exceptions: [
      { path: /(scripts|orchestration)\/.*\.(ts|mjs)$/, reason: "Geliştirici betikleri sabit, kullanıcı girdisi almayan komutlar çalıştırıyor; kabuk genişletmesi bilinçli." },
    ],
  },
  "js-array-sort": {
    // `["b","a"].sort()` DOĞRUdur; kural yalnız SAYISAL dizide bağlar ve düzenli ifade tip
    // bilemez. İlk ölçümde 24 bulgunun tamamı string sıralamasıydı → kapıya bağlamak yerine
    // uyarı. Kuralı gerçeğe uydurmak, gerçeği kurala uydurmaktan iyidir.
    severity: "uyarı",
    detect: /\.sort\(\s*\)/,
    files: /\.(ts|mts|cts|js|mjs)$/,
    fix: "SAYISAL dizide `.sort((a, b) => a - b)` yaz; metin dizisinde karşılaştırıcısız `.sort()` zaten doğrudur.",
    why: "Karşılaştırıcısız `sort` elemanları METNE çevirir; `[10, 9, 100]` → `[10, 100, 9]` olur ve sıralama sessizce yanlışa döner.",
  },
  "js-try-catch": {
    severity: "hata",
    detect: /catch\s*(\([^)]*\))?\s*\{\s*\}/,
    files: /\.(ts|mts|cts|js|mjs)$/,
    // Yorumlar SÖKÜLMEDEN eşleştir: `catch { /* neden */ }` bu kuralın UYUMLU biçimidir;
    // yorumu boşluğa çevirmek onu "boş catch" gibi gösterip 96 yanlış-pozitif üretmişti.
    raw: true,
    fix: "Yakalanan hatayı ya sınıflandır ya da en azından bir satır logla; yutacaksan neden yuttuğunu yorumda yaz.",
    why: "Boş `catch` hatayı yok eder ve program yanlış veriyle devam eder — teşhisi en pahalı hata sınıfı budur.",
  },
  "js-nullish": {
    severity: "uyarı",
    detect: /\|\|\s*(0|1100|[1-9]\d{2,})\b/,
    files: /\.(ts|mts|cts|js|mjs)$/,
    fix: "Sayısal varsayılanlarda `??` kullan: `budget ?? 1100`.",
    why: "`||` geçerli bir `0`'ı da ezer; bütçe/eşik gibi ayarlarda bu, kullanıcının verdiği değeri sessizce yok saymak demektir.",
  },
  "js-buffer": {
    severity: "uyarı",
    detect: /\.length\s*<=?\s*(budget|BUDGET|1100)/,
    files: /\.(ts|mts|cts|js|mjs)$/,
    fix: "Bayt bütçesini `Buffer.byteLength(str)` ile ölç; `.length` karakter sayar.",
    why: "Türkçe harf 2, emoji 4 bayttır; karakterle ölçülen 1100'lük bir tavan gerçekte ~1400 bayt olur ve bütçe raporu yalan söyler.",
  },
  "js-timers": {
    severity: "uyarı",
    detect: /setInterval\(/,
    files: /\.(ts|mts|cts|js|mjs)$/,
    fix: "Tekrarlı iş için `setInterval` yerine kendini yeniden kuran `setTimeout` kullan ve `unref()`/temizlik ekle.",
    why: "`setInterval` önceki tur bitmese de yenisini başlatır ve temizlenmezse süreci ayakta tutar.",
  },

  /* ───────────────────────────────── shell */
  "sh-curl-status": {
    severity: "hata",
    detect: /curl\s+(?![^|\n]*(--max-time|-m\s+\d))[^|\n]*https?:\/\//,
    files: /\.(sh|command|zsh|bash)$/,
    fix: "Her `curl` çağrısına `--max-time <sn>` ekle.",
    why: "Zaman aşımı olmayan bir yoklama, yanıt vermeyen serviste gece boyunca asılı kalır ve bir sonraki turu bloke eder.",
  },
  "sh-test-if": {
    severity: "hata",
    detect: /\[\s+\$[A-Za-z_]/,
    files: /\.(sh|command|zsh|bash)$/,
    fix: "Test içindeki değişkeni tırnakla: `[ \"$VAR\" = \"x\" ]`.",
    why: "Boş değişken tırnaksız yazıldığında test ifadesi eksik argümanla sözdizimi hatası verir.",
  },
  "sh-home": {
    severity: "hata",
    detect: /(?<!expanduser\()"~\//,
    files: /\.(sh|command|zsh|bash)$/,
    fix: "`\"$HOME/...\"` yaz; `~` tırnak içinde genişlemez.",
    why: "`\"~/ollamas-vault\"` düz metindir ve dosya bulunamaz — hata mesajı yolu doğru gösterdiği için teşhisi yanıltıcıdır.",
  },

  /* ───────────────────────────────── data & vault yazımı (pahalı öğrenilenler) */
  "sql-delete-update": {
    severity: "hata",
    detect: /DELETE\s+FROM\s+\w+\s*(;|$)/i,
    files: /\.(ts|py)$|(^|\/)(cckb|learnkb)$/,
    fix: "Silme koşulunu önce `SELECT COUNT(*)` ile say, sonra `WHERE` ile daralt.",
    why: "`WHERE`'siz `DELETE` tabloyu boşaltır; bu depoda `forget{contains:\"deneme\"}` tek satır yerine 24 hafızayı sildi.",
  },
  "sql-params": {
    severity: "hata",
    detect: /execute\(\s*f["']|execute\(\s*["'][^"']*%s/,
    files: /\.py$/,
    fix: "Parametreleri `?` ile geçir: `execute(\"... WHERE id = ?\", (id,))`.",
    why: "Metin birleştirmeyle kurulan sorguda değer, komutun parçası olur; `x' OR '1'='1` tüm satırları döndürür.",
  },
  "agents-upsert-remember": {
    severity: "hata",
    detect: /"ns"\s*:\s*"(?!default")/,
    files: /\.(ts|py)$|(^|\/)(cckb|learnkb|ecy-[a-z-]+)$/,
    fix: "`remember` çağrısında `ns: \"default\"` kullan; ayrı namespace istiyorsan recall'ın onu da taradığını KANITLA.",
    why: "`recall` varsayılan olarak `ns=default`'a süzülüdür; başka namespace'e yazılan not kaydedilir ama hiçbir arama onu döndürmez.",
  },
  "agents-token-budget": {
    severity: "uyarı",
    detect: /\[\s*:\s*\d{3,}\s*\]/,
    files: /\.py$|(^|\/)(cckb|learnkb)$/,
    fix: "Kırpmayı cümle/kelime sınırında yap; kimlik (slug) ve kaynak URL'sini asla kırpma.",
    why: "Kör kırpma cümleyi ortadan böler ve kaynak bağlantısını uçurur — ajanın bir sonraki adımı tam olarak o alanlara bağlıdır.",
  },
  "obs-dataview": {
    severity: "hata",
    detect: /(LIST|TABLE)[^\n]*FROM\s+#(cc|learn|system)\//,
    files: /\.md$|\.(ts|py)$/,
    fix: "Kategori sorgusunu backlink ile yaz: `LIST FROM [[learn-<izlek>]]`.",
    why: "brain notu yeniden ürettiğinde özel etiketleri düşürür; etiket tabanlı Dataview sorgusu bir sonraki senkronda sessizce boşalır.",
  },

  /* ───────────────────────────────── web */
  "web-xss-escape": {
    severity: "hata",
    detect: /\.innerHTML\s*=/,
    files: /\.(html|js|mjs|ts)$/,
    fix: "Metin yazarken `textContent`, HTML üretirken ayrı bir `escapeHtml()` fonksiyonundan geçir.",
    why: "`innerHTML` verilen metni KOD olarak çalıştırır; veri bugün bizim olsa da yarın bir yapılandırma dosyasından gelir.",
  },
  "web-rel-attr": {
    severity: "uyarı",
    detect: /target="_blank"(?![^>]*noopener)/,
    files: /\.(html|ts)$/,
    fix: "`target=\"_blank\"` ile birlikte `rel=\"noopener\"` yaz.",
    why: "Açılan sayfa `window.opener` üzerinden kaynak sekmeyi yönlendirebilir; 100+ dış bağlantılı bir sitede tek eksik en zayıf halkadır.",
  },
  "http-timeout": {
    severity: "uyarı",
    detect: /await\s+fetch\((?![^)]*signal)[^)]*\)\s*;/,
    files: /(^|\/)server\/[\w-]+\.ts$/,
    fix: "`AbortController` kur, `signal` geçir ve `finally` içinde `clearTimeout` yap.",
    why: "`fetch`'in varsayılan zaman aşımı yoktur; yanıt vermeyen bir servis isteği süresiz asar.",
  },
};

/** Rules that gate the build (`hata`), vs. reported-only (`uyarı`). */
export function policyIds(): string[] {
  return Object.keys(POLICIES).sort();
}

/** Serialise for the Python linter. RegExp → source string; flags are not used by design. */
export function policyJson(stamp: string, trackOf: (id: string) => string = () => "?"): string {
  const rules = policyIds().map((id) => {
    const p = POLICIES[id];
    return {
      id,
      track: trackOf(id),
      severity: p.severity,
      detect: p.detect.source,
      files: p.files.source,
      fix: p.fix,
      why: p.why,
      raw: Boolean(p.raw),
      exceptions: (p.exceptions ?? []).map((e) => ({ path: e.path.source, reason: e.reason })),
    };
  });
  return JSON.stringify(
    {
      generated: stamp,
      count: rules.length,
      hata: rules.filter((r) => r.severity === "hata").length,
      uyari: rules.filter((r) => r.severity === "uyarı").length,
      note:
        "Her kural bir DERSTEN türer (id = ders id'si). `detect` ANTİ-DESENDİR: dersin kendi " +
        "`pattern`'i doğru kullanımı bulur, bu ise ihlali. İstisnaların gerekçesi zorunludur.",
      rules,
    },
    null,
    2,
  );
}

/** The human/agent-readable policy note (vault). Deterministic. */
export function renderPolicyMd(titleOf: (id: string) => string): string {
  const ids = policyIds();
  const L: string[] = [
    "# Kod Politikası — dört sistemin uyacağı kurallar",
    "",
    "> Bu sayfa **insana ders** değil, **sisteme kural**dır. Her satır bir dersten türer ve dört",
    "> sistemin kendi karar noktasına girer: ollamas ortak-prompt · eCym coder kuralları ·",
    "> obsidian vault-yazma betikleri · Claude Code skill'i.",
    "",
    `**${ids.length} kural** · \`hata\` ${ids.filter((i) => POLICIES[i].severity === "hata").length} (kapı) · \`uyarı\` ${ids.filter((i) => POLICIES[i].severity === "uyarı").length} (raporlanır)`,
    "",
    "```bash",
    "learnkb lint <yol>              # ihlal / gerekçeli istisna / temiz",
    "learnkb lint --rule <id>        # tek kural",
    "learnkb lint --system ollamas   # bir sistemin tamamı",
    "```",
    "",
    "> **Üç hüküm, iki değil.** Anti-desenlerin bir kısmı bağlamında DOĞRUdur; bu yüzden her",
    "> kural gerekçeli istisna taşıyabilir. Her şeye ihlal diyen bir denetleyici, hiçbir şeyi",
    "> yakalamayan kadar hızlı güven kaybeder.",
    "",
    "| Kural | Ağırlık | Yasak | Yerine | Neden |",
    "|-------|---------|-------|--------|-------|",
  ];
  for (const id of ids) {
    const p = POLICIES[id];
    const esc = (s: string) => s.replace(/\|/g, "\\|");
    L.push(
      `| [[learn-${id}\\|${esc(titleOf(id))}]] | \`${p.severity}\` | \`${esc(p.detect.source)}\` | ${esc(p.fix)} | ${esc(p.why)} |`,
    );
  }
  const withEx = ids.filter((i) => (POLICIES[i].exceptions ?? []).length);
  if (withEx.length) {
    L.push("", "## Gerekçeli istisnalar", "");
    for (const id of withEx) {
      for (const e of POLICIES[id].exceptions ?? []) {
        L.push(`- **${id}** · \`${e.path.source}\` — ${e.reason}`);
      }
    }
  }
  L.push("", "---", "**Hub:** [[learn]] · **Uyum ölçümü:** `_index/learn-compliance.json` · **Müfredat:** [[learn-mufredat]]", "");
  return L.join("\n");
}
