# EXEC-INVENTORY — child_process kullanım envanteri

> Üretildi: v1.24.1 µ1 · Kaynak: `grep -rn child_process/exec*/spawn* server/ orchestration/ cli/` (canlı repo, feat/key-autonomy).
> Verdict yasası: **execFile/execFileSync/spawn + argv-dizi = SAFE** (shell yok). **execSync / exec / spawn `shell:true` + string-interpolation = RISKY** (CWE-78). `db.exec(sql)` = SQLite, child_process DEĞİL → **FP**.

## Özet
- Taranan alan: `server/` · `orchestration/` · `cli/`
- Gerçek shell-risky (migrasyon gerekir): **3** hit.
- SAFE (argv-dizi execFile/spawn): geri kalan tümü.
- False-positive (`db.exec` SQLite / kod-yorumu / regex `.exec()`): işaretli.

## RISKY — migrasyon hedefleri (v1.24.1 µ2-µ3 + kapsam)
| # | file:line | API | input | verdict | aksiyon |
|---|---|---|---|---|---|
| R1 | server/orchestrator.ts:1 | `import { execSync }` | — (0 call-site) | **DEAD** | µ2 → import satırını SİL (refactor değil) |
| R2 | server/files.ts:143-144 | `execSync("git status --porcelain")` | statik string (interpolasyon yok) | **LIVE shell-string** | µ3 → top-level `execFileSync("git",["status","--porcelain"],{cwd})` |
| R3 | orchestration/bin/critic.ts:81 | `execSync(\`git cat-file -e ${h}^{commit}\`)` | `h` = `/[0-9a-f]{7,40}/` hex-validated, slice(50) | **INTERPOLATED** (düşük risk, hex-gate) | semgrep yakalar → `execFileSync("git",["cat-file","-e",\`${h}^{commit}\`])` |

## SAFE — argv-dizi (shell yok, aksiyon yok)
| file:line | API | not |
|---|---|---|
| server/commander.ts:1 | `execFile` | gated binary; eski `exec(\`${cmd}\`)` yorumda-tarihsel |
| server/ecysearch.ts:135 | `spawn(cmd, args)` | dizi-arg |
| server/integrations.ts:8 | `execFile` | — |
| server/revenue.ts:7 | `execFile` | — |
| server/contract.ts:100 | `spawn("osascript",["-e",script])` | dizi-arg (AppleScript, shell-değil) |
| server/github-actions.ts:84-87 | `execFile("git",[...])` | — |
| server/gemini-cli.ts:91,130 | `spawn(bin,args)` | dizi-arg |
| server/memory-stats.ts:39 | `execFileSync("/usr/bin/vm_stat")` | absolute-path |
| server/ecysearcher.ts:70 | `spawn("docker",[...])` | dizi-arg |
| server/terminal.ts:1 | `execFile` | önceden hardened (N-runtime) |
| server/key-doctor.ts:116 | `execFileSync("gh",[...])` | — |
| server/lib/keychain-scan.ts:35,54 | `execFileSync(SECURITY,...)` | — |
| server/mcp/catalog.ts:161 | `execFileSync(f,a)` | — |
| orchestration/bin/{autofix,fuse,panel,gemini-run,heartbeat,status,completion-scan,loop,tasklist,doctor,scan}.ts | `execFileSync(...)` | tümü argv-dizi (git/tsx/date/grep/sysctl/launchctl) |
| cli/index.ts:329-371 | `spawnSync(process.execPath/entry.path, argv)` | dizi-arg |
| cli/lib/{keychain,role,gemini}.ts · cli/commands/{gemini,update,keys,shortcuts,remote}.ts | `execFile*/spawn* argv` | tümü dizi-arg |

## FALSE-POSITIVE (child_process değil / kod-değil)
| file:line | ne | neden FP |
|---|---|---|
| server/rag.ts:85,90,117 · server/store/{migrations,index,db-adapter}.ts | `db.exec(sql)` | SQLite/pg `.exec` — child_process değil |
| server/commander.ts:8 | `// exec(\`${cmd}\`)` | yorum satırı (tarihsel, canlı-değil) |
| orchestration/bin/critic.ts:35 · loop.ts:43 · tasklist.ts:58-59 | `re.exec(...)` | RegExp.prototype.exec, child_process değil |

## Sonuç
- Enforcement-hedefi: R1 (sil) + R2 (execFileSync) + R3 (execFileSync). semgrep-rule (µ4) `server/ cli/ orchestration/` genelinde execSync/exec/spawn-shell'i yasaklar → R3'ü de yakalar.
- SAFE-satırlar semgrep-clean kalmalı (execFile/execFileSync/spawn-argv rule-tetiklemez).
