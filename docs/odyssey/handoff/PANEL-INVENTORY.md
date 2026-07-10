# ODYSSEY panel envanteri — claude.ai/design projectId'leri (Chrome recon 2026-07-11)

> Emre'nin claude.ai/design "eCy Design System" ile ürettiği panel tasarımları. DesignSync `get_file`
> her projectId+path'e erişir → 0-manuel indirme. İndirme → `docs/odyssey/handoff/<slug>/design.html`.

| slug | Panel adı (Design) | projectId | ODYSSEY modül | son |
|---|---|---|---|---|
| shell | # Ollamas Workspace Shell | c4c119f1-47a2-4081-85f3-a11e845183bd | NAV/shell | en güncel |
| chat | AI Developer Workspace Chat | 76fc9f9e-952c-4990-9248-47571d27f184 | chat (pilot) | 5s |
| research | Deep Research Panel Design | d45daad6-54c0-4e27-9b2f-38cdab90909e | O2 research | 5s |
| documents | Documents panel design | c285f207-e766-4ff2-a48c-35f0546cc17d | O3 documents | 5s |
| email | Email triage panel design | f10bda16-45dd-4455-b45f-65066352f5d9 | O4 email | 10dk |
| notes-tasks | Notes & Tasks Panel Design | 7d3899ba-1fc3-4950-a59e-941ecfc57505 | O5 notes | 5s |
| calendar | # Calendar panel design | c9c942b2-3dfd-4584-90b0-00a607e5023f | O6 calendar | 5s |
| cookbook | # Hardware-Aware Model Cookbook | 606181dd-cac5-4b0e-b933-a2f041332dd0 | O7 cookbook | 4s |
| settings-2fa | # Settings & Security Panel | 6089cfce-b18a-4c93-b151-08b3ff492d2e | O8 security | 10dk |

## Shell varyantları (referans — kanonik = c4c119f1)
| Ollamas complete workspace | d07ea935-8bd8-4a5b-87c5-56f70a7887b0 | tam-workspace referans |
| Developer AI Workspace Shell | 4a7bf529-8717-49f6-b6d1-707904c9eeb0 | eski shell varyantı |

## ODYSSEY-DIŞI (indirme YOK): Radyonik Bilimi, eCyPro Hizmetler/404/Homepage/ToS/Çerez, Hayvan Çiftliği

**Kapsam:** 9 ODYSSEY modülü + shell + chat = TAM. Eksik tasarım YOK → "Claude Design'e yaptır" gereksiz.
**Tasarım formatı:** `<x-dc>` template (sc-for, {{binding}}) + `_ds/ecy-design-system-…/colors_and_type.css` import.
Golden Rule: REFERANS — ollamas React'e eCy-token-remap ile uyarlanır (ODYSSEY-TOKEN-MAP.md).

## İNDİRME DURUMU (2026-07-11, ana-thread DesignSync — subagent'larda tool YOK)
| slug | design.html | dosya-kaynağı | tema | not |
|---|---|---|---|---|
| chat | ✅ 178KB | AI Agent Console.dc.html | indigo-cockpit | 1090 satır, showcase+states |
| research | ✅ 128KB | DeepResearchPanel.dc.html | indigo | animasyonlu |
| documents | ✅ 213KB | Documents Panel.dc.html | indigo | en büyük |
| email | ✅ 66KB | MailPanel.dc.html (gerçek comp) | indigo | showcase 7-state: notconnected/syncing/error/filled/compose/light/mobile |
| settings-2fa | ✅ 83KB | Settings & Security.dc.html | eCy-cyan | 5-nav+2FA+sessions+Tweaks-4state |
| cookbook | ✅ 52KB | Cookbook.dc.html | eCy-cyan | global-nav-rail dahil |
| notes-tasks | ✅ 64KB | Panel.dc.html (gerçek comp) | indigo | data-theme dark/light |
| calendar | ⏳ impl-zamanı | CalendarFrame.dc.html (c9c942b2) | eCy-cyan | DCLogic tam-kod: CalDAV(writable)+google/ics(readonly), RRULE(D/W/M/Y), week/month/day, drawer, 4-state(filled/empty/syncing/error), dark/light. inline geldi→impl-anı ben çekerim |
| shell | ⏳ impl-zamanı | varyant (d07ea935/4a7bf529) | — | c4c119f1 boş; kanonik varyanttan |

**Tema gerçeği:** paneller İKİ tema ailesinde — indigo-cockpit (#6366f1, chat/research/docs/email/notes) + eCy-cyan (#00D4FF, settings/cookbook/calendar). ODYSSEY-TOKEN-MAP her ikisini `--ollamas-*`e köprüler; impl'de panel kendi temasını korur (token katmanı).
