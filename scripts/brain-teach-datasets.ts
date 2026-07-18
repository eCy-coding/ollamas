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
  const sets: [string, TeachRecord[]][] = [
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
    await brainRemember({ id: r.id, tier: "procedural", content: r.content, source: "teach-datasets", ns: "knowledge", actor: r.actor });
    mem++;
    if (r.fact) {
      try { const f = await brainAssertFact({ ...r.fact, ns: "default" }); if (f.changed) facts++; } catch { /* embedder queued — nightly */ }
    }
  }
  console.log(JSON.stringify({ event: "brain.teach", python: py.length, macos: mac.length, memories: mem, facts }));
}

if (process.argv[1]?.includes("brain-teach-datasets")) void main();
