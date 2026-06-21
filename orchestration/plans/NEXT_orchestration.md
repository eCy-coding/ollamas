# NEXT — orchestration lane → vO3 (Per lane sıradaki versiyon planner otomasyonu (trigger proto)

> plan-next.ts üretti (DETERMİNİSTİK taslak, LLM yok). İnsan/lane-sekmesi rafine eder.
> Kaynaklar: ROADMAP_ORCHESTRATION.md, errors_registry.json
> Mevcut: **vO2 (Live discovery dev server cwd mapping (port 3000 collision ç)** → Hedef: **vO3 (Per lane sıradaki versiyon planner otomasyonu (trigger proto)**

## Spec (niyet)
> Her versiyon bir **"Next precomputed"** handoff bloğu ile biter (zero-wait sıralama —
> lane ROADMAP'lerinden adopt edilen desen). Tetik: **"sıradaki versiyonu planla"**.
> Branch ≡ versiyon (drift-guard, ERR-SCR-001 dersi): `feat/orchestration-vN`.

| Versiyon | Durum | Kapsam |
|----------|-------|--------|
| **vO1** | ✅ DONE | Bootstrap: master prompt + roadmap + errors_registry + seyir + adoption matris + read-only status.ts |
| **vO2** | ✅ DONE | Live discovery — dev-server cwd-mapping (port-3000 collision çözüldü) + tmux-first/iTerm2/Terminal.app sekme keşfi + busy/idle sinyali + **§3.1 aktif koordinasyon** (nudge/notify, allowlist+dry-run) |
| vO3 | planned | Per-lane sıradaki-versiyon planner otomasyonu (trigger protokolü §4 kodlanır) |
| vO4 | planned | OSS adoption tracker + lisans-disiplini gate |
| vO5 | planned | Cross-lane bağımlılık grafiği (frontend↔backend API gap, scripts↔register-seam) |
| vO6 | planned | Benchmark agregasyon (MacBook + iOS tok/s; MLX/Rapid-MLX bench adopt) |
| vO7 | planned | Drift-guard otomasyon (branch≡roadmap, choke-point bütünlüğü) |
| vO8 | planned | Quality-gate roll-up (tüm lane tsc/lint/test tek matriste) |
| vO9 | planned | Heartbeat/notification (idle-lane + takılı-tab tespiti) |
| vO10 | planned | Self-review + completeness critic (eksik koordinasyon ne?) |

---

## Plan / Phase + Tasks
- [ ] (ROADMAP next-bloğunda todo bulunamadı — niyet bloğundan türet)

## Don't-repeat (errors_registry)
- ERR-ORCH-001: Çalışan süreci ASLA yalnız porta göre lane'e atama; daima process cwd çöz (lsof -p -d cwd) ve worktree path-prefix ile eşle.
- ERR-ORCH-002: Blok yorum içinde asla `*/` literal dizisi yazma (glob/regex örneklerinde bile); kelimeyle ifade et.
- ERR-ORCH-003: AppleScript'te sekme/satır ayracı için ASLA `tab` sabitine veya string-literal `\t`'ye güvenme; `(ASCII character 9)`'u tell-bloğu DIŞINDA tanımla. AppleScript çıktı parser'larını JS-`\t` değil GERÇEK osascript çıktısıyla test et.
- ERR-ORCH-004: İzole worktree'de bile her green parça koşusundan SONRA hemen commit et (uzun süre untracked bırakma); oturum-başı + commit-öncesi `git branch --show-current` doğrula; eşzamanlı lane'ler ayrı worktree+branch kullanmalı, asla aynı worktree'de paralel checkout.

## Optimal Prompt (lane sekmesine yapıştır)
```
Sen orchestration lane sekmesisin (branch feat/orchestration-v3).

**[Context]** Sözleşmen: /Users/emrecnyngmail.com/Desktop/ollamas-orchestration-wt/orchestration/ORCHESTRATION_AGENTS.md. Önce onu + SEYIR + errors_registry oku. Mevcut: vO2 (Live discovery dev server cwd mapping (port 3000 collision ç) DONE. Hedef: vO3 (Per lane sıradaki versiyon planner otomasyonu (trigger proto).
**[Task]** vO3 (Per lane sıradaki versiyon planner otomasyonu (trigger proto) versiyonunu kesintisiz, eksiksiz kodla. Niyet:
  > > Her versiyon bir **"Next precomputed"** handoff bloğu ile biter (zero-wait sıralama —
  > > lane ROADMAP'lerinden adopt edilen desen). Tetik: **"sıradaki versiyonu planla"**.
  > > Branch ≡ versiyon (drift-guard, ERR-SCR-001 dersi): `feat/orchestration-vN`.
  > 
  > | Versiyon | Durum | Kapsam |
  > |----------|-------|--------|
  > | **vO1** | ✅ DONE | Bootstrap: master prompt + roadmap + errors_registry + seyir + adoption matris + read-only status.ts |
  > | **vO2** | ✅ DONE | Live discovery — dev-server cwd-mapping (port-3000 collision çözüldü) + tmux-first/iTerm2/Terminal.app sekme keşfi + busy/idle sinyali + **§3.1 aktif koordinasyon** (nudge/notify, allowlist+dry-run) |
  > | vO3 | planned | Per-lane sıradaki-versiyon planner otomasyonu (trigger protokolü §4 kodlanır) |
  > | vO4 | planned | OSS adoption tracker + lisans-disiplini gate |
  > | vO5 | planned | Cross-lane bağımlılık grafiği (frontend↔backend API gap, scripts↔register-seam) |
  > | vO6 | planned | Benchmark agregasyon (MacBook + iOS tok/s; MLX/Rapid-MLX bench adopt) |
  > | vO7 | planned | Drift-guard otomasyon (branch≡roadmap, choke-point bütünlüğü) |
  > | vO8 | planned | Quality-gate roll-up (tüm lane tsc/lint/test tek matriste) |
  > | vO9 | planned | Heartbeat/notification (idle-lane + takılı-tab tespiti) |
  > | vO10 | planned | Self-review + completeness critic (eksik koordinasyon ne?) |
  > 
  > ---
**[Constraints]** Scope law'una uy (lane dışına çıkma). TDD: test önce. Zero-dep tercih. Kalite kapısı: typecheck+lint+test taze koşu → conventional commit. No vibe-code: OSS adopt = MIT/Apache kopya+attribution. Şu hataları TEKRARLAMA:
  - ERR-ORCH-001: Çalışan süreci ASLA yalnız porta göre lane'e atama; daima process cwd çöz (lsof -p -d cwd) ve worktree path-prefix ile eşle.
  - ERR-ORCH-002: Blok yorum içinde asla `*/` literal dizisi yazma (glob/regex örneklerinde bile); kelimeyle ifade et.
  - ERR-ORCH-003: AppleScript'te sekme/satır ayracı için ASLA `tab` sabitine veya string-literal `\t`'ye güvenme; `(ASCII character 9)`'u tell-bloğu DIŞINDA tanımla. AppleScript çıktı parser'larını JS-`\t` değil GERÇEK osascript çıktısıyla test et.
  - ERR-ORCH-004: İzole worktree'de bile her green parça koşusundan SONRA hemen commit et (uzun süre untracked bırakma); oturum-başı + commit-öncesi `git branch --show-current` doğrula; eşzamanlı lane'ler ayrı worktree+branch kullanmalı, asla aynı worktree'de paralel checkout.
**[Format]** Sıra: READ → PLAN(todo+phase) → TDD → CODE → GATE → LOG(SEYIR+errors) → COMMIT(istenirse).
**[Examples]** Önceki versiyon vO2 (Live discovery dev server cwd mapping (port 3000 collision ç) kanıt deseni: testler yeşil + SEYIR girdisi + errors_registry güncel.
```

---
_Bu sekme (orchestration) lane kodunu yazmaz (§3). Taslak = öneri; yürütme lane sekmesinde._
