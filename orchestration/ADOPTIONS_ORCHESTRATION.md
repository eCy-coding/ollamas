# ADOPTIONS_ORCHESTRATION.md — OSS Adoption Matrisi

> En yıldızlı, güvenilir, **tamamlanmış**, macOS'ta çalışan GitHub repoları → ollamas
> lane'lerine map. **Yeni kod üretme yok** (vibe-coding yasak): bu matris fikir/desen
> kataloğudur. Kod ancak ilgili lane'in sekmesi kendi lisans disiplini altında çeker.
>
> **Lisans disiplini:** MIT/Apache/BSD/ISC → kod kopyala + attribution yorumu. GPL → yalnız
> fikir/ref (kod kopyalama). Lisanssız → yalnız fikir. (RISK-ORCH-005)

---

## Ranked Matris

| # | Repo | ⭐ | Lisans | Hedef Lane | Ne adopt edilir |
|---|------|-----|--------|-----------|-----------------|
| 1 | modelcontextprotocol/servers | 87K | Apache/MIT | backend/MCP, integrations | Gateway + tool-calling konvansiyonları, multi-server orkestrasyon şablonu |
| 2 | oven-sh/bun | 93.3K | MIT | cli | Hızlı TS runtime / macOS paketleme (yalnız değerlendir) |
| 3 | microsoft/autogen | 59.1K | MIT | orchestration | Supervisor-worker koordinasyon, multi-process state deseni (fikir) |
| 4 | crewAIInc/crewAI | 53.9K | MIT | orchestration | Rol-bazlı task delegasyon DSL'i, görev kompozisyonu (fikir) |
| 5 | tmux/tmux | 46.7K | ISC | orchestration | Multi-pane session backbone; session-state read (fikir, ileri vO) |
| 6 | vllm-project/vllm | 40K | Apache | bench | tok/s ölçüm altyapısı, continuous batching memory deseni |
| 7 | langchain-ai/langgraph | 35.1K | MIT | orchestration | Workflow DAG + checkpoint/conditional routing (fikir) |
| 8 | PrefectHQ/fastmcp | 24.4K | Apache | backend/MCP | MCP server scaffolding pattern, hızlı gateway geliştirme |
| 9 | screenpipe/screenpipe | 19K | MIT | backend/MCP | MCP server ref impl, LLM context injection deseni |
| 10 | gnachman/iTerm2 (-CC, AppleScript) | 17K | **GPL-2.0** | orchestration | Tab otomasyon / canlı sekme sorgu — **ref-only**, kod kopyalama |
| 11 | ml-explore/mlx-lm | 6K | MIT | bench | Apple Silicon tok/s baseline + quantization araçları |
| 12 | waybarrios/vllm-mlx | — | Apache | bench/iOS | MLX OpenAI/Anthropic-uyumlu server, MCP tool-calling Apple Silicon |
| 13 | SharpAI/SwiftLM | — | MIT | bench/iOS | Native MLX Swift LLM server, iOS entegrasyon + KV compression deseni |
| 14 | raullenchai/Rapid-MLX | ~1K | Apache | bench | 4.2x Ollama Apple Silicon, prompt-cache deseni (261 tok/s ref) |
| 15 | sverrirsig/claude-control | yeni | (teyit) | orchestration | **vO9 EN YÜKSEK EŞLEŞME** — macOS dashboard çoklu Claude/terminal session + tmux + worktree; process-tree ile tab→session keşfi, "focus" tab-switch. tab↔lane eşleme (fikir, lisans teyit) |
| 16 | fboender/multi-git-status | 1.1K | GPL-3.0 | orchestration | Çoklu-repo dirty/untracked/unpushed concurrent scan (macOS). collect.ts cross-check — **ref-only** (GPL) |
| 17 | andreygrechin/gitree | yeni | MIT | orchestration | Recursive git tree + inline status (branch+ahead/behind), concurrent scan, macOS. collect tarama deseni |
| 18 | jhuckaby/performa | ~300 | MIT | orchestration | Multi-server web UI + canlı metrik history. cockpit.html metrik-history + dashboard layout (SVG, kütüphane yok) |
| 19 | borisyankov/react-sparklines | 2.8K | MIT | orchestration | Sparkline algoritması → vanilla SVG'ye port (cockpit.html cpu history), React import YOK |
| 20 | otto-de/gitactionboard | ~150 | MIT | orchestration | **vO8 quality-gate roll-up** yeşil/kırmızı CI matris dashboard UI deseni |
| 21 | flavio87/tap-to-tmux | yeni | (teyit) | orchestration | **vO9 iOS push** — agent attention → phone notification (idle/takılı-tab uyarısı) |

**Özet:** 19/21 permissive (MIT/Apache/ISC). 2 flag: iTerm2 GPL-2.0 + multi-git-status GPL-3.0 → ref-only;
claude-control/tap-to-tmux lisans teyidi gerekli. Tamamı aktif bakımlı (2025-2026). çoğu macOS-native.
**vO3 cockpit e2e-search:** 15-21 cockpit/dashboard/multi-repo monitoring repoları (GitHub top-star, MacOS-uyumlu).

---

## Lane Başına Önerilen İlk Hamleler (lane sekmesi yürütür)

- **bench (`feat/v1.8-bench`):** Rapid-MLX + mlx-lm tok/s baseline'ını ollamas bench'e
  referans al; Ollama vs MLX karşılaştırması. iOS yolu için SwiftLM/vllm-mlx tool-calling.
- **backend/MCP + integrations:** fastmcp scaffolding + modelcontextprotocol/servers
  konvansiyonlarını choke-point (`ToolRegistry.execute`) ile uyumlu doğrula.
- **cli:** bun değerlendirmesi (zero-dep TS hedefini bozmadan, yalnız paketleme/hız).
- **orchestration (bu lane, ileri vO):** tmux session-state + iTerm2 AppleScript (ref-only)
  ile canlı tab discovery; CrewAI/LangGraph delegasyon fikri planner otomasyonuna.

> Her satır için karar T0 Emre + ilgili lane sekmesi. Bu sekme yalnız önerir + prompt üretir.

---

## vO2 Araştırma — Terminal/Process Keşif (2026-06-20)

E2E GitHub search: macOS terminal sekme + çalışan process keşfi. Karar: **native-first,
zero-dep** (no vibe-code, dep eklenmedi).

| # | Repo / teknik | ⭐ | Lisans | Karar | Ne |
|---|---|-----|--------|-------|-----|
| 1 | native `lsof -nP -iTCP -sTCP:LISTEN` + `lsof -p -d cwd -Fn` | — | system | **ADOPT** | port→pid→cwd; lane'i cwd ile ata (ERR-ORCH-001 fix) |
| 2 | native `osascript` (Terminal.app AppleScript) | — | system | **ADOPT** | sekme say/tty/busy; hibrit, izin-gated |
| 3 | native `ps -t <tty> -o pid=` + `git log %ct` | — | system | **ADOPT** | tab↔lane + idle-lane yaşı |
| 4 | steipete/macos-automator-mcp | 823 | MIT | ref-only | Terminal.app AppleScript tekniği referansı |
| 5 | sindresorhus/pid-port | 151 | MIT | eval-only | port↔pid lib — atlandı, native lsof yeter (zero-dep koru) |
| 6 | yibn2008/find-process | 140 | MIT | eval-only | alt port→proc — atlandı (zero-dep şartı) |
| 7 | raine/workmux | 1.6K | MIT | future-ref | git-worktree↔tmux window backbone (vO-ileri) |
| 8 | joshmedeski/sesh | 2.6K | MIT | future-ref | tmux session enum `sesh list -t` (vO-ileri) |
| 9 | primeline-ai/claude-tmux-orchestration | 33 | MIT | future-ref | dosya-tabanlı çok-lane koordinasyon deseni |
| 10 | native `tmux list-panes -a -F` + `send-keys` | 46.7K | ISC | **ADOPT** | tmux-first sekme keşfi (session/tty/cwd/cmd) + §3.1 koordinasyon dürtmesi |
| 11 | julienXX/terminal-notifier | ~10K | MIT | **ADOPT** | §3.1 `notify` — idle/stuck lane macOS bildirimi (varsa; yoksa stdout) |
| 12 | iTerm2 `is processing` / Terminal `busy` (AppleScript property) | 17K | native | **ADOPT** | sekme busy/idle ayrımı; **app'in scripting property'si — GPL kaynak DEĞİL** (vO4 gate'in ilk catch'i: lisans hücresi "GPL→native API" idi → "native" düzeltildi; ERR-ORCH-005) |
| 13 | OSC 133 semantic prompt marks | — | açık spec | future-ref | prompt-idle vs komut-çalışıyor kesin sinyali (vO9 heartbeat) |

**Sonuç:** vO2-merge ile **6 native/açık-kaynak teknik ADOPT** (0 dep): lsof-cwd, osascript (iTerm2+Terminal),
ps/git, tmux (ISC), terminal-notifier (MIT). 2 MIT lib eval-only (zero-dep korundu). workmux/sesh/tmux-orch
future-ref (vO-ileri). iTerm2 GPL **kod kopyalanmadı** — yalnız app scripting property'si + delimiter deseni özgün
yazıldı (RISK-ORCH-005 korundu). GPL kod yok. Lisans-ihlali yok.
