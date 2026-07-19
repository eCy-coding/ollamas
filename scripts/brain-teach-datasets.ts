// Brain TEACH (T1) — curated Python + macOS knowledge datasets, from the machine's
// own $0 sources: python3's introspection (keywords/builtins/stdlib docstrings) and
// the man-db whatis one-liners. Records land as procedural-tier knowledge
// (ns=knowledge, stable teach:* ids → idempotent re-runs refresh, never pile up).
// Write-behind keeps this immune to embedder queues. Usage: make brain-teach
import { execFileSync } from "node:child_process";
import { brainRemember, brainAssertFact } from "../server/brain";

export interface TeachRecord { id: string; content: string; actor: string; fact?: { subject: string; predicate: string; object: string } }

const PY_MODULES = [
  "os", "sys", "json", "re", "pathlib", "subprocess", "sqlite3", "asyncio", "csv",
  "datetime", "itertools", "functools", "typing", "unittest", "argparse", "logging",
  "collections", "urllib.request", "http.server", "shutil", "tempfile", "hashlib",
  "base64", "random", "math", "statistics",
];

export const MACOS_ALLOWLIST = [
  "ls", "cd", "cp", "mv", "rm", "mkdir", "cat", "grep", "find", "sed", "awk", "tar",
  "curl", "ssh", "scp", "chmod", "chown", "ps", "top", "kill", "df", "du", "diskutil",
  "launchctl", "plutil", "defaults", "mdfind", "sw_vers", "sysctl", "log", "pmset",
  "networksetup", "ifconfig", "ping", "dig", "open", "pbcopy", "pbpaste", "say",
  "screencapture", "softwareupdate", "xcode-select", "brew", "git", "make", "man",
  "which", "history", "crontab", "zip", "unzip", "head", "tail", "sort", "uniq", "wc",
  "xargs", "ln", "touch", "date", "uptime", "whoami", "hostname", "uname", "env",
  "caffeinate", "afplay", "osascript", "codesign", "spctl", "tmutil", "system_profiler",
];

/** Pure: python introspection JSON → teach records. */
export function buildPythonRecords(raw: { keywords: string[]; builtins: [string, string][]; modules: [string, string][] }): TeachRecord[] {
  const out: TeachRecord[] = [];
  for (const kw of raw.keywords.slice(0, 40)) {
    out.push({ id: `teach:python:kw-${kw}`, actor: "python", content: `Python anahtar kelimesi '${kw}' — dilin çekirdek sözdizimi ögesi.` });
  }
  for (const [name, doc] of raw.builtins.slice(0, 80)) {
    if (!doc) continue;
    out.push({ id: `teach:python:fn-${name}`, actor: "python", content: `Python builtin ${name}(): ${doc.slice(0, 200)}` });
  }
  for (const [name, doc] of raw.modules.slice(0, 30)) {
    if (!doc) continue;
    out.push({
      id: `teach:python:mod-${name.replace(/\./g, "-")}`,
      actor: "python",
      content: `Python modülü '${name}': ${doc.slice(0, 300)} — import ${name} ile kullanılır.`,
      fact: { subject: "python", predicate: "provides", object: name },
    });
  }
  return out;
}

/** Pure: whatis text + allowlist → teach records. */
export function buildMacosRecords(whatisText: string, allow: string[]): TeachRecord[] {
  const out: TeachRecord[] = [];
  const seen = new Set<string>();
  for (const line of whatisText.split("\n")) {
    // macOS whatis: "name(1), alias(1)   - description" and keyword-matches leak in —
    // only lines whose OWN name list contains an allowlisted command count.
    const parts = line.split(/\s+-\s+/);
    if (parts.length < 2) continue;
    const names = [...parts[0].matchAll(/([\w.+-]+)\(\d/g)].map((m) => m[1]);
    const cmd = names.find((n) => allow.includes(n));
    if (!cmd || seen.has(cmd)) continue;
    seen.add(cmd);
    const desc = parts.slice(1).join(" - ");
    out.push({
      id: `teach:macos:${cmd}`,
      actor: "macos",
      content: `macOS komutu '${cmd}': ${desc.slice(0, 200)}. Terminalde \`${cmd}\` olarak çalıştırılır.`,
      fact: { subject: "macos", predicate: "has_command", object: cmd },
    });
  }
  return out;
}


// ——— Kritik-öncelikli setler (teach v2). Sıra = Emre'nin gerçek iş yükü. ———

const NODE_MOD_DESC: Record<string, string> = {
  fs: "dosya sistemi okuma/yazma", path: "dosya yolu birleştirme/çözme", http: "HTTP sunucu/istemci",
  https: "TLS'li HTTP", crypto: "hash/şifreleme/UUID", child_process: "alt süreç çalıştırma (execFile/spawn)",
  os: "işletim sistemi bilgisi", url: "URL parse", util: "promisify vb. yardımcılar", events: "EventEmitter",
  stream: "akış işleme", buffer: "ikili veri", zlib: "sıkıştırma", net: "TCP soketleri", dns: "DNS sorguları",
  readline: "satır-satır girdi", worker_threads: "iş parçacıkları", cluster: "çok-çekirdek süreçler",
  assert: "test doğrulamaları", timers: "setTimeout/setInterval", "fs/promises": "async dosya işlemleri",
};
const TS_CONCEPTS: [string, string][] = [
  ["interface", "nesne şeklini tanımlar; declaration merging destekler"],
  ["type-alias", "type X = ... — union/intersection/mapped tipler için"],
  ["generics", "T tip parametresi — yeniden kullanılabilir tip-güvenli fonksiyon/sınıf"],
  ["union", "A | B — birden çok olası tip; narrowing ile daraltılır"],
  ["narrowing", "typeof/in/instanceof kontrolleriyle union tipini daraltma"],
  ["satisfies", "değerin tipe uyduğunu doğrular, literal tipleri korur"],
  ["unknown", "güvenli any — kullanmadan önce daraltma zorunlu"],
  ["never", "asla oluşmayan tip; exhaustiveness kontrolünde kullanılır"],
  ["readonly", "değiştirilemez alan/dizi işareti"],
  ["optional-chaining", "a?.b — null/undefined'da kısa devre"],
  ["nullish-coalescing", "a ?? b — yalnız null/undefined'da b"],
  ["async-await", "Promise tabanlı asenkron akış; try/catch ile hata"],
  ["tsconfig-strict", "strict:true — null kontrolleri + tip güvenliği tavsiye edilen temel"],
];
export function buildNodeRecords(builtinModules: string[]): TeachRecord[] {
  const out: TeachRecord[] = [];
  for (const m of builtinModules.filter((x) => !x.startsWith("_")).slice(0, 40)) {
    const d = NODE_MOD_DESC[m] || "Node.js çekirdek modülü";
    out.push({ id: `teach:node:mod-${m.replace(/\//g, "-")}`, actor: "nodejs",
      content: `Node.js modülü '${m}': ${d}. import ... from "node:${m}" ile kullanılır.`,
      fact: { subject: "nodejs", predicate: "provides", object: m } });
  }
  for (const [c, d] of TS_CONCEPTS) {
    out.push({ id: `teach:ts:${c}`, actor: "typescript", content: `TypeScript kavramı '${c}': ${d}.` });
  }
  return out;
}

const GIT_DESC: Record<string, string> = {
  add: "değişiklikleri stage'e alır", commit: "stage'lenmiş değişiklikleri kalıcı kaydeder",
  push: "yerel commit'leri uzak repoya gönderir", pull: "uzaktan çekip birleştirir",
  fetch: "uzak referansları indirir, birleştirmez", merge: "dalları birleştirir",
  rebase: "commit'leri başka taban üzerine yeniden uygular — tarih düzleşir",
  branch: "dal listeler/oluşturur", checkout: "dal/commit'e geçer", switch: "dal değiştirir (modern)",
  restore: "dosyayı eski haline döndürür", stash: "değişiklikleri geçici rafa kaldırır",
  log: "commit tarihçesi", diff: "farkları gösterir", status: "çalışma ağacı durumu",
  reset: "HEAD/stage'i geri alır (--hard çalışma ağacını da)", revert: "commit'i ters commit'le geri alır",
  "cherry-pick": "tek commit'i başka dala uygular", tag: "sürüm etiketi", worktree: "aynı repo için ek çalışma dizini",
  bisect: "hatalı commit'i ikili aramayla bulur", blame: "satır bazında son değiştiren commit",
  clone: "repoyu kopyalar", init: "yeni repo başlatır", remote: "uzak repo tanımları",
};
export function buildGitRecords(helpText: string): TeachRecord[] {
  const cmds = new Set<string>();
  for (const line of helpText.split("\n")) {
    const m = line.match(/^\s{2,}([a-z][a-z-]+)\s/);
    if (m) cmds.add(m[1]);
  }
  for (const k of Object.keys(GIT_DESC)) cmds.add(k);
  return [...cmds].filter((c) => GIT_DESC[c]).map((c) => ({
    id: `teach:git:${c}`, actor: "git",
    content: `git ${c}: ${GIT_DESC[c]}. Kullanım: \`git ${c}\`.`,
    fact: { subject: "git", predicate: "has_command", object: c },
  }));
}

const SQL_SET: [string, string][] = [
  ["select", "SELECT kolon FROM tablo WHERE koşul — veri okuma"],
  ["insert", "INSERT INTO tablo(kolonlar) VALUES(...) — satır ekleme"],
  ["update", "UPDATE tablo SET kolon=değer WHERE koşul"],
  ["delete", "DELETE FROM tablo WHERE koşul"],
  ["create-table", "CREATE TABLE IF NOT EXISTS — şema tanımı"],
  ["alter-table", "ALTER TABLE ADD COLUMN — şema evrimi (sqlite sınırlı destekler)"],
  ["index", "CREATE INDEX — sorgu hızlandırma; WHERE/JOIN kolonlarına"],
  ["join", "INNER/LEFT JOIN — tabloları ilişkiyle birleştirme"],
  ["group-by", "GROUP BY + COUNT/SUM — kümeleme"],
  ["transaction", "BEGIN/COMMIT/ROLLBACK — atomik değişiklik"],
  ["wal", "PRAGMA journal_mode=WAL — eşzamanlı okuma/yazma (brain.db bunu kullanır)"],
  ["busy-timeout", "PRAGMA busy_timeout=5000 — kilit beklemesi"],
  ["fts5", "CREATE VIRTUAL TABLE ... USING fts5 — tam metin arama (brain BM25 kolu)"],
  ["vec0", "sqlite-vec vec0 sanal tablosu — vektör KNN (brain semantik kolu)"],
  ["dot-tables", ".tables / .schema — sqlite3 CLI'da şema keşfi"],
];
export function buildSqliteRecords(): TeachRecord[] {
  return SQL_SET.map(([k, d]) => ({ id: `teach:sql:${k}`, actor: "sqlite", content: `SQL/SQLite '${k}': ${d}.` }));
}

const SHELL_SET: [string, string][] = [
  ["pipe", "a | b — a'nın çıktısı b'nin girdisi olur"],
  ["redirect", "> dosya (yaz), >> (ekle), 2>&1 (hatayı da yönlendir)"],
  ["glob", "*.ts, ** — dosya adı kalıpları"],
  ["env-var", "export X=değer; $X ile okunur; tek komutluk: X=1 komut"],
  ["command-subst", "$(komut) — çıktıyı değişkene/argümana koyar"],
  ["and-or", "a && b (başarılıysa), a || b (başarısızsa)"],
  ["background", "komut & — arka planda; jobs/fg ile yönetim"],
  ["heredoc", "<<EOF ... EOF — çok satırlı girdi"],
  ["xargs", "listeyi argümana çevirir: find ... | xargs rm"],
  ["exit-code", "$? — son komutun çıkış kodu; 0=başarı"],
  ["zshrc", "~/.zshrc — kalıcı alias/env; source ile yeniden yükle"],
];
export function buildShellRecords(): TeachRecord[] {
  return SHELL_SET.map(([k, d]) => ({ id: `teach:shell:${k}`, actor: "zsh", content: `Shell/zsh '${k}': ${d}.` }));
}

const HTTP_SET: [string, string][] = [
  ["200", "OK — başarılı"], ["201", "Created — kaynak oluşturuldu"], ["204", "No Content — gövde yok"],
  ["301", "Moved Permanently — kalıcı yönlendirme"], ["302", "Found — geçici yönlendirme"],
  ["304", "Not Modified — önbellek geçerli"], ["400", "Bad Request — bozuk istek"],
  ["401", "Unauthorized — kimlik gerekli"], ["403", "Forbidden — yetki yok"],
  ["404", "Not Found — kaynak yok"], ["409", "Conflict — durum çakışması"],
  ["429", "Too Many Requests — hız limiti; Retry-After başlığına bak"],
  ["500", "Internal Server Error — sunucu hatası"], ["502", "Bad Gateway — ara sunucu kötü yanıt"],
  ["503", "Service Unavailable — geçici meşgul (ollamas embedder-busy bunu döner)"],
  ["504", "Gateway Timeout — ara sunucu zaman aşımı"],
  ["curl-json", "curl -s -X POST url -H 'content-type: application/json' -d '{...}' — JSON POST"],
  ["curl-status", "curl -o /dev/null -w '%{http_code}' — yalnız status kodu"],
  ["rest-idempotent", "GET/PUT/DELETE idempotent; POST değil — retry tasarımında kritik"],
  ["cors", "tarayıcı cross-origin isteği; sunucu Access-Control-Allow-* başlıkları vermeli"],
];
export function buildHttpRecords(): TeachRecord[] {
  return HTTP_SET.map(([k, d]) => ({
    id: `teach:http:${k}`, actor: "http", content: `HTTP '${k}': ${d}.`,
    ...(/^\d+$/.test(k) ? { fact: { subject: "http", predicate: "status", object: `${k} ${d.split(" — ")[0]}` } } : {}),
  }));
}

const LAUNCHD_SET: [string, string][] = [
  ["plist", "~/Library/LaunchAgents/*.plist — kullanıcı servisi tanımı (Label/ProgramArguments/StartCalendarInterval)"],
  ["load", "launchctl bootstrap gui/501 dosya.plist — servisi yükler (eski: load)"],
  ["kickstart", "launchctl kickstart -k gui/501/etiket — servisi (yeniden) başlatır"],
  ["list", "launchctl list | grep etiket — çalışan servisleri listeler"],
  ["print", "launchctl print gui/501/etiket — servis detayı/son çıkış kodu"],
  ["stdout-log", "plist'te StandardOutPath/StandardErrorPath — log dosyaları"],
  ["calendar", "StartCalendarInterval Hour/Minute — cron benzeri zamanlama (brain-maintain 04:00 böyle)"],
  ["keepalive", "KeepAlive true — çökünce yeniden başlat (com.ollamas.server böyle)"],
  ["tcc", "Desktop/Documents erişimi TCC izni ister — launchd servisleri log'u başka yere yazmalı"],
];
export function buildLaunchdRecords(): TeachRecord[] {
  return LAUNCHD_SET.map(([k, d]) => ({ id: `teach:launchd:${k}`, actor: "launchd", content: `launchd '${k}': ${d}.` }));
}


// ——— Dalga-3 (teach v3): 1 ollamas-internal, 2 llm-ops, 3 react, 4 security, 5 docker, 6 sözlük ———

export function buildOllamasRecords(makefileText: string, integrationMd: string): TeachRecord[] {
  const out: TeachRecord[] = [];
  for (const line of makefileText.split("\n")) {
    const m = line.match(/^([a-z][\w-]+):\s*##\s*(.+)$/);
    if (!m) continue;
    out.push({ id: `teach:ollamas:make-${m[1]}`, actor: "ollamas",
      content: `ollamas make hedefi 'make ${m[1]}': ${m[2].slice(0, 200)}`,
      fact: { subject: "ollamas", predicate: "has_make_target", object: m[1] } });
  }
  for (const line of integrationMd.split("\n")) {
    const m = line.match(/^\|\s*([^|]+?)\s*\|\s*\*?\*?(ON|OFF|opt-in)[^|]*\|\s*`?([A-Z_0-9=]+)?`?[^|]*\|\s*([^|]+)\|/);
    if (!m || !m[3]) continue;
    const flag = m[3].split("=")[0];
    out.push({ id: `teach:ollamas:flag-${flag}`, actor: "brain",
      content: `Brain davranışı '${m[1].trim()}' (default ${m[2]}): ${m[4].trim().slice(0, 250)} — flag: ${m[3]}`,
      fact: { subject: "brain", predicate: "has_flag", object: flag } });
  }
  return out;
}

const LLM_OPS: [string, string][] = [
  ["context-window", "modelin tek seferde görebildiği token penceresi; num_ctx ile ayarlanır — büyük pencere = çok RAM/VRAM"],
  ["num-ctx", "ollama'da bağlam boyu; 256K default bazı modellerde 44GB spill yapar — 8192 gibi sınırla (yaşanmış gotcha)"],
  ["quantization", "Q4_K_M gibi — ağırlıkları küçültür, VRAM düşer, kalite az düşer"],
  ["embedding", "metni vektöre çevirme; nomic-embed-text 768-dim — brain'in semantik araması bununla"],
  ["kv-cache", "üretim sırasında dikkat anahtar/değerleri; uzun sohbette VRAM'i şişirir"],
  ["vram-contention", "chat modeli + embedder aynı GPU'da yarışır — brain write-behind/GPU-gate bunun için var"],
  ["keep-alive", "ollama modelin bellekte kalma süresi; sık swap = yavaşlık"],
  ["temperature", "0=deterministik, yüksek=çeşitli; extraction işlerinde düşük tut"],
  ["system-prompt", "modelin rol/kural tanımı; ollamas'ta withSystemOverride ile"],
  ["keyless-provider", "pollinations gibi $0 API — brain distill/ask sentezi bununla, ollama'ya bağımlı değil"],
  ["rag", "retrieval-augmented generation: önce ara, bulguları bağlama koy, sonra üret — brain ask böyle çalışır"],
  ["rerank", "ilk arama sonuçlarını cross-encoder ile yeniden sıralama; brain MRR 0.95'i böyle aldı"],
];
export function buildLlmOpsRecords(): TeachRecord[] {
  return LLM_OPS.map(([k, d]) => ({ id: `teach:llm:${k}`, actor: "llm-ops", content: `LLM-ops '${k}': ${d}.` }));
}

const REACT_SET: [string, string][] = [
  ["component", "UI parçası — props alır, JSX döner; büyük harfle başlar"],
  ["props", "üstten gelen salt-okunur veriler; değişirse yeniden render"],
  ["state", "useState — bileşenin kendi verisi; setState yeni referansla"],
  ["useeffect", "yan etki (fetch, abonelik); bağımlılık dizisi ŞART, temizlik fonksiyonu döndür"],
  ["key", "liste elemanlarında benzersiz key — index kullanma, kimlik kullan"],
  ["memo", "React.memo/useMemo/useCallback — gereksiz render'ı keser; inline obje/fonksiyon yeni referans üretir"],
  ["controlled-input", "value+onChange ile form; state tek gerçek kaynak"],
  ["lifting-state", "ortak state'i en yakın ortak ataya taşı"],
  ["conditional-render", "koşullu JSX: {cond && <X/>} veya üçlü operatör"],
  ["hooks-rules", "hook'lar en üst düzeyde, koşulsuz, her render aynı sırada çağrılır"],
];
export function buildReactRecords(): TeachRecord[] {
  return REACT_SET.map(([k, d]) => ({ id: `teach:react:${k}`, actor: "react", content: `React '${k}': ${d}.` }));
}

const SEC_SET: [string, string][] = [
  ["tls", "HTTPS'in şifreleme katmanı; sertifika doğrulaması atlanmaz"],
  ["ssh-key", "parola yerine anahtar çifti; özel anahtar ASLA paylaşılmaz, ~/.ssh/id_ed25519"],
  ["secret-hygiene", "API key/token koda ve log'a yazılmaz — env/keychain; brain redaction-gate bunu zorlar"],
  ["least-privilege", "her servis yalnız gereken izinle koşar; loopback-only route'lar bu ilke"],
  ["injection", "kullanıcı girdisi sorguya/komuta ham katılmaz — parametreli sorgu, allowlist"],
  ["xss", "kullanıcı içeriği HTML'e escape'siz basılmaz (brain paneli esc() kullanır)"],
  ["csrf", "durum değiştiren istekler token/SameSite ile korunur"],
  ["port-scan", "açık portlar yüzeydir; lsof -i / networksetup ile denetle"],
  ["firewall", "macOS: Sistem Ayarları > Ağ > Güvenlik Duvarı; pf ile gelişmiş"],
  ["rate-limit", "429 + Retry-After; brute-force ve maliyet koruması"],
  ["backup-3-2-1", "3 kopya, 2 ortam, 1 offsite; brain gece backup+restore-drill yapar"],
];
export function buildSecurityRecords(): TeachRecord[] {
  return SEC_SET.map(([k, d]) => ({ id: `teach:sec:${k}`, actor: "security", content: `Güvenlik '${k}': ${d}.` }));
}

const DOCKER_SET: [string, string][] = [
  ["image", "değişmez şablon; Dockerfile'dan build edilir"],
  ["container", "image'ın çalışan örneği; docker run ile"],
  ["dockerfile", "FROM/RUN/COPY/CMD — katmanlı build tarifi"],
  ["volume", "kalıcı veri: -v host:container; container silinse de kalır"],
  ["port-map", "-p 8080:80 — host:container port eşleme"],
  ["compose", "docker-compose.yml — çok servisli stack tek komutla"],
  ["exec", "docker exec -it ad bash — çalışan container'a gir"],
  ["logs", "docker logs -f ad — canlı log"],
  ["prune", "docker system prune — kullanılmayanları temizle (disk kurtarır)"],
  ["arm64", "Apple Silicon'da platform farkı: --platform linux/amd64 bazen gerekir (yaşanmış gotcha)"],
];
export function buildDockerRecords(): TeachRecord[] {
  return DOCKER_SET.map(([k, d]) => ({ id: `teach:docker:${k}`, actor: "docker", content: `Docker '${k}': ${d}.` }));
}

const GLOSSARY: [string, string][] = [
  ["deprecated", "kullanımdan kaldırılıyor — yenisine geç"], ["breaking-change", "geriye uyumsuz değişiklik"],
  ["backward-compatible", "eski kullanımlar çalışmaya devam eder"], ["idempotent", "tekrar koşmak sonucu değiştirmez"],
  ["race-condition", "zamanlamaya bağlı hata — eşzamanlı erişim çakışması"], ["deadlock", "karşılıklı kilit bekleme kilitlenmesi"],
  ["throttle", "hız sınırlama"], ["debounce", "ardışık tetiklemeleri bekletip tekle indirme"],
  ["fallback", "birincil yol başarısızsa yedek yol"], ["graceful-degradation", "kısmi arızada azaltılmış ama çalışır hizmet"],
  ["single-source-of-truth", "verinin tek yetkili kaynağı"], ["choke-point", "tüm akışın geçtiği tek denetim noktası"],
  ["boilerplate", "tekrarlayan kalıp kod"], ["scaffold", "iskelet/başlangıç yapısı"],
  ["lint", "stil/hata denetleyici"], ["ci-cd", "sürekli entegrasyon/teslimat boru hattı"],
  ["regression", "önceden çalışanın bozulması"], ["edge-case", "uç durum"],
  ["stale", "bayat/güncelliğini yitirmiş"], ["upstream-downstream", "kaynak yön / tüketen yön"],
  ["observability", "sistemi log/metric/trace ile gözlemleyebilme"], ["telemetry", "otomatik ölçüm verisi"],
];
export function buildGlossaryRecords(): TeachRecord[] {
  return GLOSSARY.map(([k, d]) => ({ id: `teach:term:${k}`, actor: "glossary", content: `Teknik terim '${k}': ${d}.` }));
}


// ——— Dalga-4 (teach v4): temel başlangıç katmanı — her şeyin tabanı ———

const PROG_BASICS: [string, string][] = [
  ["degisken", "değer tutan isimli kutu; let/const (JS), = (Python)"],
  ["dongu", "for/while — tekrar eden iş; her turda durum ilerler, çıkış koşulu şart"],
  ["kosul", "if/else — akışı duruma göre dallandırır"],
  ["fonksiyon", "girdi alıp çıktı dönen yeniden kullanılabilir blok; tek iş yapsın"],
  ["dizi-array", "sıralı eleman listesi; index 0'dan başlar"],
  ["map-dict", "anahtar→değer eşlemesi; O(1) erişim"],
  ["set-kume", "tekrarsız eleman topluluğu; üyelik kontrolü hızlı"],
  ["stack", "LIFO — son giren ilk çıkar (çağrı yığını böyle)"],
  ["queue", "FIFO — ilk giren ilk çıkar (iş kuyrukları böyle)"],
  ["recursion", "fonksiyonun kendini çağırması; TABAN KOŞUL şart yoksa sonsuz döngü/stack overflow"],
  ["big-o", "algoritma maliyet büyümesi: O(1) sabit, O(n) doğrusal, O(n²) kare — iç içe döngü kokusu"],
  ["hata-yonetimi", "try/catch — hata yakala, anlamlı mesaj ver, sessizce yutma"],
  ["null-undefined", "değer yokluğu; kontrolsüz erişim çöker — önce kontrol et"],
  ["immutability", "veriyi değiştirmek yerine yenisini üret; yan etki azalır"],
  ["scope", "değişkenin görünür olduğu alan; blok içi dışarıdan görünmez"],
  ["string-islem", "birleştirme, kesme (slice), arama (includes), bölme (split)"],
  ["tip", "sayı/metin/boolean/nesne — tip karışıklığı hataların anasıdır"],
  ["yorum", "kod NE yapıyor değil NEDEN yapıyor açıklanır"],
];
export function buildProgBasicsRecords(): TeachRecord[] {
  return PROG_BASICS.map(([k, d]) => ({ id: `teach:prog:${k}`, actor: "programming", content: `Programlama temeli '${k}': ${d}.` }));
}

const COMPUTER_BASICS: [string, string][] = [
  ["cpu", "komutları yürüten işlemci; çekirdek sayısı paralel iş kapasitesi"],
  ["ram", "hızlı geçici bellek; kapanınca silinir; yetmezse swap→yavaşlama"],
  ["disk", "kalıcı depolama (SSD hızlı); dosya sistemi burada yaşar"],
  ["gpu", "paralel matris işlemci; grafik + LLM inference (Apple Silicon'da RAM'le paylaşımlı)"],
  ["process", "çalışan program örneği; kendi bellek alanı var"],
  ["thread", "process içi hafif iş kolu; belleği paylaşır — process'ten farkı bu"],
  ["dosya-sistemi", "dizin ağacı; yol = /kök/klasör/dosya; ~ ev dizini"],
  ["binary-hex", "bilgisayar 0/1 konuşur; hex (0xFF) binary'nin okunur kısaltması"],
  ["utf8", "evrensel metin kodlaması; Türkçe karakterler çok-bayt — encoding karışırsa � çıkar"],
  ["onbellek-cache", "sık kullanılanı yakında tutma; hız kazandırır, bayatlama riski getirir"],
  ["environment", "process'e dışarıdan verilen ayarlar (env değişkenleri)"],
  ["kernel", "donanımla programlar arasındaki çekirdek yönetici (macOS: Darwin)"],
];
export function buildComputerBasicsRecords(): TeachRecord[] {
  return COMPUTER_BASICS.map(([k, d]) => ({ id: `teach:comp:${k}`, actor: "computer", content: `Bilgisayar temeli '${k}': ${d}.` }));
}

const INTERNET_BASICS: [string, string][] = [
  ["ip-adres", "makinenin ağdaki numarası; 127.0.0.1 = localhost (kendi makinen)"],
  ["dns", "alan adını IP'ye çevirir (google.com → 142.x) — internetin telefon rehberi"],
  ["tcp", "güvenilir sıralı bağlantı; HTTP bunun üstünde"],
  ["udp", "hızlı, garanti yok; canlı yayın/oyun"],
  ["port", "aynı makinede servis kapısı; ollamas 3000, ollama 11434"],
  ["istemci-sunucu", "istemci ister, sunucu cevaplar; tarayıcın istemci, ollamas sunucu"],
  ["http-yasam", "istek: metot+yol+başlık+gövde → cevap: status+başlık+gövde"],
  ["api", "programların birbiriyle konuşma sözleşmesi; REST = HTTP üstünde kaynak-odaklı"],
  ["url", "protokol://host:port/yol?sorgu — adresin anatomisi"],
  ["ssl-sertifika", "https kilidi; sunucunun kimlik kanıtı"],
  ["bant-genisligi", "birim zamanda veri; gecikme (latency) ayrı şey — ikisi karıştırılır"],
];
export function buildInternetBasicsRecords(): TeachRecord[] {
  return INTERNET_BASICS.map(([k, d]) => ({ id: `teach:net:${k}`, actor: "internet", content: `İnternet temeli '${k}': ${d}.` }));
}

const DATA_FORMATS: [string, string][] = [
  ["json", "{\"anahtar\": \"değer\"} — API'lerin ortak dili; son elemanda virgül YOK"],
  ["yaml", "girintiyle yapı; config dosyaları; TAB değil boşluk"],
  ["csv", "virgülle ayrık tablo; ilk satır başlık"],
  ["markdown", "# başlık, **kalın**, - liste, ``` kod — README'lerin dili"],
  ["base64", "ikili veriyi metne çevirme; şifreleme DEĞİL kodlama"],
  ["regex-temel", ". herhangi, * tekrar, + en-az-bir, ^ başlangıç, $ son, [abc] küme, \\d rakam"],
  ["escape", "özel karakteri düz kullanmak: \\n satır, \\t tab, \\\\ ters-eğik"],
  ["timestamp", "epoch ms = 1970'ten beri milisaniye; ISO 8601 = 2026-07-18T15:00Z"],
];
export function buildDataFormatRecords(): TeachRecord[] {
  return DATA_FORMATS.map(([k, d]) => ({ id: `teach:fmt:${k}`, actor: "data-format", content: `Veri formatı '${k}': ${d}.` }));
}

const SOFTWARE_PRACTICE: [string, string][] = [
  ["unit-test", "tek fonksiyonu izole test eder; hızlı, çok sayıda"],
  ["e2e-test", "sistemi uçtan uca kullanıcı gibi test eder; az ama değerli"],
  ["tdd", "önce KIRMIZI test yaz, sonra geçir (yeşil), sonra temizle"],
  ["debugging", "belirtiyi değil KÖKÜ bul: yeniden üret → daralt → hipotez → doğrula"],
  ["refactoring", "davranışı değiştirmeden kodu iyileştirme; testler güvence"],
  ["dry", "kendini tekrarlama — ortak kodu tek yere topla"],
  ["kiss", "basit tut — akıllıca karmaşık yerine sıkıcı ama net"],
  ["yagni", "ihtiyacın yoksa yazma — belki-lazım-olur kodu yük"],
  ["code-review", "başkasının gözü; küçük diff'ler incelenir, dev diff'ler onaylanır (kötü)"],
  ["semver", "MAJOR.MINOR.PATCH — kırıcı.özellik.düzeltme"],
  ["log", "ne olduğunu iz bırak; hata mesajına bağlam koy"],
  ["rubber-duck", "sorunu yüksek sesle anlat — çoğu zaman anlatırken çözülür"],
];
export function buildSoftwarePracticeRecords(): TeachRecord[] {
  return SOFTWARE_PRACTICE.map(([k, d]) => ({ id: `teach:pratik:${k}`, actor: "practice", content: `Yazılım pratiği '${k}': ${d}.` }));
}

const LOGIC_MATH: [string, string][] = [
  ["boolean", "AND (ikisi de), OR (en az biri), NOT (tersi); kısa devre: false && x hiç bakmaz"],
  ["mod", "kalan: 10 % 3 = 1; döngüsel işlerde (saat, ring buffer)"],
  ["ortalama-medyan", "ortalama uç değere duyarlı; medyan ortadaki — çarpık veride medyan"],
  ["olasilik", "0-1 arası; bağımsız olaylar çarpılır; nadir olay çok denemede olağanlaşır"],
  ["ustel", "2^n patlar: 2^10≈bin, 2^20≈milyon, 2^30≈milyar"],
  ["kb-mb-gb", "1 KB=1024 B, MB=1024 KB, GB=1024 MB; disk üreticileri 1000 kullanır (fark bundan)"],
  ["yuvarlama", "float hassasiyeti: 0.1+0.2≠0.3 — para işinde tam sayı kuruş kullan"],
  ["binary-search", "sıralı veride ortadan böl: milyonda 20 adım"],
];
export function buildLogicMathRecords(): TeachRecord[] {
  return LOGIC_MATH.map(([k, d]) => ({ id: `teach:mantik:${k}`, actor: "logic", content: `Mantık/matematik temeli '${k}': ${d}.` }));
}


// ——— Dalga-5: eCy-ekosistem — üç sistemin (ollamas/eCym/odysseus) ortak bilinci ———
const ECOSYSTEM: [string, string][] = [
  ["ollamas", "LLM Mission Control (:3000) — provider router, tool registry, brain; ~/Desktop/ollamas, launchd com.ollamas.server"],
  ["ecym", "Emre'nin $0 kişisel modeli (qwen3:8b+persona); ~/ecy-model/terminal-dataset.json (110+ komut) + brain.vec.json; ecy-brain auto-rebuild dataset değişince"],
  ["odysseus", "zincirin uzak-yürütme halkası (:7860 API, ODY-PULSE panel :4777); ecy-io 'odysseus <task> chat|agent|research|health' ile erişilir"],
  ["ecy-io", "doğrulanmış eCym↔ollamas↔odysseus köprüsü: input/output/read/write/agent/odysseus op'ları; OLLAMAS=:3000, OLLAMA=:11434, ODY=:7860"],
  ["brain-ask", "curl -s -X POST :3000/api/brain/ask -d '{\"question\":\"...\"}' — sentezli atıflı cevap; abstention dürüst"],
  ["conductor-mirror", "orchestration kayıtları ns=org olarak brain'e otomatik akar (dual-write ledger)"],
  ["port-haritasi", "3000 ollamas · 11434 ollama · 7860 odysseus · 4777 ODY-PULSE · 8770 karargah-komutan"],
  ["prensip-sifir-maliyet", "çalışma prensibi: $0-yerel öncelik — keyless provider'lar, lokal modeller; para harcayan yol Emre-onaylı"],
  ["prensip-kanit", "çalışma prensibi: evidence-before-claims — 'çalışıyor' demek = komutu koşup çıktıyı göstermek"],
  ["prensip-choke-point", "çalışma prensibi: tek denetim noktası — tüm tool'lar registry'den, tüm brain-yazımları rememberOne'dan geçer"],
  ["prensip-daemon-gate", "çalışma prensibi: daemon start/stop/restart Emre-onaylı (kickstart dahil)"],
  ["prensip-worktree", "çalışma prensibi: lane'ler izole worktree'de; paylaşılan tarih yeniden yazılmaz"],
  ["prensip-yedek", "çalışma prensibi: karşı-sistem dosyasına yazmadan önce yedek al (.bak-<ts>); idempotent id'li ekleme"],
  ["prensip-senkron", "çalışma prensibi: her teach/brain işlemi sonunda ecosystem-sync koşar — brain fact'leri tazelenir, eCym yeni yetenekleri komut olarak öğrenir, odysseus durumu fact'lenir"],
];
export function buildEcosystemRecords(): TeachRecord[] {
  return ECOSYSTEM.map(([k, d]) => ({ id: `teach:eco:${k}`, actor: "ecosystem",
    content: `eCy ekosistemi '${k}': ${d}.`,
    ...(k.startsWith("prensip") ? {} : { fact: { subject: "ecosystem", predicate: "has_component", object: k } }) }));
}


// ——— Dalga-6: aktif lane setleri ———
const CSS_SET: [string, string][] = [
  ["flexbox", "tek boyutlu dizilim (satır VEYA sütun): display:flex; justify-content yatay, align-items dikey"],
  ["grid", "iki boyutlu yerleşim: display:grid; grid-template-columns: 1fr 1fr — kart ızgaraları için"],
  ["flex-vs-grid", "tek eksen → flex, iki eksen/şablon → grid"],
  ["responsive", "@media (max-width:860px) — mobil kırılımlar; mobile-first yaklaş"],
  ["specificity", "id > class > etiket; inline en güçlü; !important son çare — kaçın"],
  ["box-model", "margin dış, border, padding iç; box-sizing:border-box hesabı sadeleştirir"],
  ["position", "relative (akışta kayar), absolute (en yakın positioned ataya göre), fixed (viewport), sticky"],
  ["z-index", "yalnız positioned elemanlarda; stacking context tuzağı"],
  ["css-var", "--renk: #fff; kullanım var(--renk) — tema değişimi tek noktadan (brain paneli böyle)"],
  ["tailwind-mantik", "utility-first: class='flex gap-2 p-4' — CSS yazmadan kompozisyon; tekrar edeni @apply/bileşene çıkar"],
  ["tailwind-responsive", "md:flex lg:hidden — breakpoint önekleri"],
  ["transition", "transition: all .15s — hover/durum geçişleri; layout-tetikleyen özelliklerden kaçın"],
];
export function buildCssRecords(): TeachRecord[] {
  return CSS_SET.map(([k, d]) => ({ id: `teach:css:${k}`, actor: "css", content: `CSS/Tailwind '${k}': ${d}.` }));
}
const NET_DEEP: [string, string][] = [
  ["dns-a", "A kaydı: alan adı → IPv4; AAAA → IPv6"],
  ["dns-cname", "CNAME: takma ad → başka alan adı; kök domain'de kullanılamaz"],
  ["dns-mx", "MX: e-posta sunucusu; öncelik numaralı"],
  ["dns-txt", "TXT: doğrulama/SPF/DKIM metinleri"],
  ["dns-ttl", "TTL: kaydın önbellek ömrü; taşınmadan önce düşür"],
  ["tcp-handshake", "SYN → SYN-ACK → ACK üçlü el-sıkışma; sonra veri akar"],
  ["tls-akis", "ClientHello → sertifika → anahtar anlaşması → şifreli kanal"],
  ["nat", "özel IP'ler tek genel IP arkasında; içeriden dışarı doğal, dışarıdan içeri port-forward ister"],
  ["dhcp", "IP'yi otomatik dağıtır; kira süreli"],
  ["localhost-vs-lan", "127.0.0.1 yalnız kendi makinen; LAN erişimi için 0.0.0.0 dinle + makine IP'si"],
  ["traceroute", "paketin yol aldığı düğümler; nerede koptuğunu gösterir"],
  ["arp", "IP ↔ MAC eşlemesi; yerel ağ keşfi (eCyNetWatch bunu izler)"],
];
export function buildNetDeepRecords(): TeachRecord[] {
  return NET_DEEP.map(([k, d]) => ({ id: `teach:agderin:${k}`, actor: "network", content: `Ağ-derin '${k}': ${d}.` }));
}
const EDITOR_SET: [string, string][] = [
  ["cmd-p", "VS Code: Cmd+P dosyaya atla; Cmd+Shift+P komut paleti"],
  ["multi-cursor", "Cmd+D aynı kelimeyi sıradaki seçime ekler; Alt+tık serbest imleç"],
  ["find-regex", "arama kutusunda .* ikonu regex açar; $1 ile yakalama-grubu değiştirme"],
  ["goto-def", "F12 tanıma git; Shift+F12 referanslar"],
  ["rename-symbol", "F2 — sembolü her yerde güvenle yeniden adlandır"],
  ["terminal-toggle", "Ctrl+` entegre terminal"],
  ["quick-fix", "Cmd+. hata üstünde hızlı düzeltme önerileri"],
  ["fold", "Cmd+Alt+[ katla — büyük dosyada gezinme"],
  ["zen", "Cmd+K Z dikkat modu"],
];
export function buildEditorRecords(): TeachRecord[] {
  return EDITOR_SET.map(([k, d]) => ({ id: `teach:editor:${k}`, actor: "editor", content: `Editör verimi '${k}': ${d}.` }));
}
const EN_WRITING: [string, string][] = [
  ["pr-baslik", "PR başlığı: emir kipi + kapsam — 'fix(auth): handle expired tokens'"],
  ["pr-aciklama", "PR gövdesi: What/Why/How-tested üç blok; ekran görüntüsü varsa ekle"],
  ["issue-rapor", "Issue: Expected vs Actual + Steps to reproduce + ortam bilgisi"],
  ["rica", "kibar rica: 'Could you please...' / 'Would you mind...' — 'You must' değil"],
  ["tesekkur", "'Thanks for the quick review!' / 'Much appreciated' — kısa ve içten"],
  ["ozur-duzeltme", "'Good catch — fixed in <commit>' — savunma değil düzeltme"],
  ["kararsizlik", "'I might be missing something, but...' — nazik itiraz açılışı"],
  ["takip", "'Just following up on this' — nazik hatırlatma; 'any update?' tek başına sert"],
  ["kapanis", "'Let me know if anything else is needed' — profesyonel kapanış"],
  ["review-istegi", "'PTAL (please take a look) when you get a chance'"],
];
export function buildEnWritingRecords(): TeachRecord[] {
  return EN_WRITING.map(([k, d]) => ({ id: `teach:en:${k}`, actor: "english", content: `İngilizce yazışma '${k}': ${d}.` }));
}


// ——— Dalga-7: günlük iş setleri ———
const PROMPT_ENG: [string, string][] = [
  ["system-prompt", "modelin rolü+kuralları en başta; kısa, emir kipi, çelişkisiz"],
  ["few-shot", "2-3 örnek girdi→çıktı göster; format örneklerden öğrenilir"],
  ["cot", "adım-adım düşündür ('think step by step') — mantık işlerinde isabet artar"],
  ["json-extraction", "SADECE-JSON iste + şemayı ver; sondan-geriye parse et (reasoning sızıntısına dayanıklı — parseExtraction böyle)"],
  ["anti-halusinasyon", "kaynak-dışına çıkma yasağı + 'yoksa BİLGİ_YOK yaz' kaçışı (brain-ask deseni)"],
  ["kisit-liste", "yapma-listesi ver: 'süsleme yok, tahmin yok, en fazla N madde'"],
  ["sicaklik", "extraction/kod işinde temperature düşük; yaratıcı işte yüksek"],
  ["delimiter", "kullanıcı-metnini ``` ya da <text> ile ayır — talimat-karışması (injection) azalır"],
  ["rol-atama", "'Sen bir X uzmanısın' — cevap dilini/derinliğini kalibre eder"],
  ["iteratif-daraltma", "geniş cevap → 'şimdi sadece Y kısmını derinleştir' zinciri"],
  ["citation-zorunlu", "her iddiaya [kaynak-id] şartı — doğrulanabilirlik (ask'ın [mem:id] deseni)"],
  ["ornek-negatif", "yanlış-örnek de göster: 'ŞÖYLE YAPMA: ...' — sınır netleşir"],
];
export function buildPromptEngRecords(): TeachRecord[] {
  return PROMPT_ENG.map(([k, d]) => ({ id: `teach:prompt:${k}`, actor: "prompt-eng", content: `Prompt mühendisliği '${k}': ${d}.` }));
}
const VITEST_SET: [string, string][] = [
  ["describe-it", "describe blok gruplar, it/test tek durum; isim davranışı anlatsın"],
  ["expect", "expect(x).toBe (özdeş) / toEqual (derin) / toContain / toThrow"],
  ["red-green", "önce KIRMIZI (davranış yok), sonra minimal kodla YEŞİL, sonra temizle"],
  ["vi-fn", "vi.fn() sahte fonksiyon; çağrı sayısı/argüman assert edilir"],
  ["fixture", "sabit örnek veri — gerçek-format kopyası kullan (whatis/Makefile fixture'larımız gibi)"],
  ["injectable-deps", "IO'yu parametre yap (embed, generate, now) — test deterministik olur (brain deseni)"],
  ["test-timeout", "yavaş test: it('...', fn, 30000) — paralel yüklü kutuda 5s default yetmez (yaşanmış)"],
  ["in-process-http", "app'i import + http.createServer — route'ları portsuz gerçek test (brain-panel deseni)"],
  ["run-one", "npx vitest run dosya -t 'isim' — tek testi koş, hızlı döngü"],
  ["flaky", "paralel-suite'te düşen testi İZOLE koş — geçiyorsa flaky, kod değil ortam (demo.test yaşandı)"],
];
export function buildVitestRecords(): TeachRecord[] {
  return VITEST_SET.map(([k, d]) => ({ id: `teach:vitest:${k}`, actor: "vitest", content: `Vitest/test '${k}': ${d}.` }));
}
const REGEX_DEEP: [string, string][] = [
  ["named-group", "(?<ad>...) — eşleşmeye isimle eriş: m.groups.ad"],
  ["lookahead", "x(?=y) y GELECEKSE x; x(?!y) gelmeyecekse — tüketmeden bakar"],
  ["greedy-lazy", ".* açgözlü (en uzun), .*? tembel (en kısa) — HTML/quote parse'ta kritik"],
  ["flags", "g tümü, i harf-duyarsız, m çok-satır (^$ satır-başı), s nokta=newline, u unicode (TR şart)"],
  ["char-class", "[a-z0-9_-] küme; ^ içeride NEGATİF: [^\\s] boşluk-olmayan"],
  ["anchor", "^ başlangıç $ son \\b kelime-sınırı — kısmi-eşleşme kazalarını keser"],
  ["escape-ozel", ". * + ? ( ) [ ] { } | \\ ^ $ — düz kullanmak için \\ ile kaçır"],
  ["replace-group", "replace(/(\\d+)-(\\d+)/, '$2-$1') — yakalanan grupla değiştirme"],
  ["yaygin-desen", "email ^[^@\\s]+@[^@\\s]+$ · semver ^\\d+\\.\\d+\\.\\d+ · hex-hash ^[a-f0-9]{7,40}$"],
  ["test-once", "regex101 benzeri yerine node -e ile hızlı doğrula; ÜRETİME test'siz regex sokma"],
];
export function buildRegexRecords(): TeachRecord[] {
  return REGEX_DEEP.map(([k, d]) => ({ id: `teach:regex:${k}`, actor: "regex", content: `Regex-derin '${k}': ${d}.` }));
}
const BASVURU_TR: [string, string][] = [
  ["hitap", "kuruma: 'Sayın Yetkili' / birime: '... Başkanlığına' — büyük harf, virgülsüz satır"],
  ["arz-rica", "üst makama 'arz ederim', ast/eş düzeye 'rica ederim'; ikisi birden: 'arz ve rica ederim'"],
  ["konu-satiri", "Konu: tek satır özet — dilekçenin ilk bloğu"],
  ["ek-listesi", "EKLER: 1- ... 2- ... — metinde '(Ek-1)' atıfla"],
  ["tarih-format", "resmi yazıda GG.AA.YYYY; uluslararası başvuruda ISO YYYY-AA-GG"],
  ["kimlik-blok", "ad-soyad, TC/başvuru-no, iletişim — sağ üst ya da imza altı"],
  ["proje-ozeti", "TÜBİTAK tarzı: amaç→yöntem→beklenen-etki 3 cümle; jargonsuz ilk cümle"],
  ["butce-gerekce", "her kalem: ne + neden-gerekli + nasıl-hesaplandı"],
  ["taahhut", "'... beyan ederim' kalıbı; yanlış-beyan sonuçları bilinerek"],
  ["takip-yazisi", "'... tarihli başvurumun durumu hakkında bilgi rica ederim' — kısa, referans-numaralı"],
];
export function buildBasvuruTrRecords(): TeachRecord[] {
  return BASVURU_TR.map(([k, d]) => ({ id: `teach:basvuru:${k}`, actor: "basvuru-tr", content: `Resmi TR yazışma '${k}': ${d}.` }));
}


// ——— Dalga-8: ollamas-E2E kritik setler ———
const OLLAMAS_ERRORS: [string, string][] = [
  ["embedder-busy-503", "recall/ask 503 'embedder busy' → ollama embed kuyruğu dolu; write-behind satırı yine yazar, backfill gece tamamlar — VERİ KAYBI YOK, bekle-tekrar-dene"],
  ["database-is-locked", "sqlite 'database is locked' → WAL + busy_timeout=5000 kök çözüm (brain.db böyle); eşzamanlı yazar varsa normal, retry"],
  ["index-lock", "git 'index.lock exists' → paylaşımlı checkout'ta eşzamanlı git; bekle-retry, lock dosyasını KÖRLEMESİNE SİLME"],
  ["gate-transient-red", "pre-commit gate RED ama tam suite yeşil → paralel-yük flaky'si; kırmızı testi İZOLE koş, geçiyorsa commit'i retry (GATE_SKIP asla)"],
  ["eaddrinuse", "EADDRINUSE port dolu → lsof -i :PORT ile sahibi bul; ollamas 3000, ollama 11434"],
  ["vec0-load-sart", "düz DatabaseSync vec0 tablolarını OKUYAMAZ — sqlite-vec load ŞART yoksa sessiz 0 satır (S25 kökü)"],
  ["max-pending-requests", "ollama 'maximum pending requests exceeded' → kuyruk tavan; istek azalt/bekle, brain degrade-yolları devrede"],
  ["spread-undefined-ezer", "TS spread'de sonradan yazılan explicit-undefined property önceki değeri EZER → opsiyonel-pin: ...(x?{x}:{}) (ns-clobber kökü)"],
  ["vite-hot-reload-garantisiz", "dinamik-import her zaman hot-reload olmaz → 'yansıdı' varsayma, canlı kanıtla; kesinlik restart"],
  ["tcc-log-yolu", "launchd servisi Desktop/Documents'a log yazamaz (TCC) → log'u ~/Library/Logs ya da /tmp'ye yaz"],
  ["fts-match-sanitize", "FTS5 MATCH ham sorguyu parse eder → ftsQuery alnum-token'lar + stopword-filtre; ham kullanıcı-girdisi MATCH'e verilmez"],
  ["makefile-literal-n", "Makefile'a programatik satır eklerken literal-\\n tuzağı → printf/heredoc kullan, cat -A ile doğrula"],
  ["whatis-yavas", "macOS whatis terim-başı ~0.6s man-db taraması → çok-terim tek çağrı timeout patlatır; 8'li paralel batch"],
  ["execsync-stdout-kayip", "execFileSync nonzero-exit'te stdout'u throw'a gömer → catch'te e.stdout kurtar"],
  ["tr-apostrof-string", "TS'te apostroflu TR metin tek-tırnak string'i kırar (API'lerin) → çift-tırnak + escape"],
  ["node-sqlite-bigint", "node:sqlite prepared-statement rowid parametresi BigInt ister → BigInt(rowid)"],
];
export function buildOllamasErrorRecords(): TeachRecord[] {
  return OLLAMAS_ERRORS.map(([k, d]) => ({ id: `teach:hata:${k}`, actor: "ollamas-errors", content: `ollamas hata-sözlüğü '${k}': ${d}.` }));
}
export function buildApiSurfaceRecords(serverTs: string): TeachRecord[] {
  const out: TeachRecord[] = []; const seen = new Set<string>();
  for (const m of serverTs.matchAll(/app\.(get|post|put|delete)\(\s*"(\/(?:api|v1|brain|org|mcp)[^"]*)"/g)) {
    const route = `${m[1].toUpperCase()} ${m[2]}`;
    if (seen.has(route)) continue; seen.add(route);
    out.push({ id: `teach:route:${m[1]}-${m[2].replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40)}`,
      actor: "ollamas-api", content: `ollamas API route: ${route}`,
      fact: { subject: "ollamas", predicate: "has_route", object: route.slice(0, 60) } });
  }
  return out.slice(0, 60);
}
export function buildEnvRecords(sources: string[]): TeachRecord[] {
  const names = new Set<string>();
  for (const src of sources) for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]{2,})/g)) names.add(m[1]);
  return [...names].filter((n) => /^(BRAIN|OLLAMAS|GPU|ECY|SEMANTIC|HIERARCHY)_/.test(n)).sort().slice(0, 60)
    .map((n) => ({ id: `teach:env:${n}`, actor: "ollamas-env",
      content: `ollamas env değişkeni ${n} — server kodunda okunan yapılandırma bayrağı (detay docs/BRAIN-INTEGRATION.md).`,
      fact: { subject: "ollamas", predicate: "has_env", object: n } }));
}


// ——— Dalga-9: canlı 50-servis kataloğu ———
export function buildServiceRecords(servicesSrc: string): TeachRecord[] {
  const out: TeachRecord[] = [];
  for (const m of servicesSrc.matchAll(/id:\s*"([\w-]+)",\s*kind:\s*"\w+",\s*role:\s*"([^"]+)"/g)) {
    out.push({ id: `teach:servis:${m[1]}`, actor: "brain-services",
      content: `Brain servisi '${m[1]}': ${m[2].slice(0, 180)}.`,
      fact: { subject: "brain", predicate: "has_service", object: m[1] } });
  }
  return out.slice(0, 60);
}


// ——— Dalga-10: kod-temelli setler — brain kendi kaynak tabanını öğrenir ———
export function headComment(src: string): string {
  const lines: string[] = [];
  for (const l of src.split("\n")) {
    const t = l.trim();
    if (t.startsWith("//")) { lines.push(t.replace(/^\/\/\s?/, "")); if (lines.length >= 4) break; }
    else if (t === "" && lines.length === 0) continue;
    else break;
  }
  return lines.join(" ").slice(0, 300);
}
export function buildCodeMapRecords(files: [string, string][]): TeachRecord[] {
  const out: TeachRecord[] = [];
  for (const [path, src] of files) {
    const head = headComment(src);
    if (!head) continue;
    const slug = path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
    out.push({ id: `teach:kod:${slug}`, actor: "codebase",
      content: `ollamas modülü ${path}: ${head}`,
      fact: { subject: "ollamas", predicate: "has_module", object: path.slice(0, 60) } });
  }
  return out.slice(0, 90);
}
export function buildExportRecords(files: [string, string][]): TeachRecord[] {
  const out: TeachRecord[] = [];
  for (const [path, src] of files) {
    const sigs: string[] = [];
    for (const m of src.matchAll(/^export (?:async )?(?:function|const) ([\w$]+)\s*(?:=\s*)?\(([^)\n]{0,80})/gm)) {
      sigs.push(`${m[1]}(${(m[2] || "").split(",").map((a) => a.split(":")[0].trim()).filter(Boolean).join(", ")})`);
      if (sigs.length >= 10) break;
    }
    if (!sigs.length) continue;
    const slug = path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
    out.push({ id: `teach:export:${slug}`, actor: "codebase",
      content: `${path} dışa açtığı fonksiyonlar: ${sigs.join(" · ")}` });
  }
  return out.slice(0, 50);
}
const CODE_PATTERNS: [string, string][] = [
  ["choke-point", "tüm tool'lar TEK registry'den, tüm brain-yazımları rememberOne'dan geçer — ikinci dispatch-yolu icat etme"],
  ["guarded-alter", "şema evrimi: try { ALTER TABLE ... ADD COLUMN } catch {} — mevcut db yerinde migrate olur, sıfırdan kurulum da aynı koddan"],
  ["injectable-deps", "IO'yu parametre yap (embed, generate, now, llmActive) — test deterministik, prod default gerçek implementasyon"],
  ["degrade-alive", "alt-bileşen çökünce BÜTÜN cevabı öldürme: bounded dene, degraded-işaretli kısmi sonuç dön (overview health, recall lexical, 503-busy)"],
  ["write-behind", "pahalı yan-işlem (embed) yazımı bloklamaz: satır hemen, vektör pending_embed=1 ile sonra (backfill)"],
  ["best-effort-bracket", "kritik-olmayan iş try/catch'le sarılır ve ASLA ana işlemi bozmaz (audit-ledger, bus-emit, capture-hook)"],
  ["module-top-level-route", "in-process test edilecek route'lar initializeServer İÇİNE değil modül seviyesine yazılır (org/brain paneli dersi)"],
  ["pure-thin-io", "parse/karar/format saf fonksiyon (fixture-testli); dosya/ağ/exec ince kabukta"],
  ["stable-id-idempotent", "programatik yazımlar stable-id upsert (teach:*, universe:*) — tekrar koşmak çoğaltmaz, tazeler"],
  ["evidence-commit", "'çalışıyor' iddiası commit-mesajına kanıtla girer: canlı çıktı, sayı, önce/sonra"],
  ["ns-jail", "tenant/kaynak izolasyonu namespace ile; cross-ns yalnız çift-kilitli admin yüzeyinde"],
  ["bounded-race", "dış-bağımlı await'ler Promise.race + timeout + unref — hiçbir istek sonsuza asılamaz"],
];
export function buildCodePatternRecords(): TeachRecord[] {
  return CODE_PATTERNS.map(([k, d]) => ({ id: `teach:desen:${k}`, actor: "code-patterns", content: `ollamas kod-deseni '${k}': ${d}.` }));
}


// ——— Dalga-11: tool-katalog + test-harita + frontend-harita (hepsi canlı parse) ———
export function buildToolCatalogRecords(registrySrc: string): TeachRecord[] {
  const out: TeachRecord[] = [];
  for (const m of registrySrc.matchAll(/([\w]+):\s*\{\s*tier:\s*"(\w+)",\s*schema:\s*fn\(\s*"([\w]+)",\s*"([^"]{10,300}?)"/g)) {
    out.push({ id: `teach:tool:${m[3]}`, actor: "tool-registry",
      content: `ollamas tool '${m[3]}' (${m[2]}): ${m[4].slice(0, 220)}`,
      fact: { subject: "ollamas", predicate: "has_tool", object: `${m[3]} (${m[2]})` } });
  }
  return out.slice(0, 60);
}
export function buildTestMapRecords(files: [string, string][]): TeachRecord[] {
  const out: TeachRecord[] = [];
  for (const [path, src] of files) {
    const names = [...src.matchAll(/describe\(\s*"([^"]{5,90})"/g)].map((m) => m[1]).slice(0, 8);
    if (!names.length) continue;
    const slug = path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 48);
    out.push({ id: `teach:testmap:${slug}`, actor: "tests",
      content: `Test dosyası ${path} şu davranışları sözleşmeler: ${names.join(" · ").slice(0, 400)}` });
  }
  return out.slice(0, 50);
}
export function buildFrontendMapRecords(files: [string, string][]): TeachRecord[] {
  const out: TeachRecord[] = [];
  for (const [path, src] of files) {
    const head = headComment(src) || (src.split("\n").find((l) => l.trim() && !l.startsWith("import")) || "").trim().slice(0, 120);
    if (!head) continue;
    const slug = path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 48);
    out.push({ id: `teach:fe:${slug}`, actor: "frontend",
      content: `Frontend modülü ${path}: ${head.slice(0, 250)}`,
      fact: { subject: "ollamas", predicate: "has_frontend_module", object: path.slice(0, 60) } });
  }
  return out.slice(0, 40);
}


// ——— Dalga-12: import-graph (etki analizi) + tip/bağımlılık katalogları ———

/** Pure: [path, src][] → who-imports-whom. Relative specifiers only (own code);
 *  node_modules and node: builtins are out of scope for impact analysis. */
export function buildImportGraph(files: [string, string][]): { importers: Map<string, Set<string>>; imports: Map<string, Set<string>> } {
  const importers = new Map<string, Set<string>>();
  const imports = new Map<string, Set<string>>();
  const norm = (fromFile: string, spec: string): string => {
    const dir = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/")) : ".";
    const parts = `${dir}/${spec}`.split("/");
    const stack: string[] = [];
    for (const seg of parts) {
      if (seg === "." || seg === "") continue;
      if (seg === "..") stack.pop();
      else stack.push(seg);
    }
    const path = stack.join("/");
    return path.endsWith(".ts") || path.endsWith(".tsx") ? path : `${path}.ts`;
  };
  for (const [path, src] of files) {
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g)) {
      const target = norm(path, m[1]);
      if (!importers.has(target)) importers.set(target, new Set());
      importers.get(target)!.add(path);
      if (!imports.has(path)) imports.set(path, new Set());
      imports.get(path)!.add(target);
    }
  }
  return { importers, imports };
}

export function buildImpactRecords(files: [string, string][]): TeachRecord[] {
  const { importers } = buildImportGraph(files);
  const out: TeachRecord[] = [];
  for (const [target, who] of [...importers.entries()].sort((a, b) => b[1].size - a[1].size)) {
    const list = [...who].sort();
    const slug = target.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 48);
    out.push({ id: `teach:etki:${slug}`, actor: "impact",
      content: `Etki analizi — ${target} modülünü ${list.length} modül import eder: ${list.slice(0, 12).join(", ")}${list.length > 12 ? " …" : ""}. Bu dosyayı değiştirirsen bunlar etkilenir; testlerini birlikte koş.`,
      fact: { subject: target.slice(0, 60), predicate: "imported_by_count", object: String(list.length) } });
  }
  return out.slice(0, 70);
}

export function buildTypeCatalogRecords(files: [string, string][]): TeachRecord[] {
  const out: TeachRecord[] = [];
  for (const [path, src] of files) {
    for (const m of src.matchAll(/export (interface|type) (\w+)[^{]*\{([^}]{0,600})/g)) {
      const fields = [...m[3].matchAll(/^\s*(\w+)\??:/gm)].map((f) => f[1]).slice(0, 10);
      if (!fields.length) continue;
      out.push({ id: `teach:tip:${m[2]}`, actor: "types",
        content: `Tip sözleşmesi ${m[2]} (${path}): alanlar ${fields.join(", ")}.`,
        fact: { subject: "ollamas", predicate: "has_type", object: m[2] } });
    }
  }
  return out.slice(0, 45);
}

const DEP_DESC: Record<string, string> = {
  "sqlite-vec": "SQLite vektör KNN eklentisi — brain'in semantik arama motoru (vec0 tabloları)",
  express: "HTTP sunucu çatısı — tüm /api route'ları",
  vite: "frontend build + dev-server (module-runner hot-reload)",
  vitest: "test koşucusu — 3000+ testin motoru",
  typescript: "tip sistemi + tsc --noEmit kalite kapısı",
  react: "frontend bileşen kütüphanesi",
  zod: "runtime şema doğrulama",
  "@modelcontextprotocol/sdk": "MCP gateway/broker protokolü",
  "@opentelemetry/api": "trace/metric telemetri sözleşmesi",
  playwright: "e2e tarayıcı testleri",
  pino: "yapılandırılmış log",
  helmet: "HTTP güvenlik başlıkları",
  "@google/genai": "Gemini provider SDK",
  "@huggingface/transformers": "yerel model/embedding çalıştırma",
};
export function buildDependencyRecords(pkgJson: string): TeachRecord[] {
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
  try { pkg = JSON.parse(pkgJson); } catch { return []; }
  const out: TeachRecord[] = [];
  const add = (name: string, version: string, kind: string) => {
    const desc = DEP_DESC[name] || "ollamas bağımlılığı";
    out.push({ id: `teach:dep:${name.replace(/[^a-z0-9]+/gi, "-")}`, actor: "dependencies",
      content: `ollamas ${kind} bağımlılığı '${name}' (${version}): ${desc}.`,
      fact: { subject: "ollamas", predicate: "depends_on", object: `${name} (${kind})` } });
  };
  for (const [n, v] of Object.entries(pkg.dependencies || {})) if (DEP_DESC[n] || out.length < 40) add(n, v, "runtime");
  for (const [n, v] of Object.entries(pkg.devDependencies || {})) if (DEP_DESC[n]) add(n, v, "dev");
  return out.slice(0, 45);
}

async function main() {
  const pyJson = execFileSync("python3", ["-c", `
import json, keyword, builtins, importlib
b = []
for n in dir(builtins):
    if n.startswith('_'): continue
    d = getattr(builtins, n).__doc__ or ''
    b.append([n, d.split('\\n')[0]])
mods = []
for m in ${JSON.stringify(PY_MODULES)}:
    try:
        mod = importlib.import_module(m)
        d = (mod.__doc__ or '').strip().split('\\n')[0]
        mods.append([m, d])
    except Exception: pass
print(json.dumps({'keywords': keyword.kwlist, 'builtins': b, 'modules': mods}))
`], { timeout: 20000 }).toString();
  const py = buildPythonRecords(JSON.parse(pyJson));
  // whatis scans man-db per term (~0.6s each) — one 76-term call blows any timeout.
  // Parallel 8-term batches finish in seconds; a failing batch still yields stdout.
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const runB = promisify(execFile);
  const batches: string[][] = [];
  for (let i = 0; i < MACOS_ALLOWLIST.length; i += 8) batches.push(MACOS_ALLOWLIST.slice(i, i + 8));
  const chunks = await Promise.all(
    batches.map((b) =>
      runB("bash", ["-c", `whatis ${b.join(" ")} 2>/dev/null`], { timeout: 30000 })
        .then((r) => r.stdout)
        .catch((e: any) => e?.stdout?.toString?.() || ""),
    ),
  );
  const whatis = chunks.join("\n");
  const mac = buildMacosRecords(whatis, MACOS_ALLOWLIST);
  // Kritik-öncelik sırası (1→6): node/ts, git, sqlite, shell, http, launchd.
  let nodeMods: string[] = [];
  try { nodeMods = JSON.parse(execFileSync("node", ["-p", "JSON.stringify(require('module').builtinModules)"], { timeout: 10000 }).toString()); } catch { /* node absent? impossible here */ }
  let gitHelp = "";
  try { gitHelp = execFileSync("git", ["help", "-a"], { timeout: 10000 }).toString(); } catch { /* git missing → curated only */ }
  let mkText = "", intMd = "";
  try { mkText = (await import("node:fs")).readFileSync("Makefile", "utf8"); } catch { /* cwd drift */ }
  try { intMd = (await import("node:fs")).readFileSync("docs/BRAIN-INTEGRATION.md", "utf8"); } catch { /* absent */ }
  let serverSrc = "";
  const fsMod = await import("node:fs");
  try { serverSrc = fsMod.readFileSync("server.ts", "utf8"); } catch { /* cwd drift */ }
  let envSources: string[] = [serverSrc];
  try {
    for (const f of fsMod.readdirSync("server").filter((x: string) => x.endsWith(".ts")).slice(0, 60))
      envSources.push(fsMod.readFileSync(`server/${f}`, "utf8"));
  } catch { /* partial is fine */ }
  let servicesSrc = "";
  try { servicesSrc = fsMod.readFileSync("server/brain-services.ts", "utf8"); } catch { /* absent */ }
  const codeFiles: [string, string][] = [];
  try {
    for (const f of fsMod.readdirSync("server").filter((x: string) => x.endsWith(".ts") && !x.includes(".test.")).slice(0, 80))
      codeFiles.push([`server/${f}`, fsMod.readFileSync(`server/${f}`, "utf8")]);
    for (const f of fsMod.readdirSync("scripts").filter((x: string) => x.startsWith("brain-") && x.endsWith(".ts")).slice(0, 20))
      codeFiles.push([`scripts/${f}`, fsMod.readFileSync(`scripts/${f}`, "utf8")]);
  } catch { /* partial fine */ }
  const brainFiles = codeFiles.filter(([p2]) => /brain|gpu|embed|rerank/.test(p2));
  let registrySrc = "";
  try { registrySrc = fsMod.readFileSync("server/tool-registry.ts", "utf8"); } catch { /* absent */ }
  const testFiles: [string, string][] = [];
  try {
    for (const f of fsMod.readdirSync("tests").filter((x: string) => x.endsWith(".test.ts")).slice(0, 60))
      testFiles.push([`tests/${f}`, fsMod.readFileSync(`tests/${f}`, "utf8")]);
  } catch { /* fine */ }
  const feFiles: [string, string][] = [];
  const walkFe = (dir: string, depth: number) => {
    if (depth > 2 || feFiles.length >= 40) return;
    try {
      for (const e of fsMod.readdirSync(dir, { withFileTypes: true })) {
        if (feFiles.length >= 40) break;
        const full = `${dir}/${e.name}`;
        if (e.isDirectory()) walkFe(full, depth + 1);
        else if (/\.(tsx|ts)$/.test(e.name) && !e.name.includes(".test."))
          feFiles.push([full, fsMod.readFileSync(full, "utf8")]);
      }
    } catch { /* fine */ }
  };
  walkFe("src", 0);
  let pkgJson = "";
  try { pkgJson = fsMod.readFileSync("package.json", "utf8"); } catch { /* absent */ }
  const graphFiles: [string, string][] = [...codeFiles];
  if (serverSrc) graphFiles.push(["server.ts", serverSrc]);
  const sets: [string, TeachRecord[]][] = [
    ["etki-analizi", buildImpactRecords(graphFiles)],
    ["tip-katalog", buildTypeCatalogRecords(codeFiles)],
    ["bagimlilik", buildDependencyRecords(pkgJson)],
    ["tool-katalog", buildToolCatalogRecords(registrySrc)],
    ["test-harita", buildTestMapRecords(testFiles)],
    ["frontend-harita", buildFrontendMapRecords(feFiles)],
    ["kod-harita", buildCodeMapRecords(codeFiles)],
    ["kod-export", buildExportRecords(brainFiles)],
    ["kod-desen", buildCodePatternRecords()],
    ["servis-katalog", buildServiceRecords(servicesSrc)],
    ["ollamas-hata", buildOllamasErrorRecords()],
    ["ollamas-api", buildApiSurfaceRecords(serverSrc)],
    ["ollamas-env", buildEnvRecords(envSources)],
    ["prompt-eng", buildPromptEngRecords()],
    ["vitest-test", buildVitestRecords()],
    ["regex-derin", buildRegexRecords()],
    ["basvuru-tr", buildBasvuruTrRecords()],
    ["css-tailwind", buildCssRecords()],
    ["ag-derin", buildNetDeepRecords()],
    ["editor-verim", buildEditorRecords()],
    ["en-yazisma", buildEnWritingRecords()],
    ["ecy-ekosistem", buildEcosystemRecords()],
    ["prog-temel", buildProgBasicsRecords()],
    ["bilgisayar-temel", buildComputerBasicsRecords()],
    ["internet-temel", buildInternetBasicsRecords()],
    ["veri-format", buildDataFormatRecords()],
    ["yazilim-pratik", buildSoftwarePracticeRecords()],
    ["mantik-matematik", buildLogicMathRecords()],
    ["ollamas-internal", buildOllamasRecords(mkText, intMd)],
    ["llm-ops", buildLlmOpsRecords()],
    ["react", buildReactRecords()],
    ["security", buildSecurityRecords()],
    ["docker", buildDockerRecords()],
    ["glossary", buildGlossaryRecords()],
    ["node-ts", buildNodeRecords(nodeMods)],
    ["git", buildGitRecords(gitHelp)],
    ["sqlite", buildSqliteRecords()],
    ["shell", buildShellRecords()],
    ["http", buildHttpRecords()],
    ["launchd", buildLaunchdRecords()],
  ];
  let mem = 0, facts = 0;
  for (const [name, recs] of sets) console.log(JSON.stringify({ event: "brain.teach.set", set: name, records: recs.length }));
  const all = [...py, ...mac, ...sets.flatMap(([, r]) => r)];
  for (const r of all) {
    await brainRemember({ id: r.id, tier: "procedural", content: r.content, source: "teach-datasets", ns: "knowledge", actor: r.actor, confidence: 0.95 });
    mem++;
    if (r.fact) {
      try { const f = await brainAssertFact({ ...r.fact, ns: "default" }); if (f.changed) facts++; } catch { /* embedder queued — nightly */ }
    }
  }
  console.log(JSON.stringify({ event: "brain.teach", python: py.length, macos: mac.length, memories: mem, facts }));
}

if (process.argv[1]?.includes("brain-teach-datasets")) void main();
