# ----------------------------------------------------------------------
#  Ollamas – Tek komutla tüm CI/CD adımları
# ----------------------------------------------------------------------
BINARY   := ollamas
VERSION  := $(shell git describe --tags --always --dirty)
BUILD    := $(shell date +%Y%m%d%H%M%S)

.PHONY: all build lint test e2e docker clean eval-providers eval-rerank

all: build

build:
	go build -ldflags "-X main.version=$(VERSION) -X main.build=$(BUILD)" -o bin/$(BINARY) ./cmd

lint:
	./scripts/lint.sh

test:
	go test ./... -coverprofile=coverage.out

e2e:
	go test ./e2e/... -v -count=1

docker:
	docker build -t yourorg/$(BINARY):$(VERSION) .

clean:
	rm -rf bin/ coverage.out

## eval-providers: regenerate catalog-derived promptfoo matrix + run the $0 smoke eval (dev-time npx, no runtime dep)
eval-providers:
	@node scripts/gen-promptfoo-providers.mjs
	@npx -y promptfoo@latest eval -c eval/promptfooconfig.yaml --no-cache --no-progress-bar

## eval-rerank: B5 rerank uplift eval — MRR@5 with rerank ON vs OFF (downloads the cross-encoder
## model on first run; MANUAL/live only, never part of the vitest gate)
eval-rerank:
	@npx tsx scripts/eval-rerank.mjs
# ---------------- Brain (ported from integrate-wt, B-pattern 2026-07-18) ----------------
.PHONY: brain-show brain-hooks eval-brain brain-e2e brain-sync-registry brain-maintain brain-backup eval-brain-mrr brain-bootstrap brain-export brain-import brain-check brain-reembed brain-services brain-drill

## brain-show: live viewer — stats + memories + facts (+ Q="soru" semantic query)
brain-show:
	@npx tsx scripts/brain-show.ts $(Q)

## brain-hooks: OPT-IN git-capture hooks (chains the shared pre-commit gate; not auto-installed)
brain-hooks:
	@bash scripts/install-brain-hooks.sh

## eval-brain: distillation extraction contract on the $0 keyless floor (promptfoo)
eval-brain:
	@npx -y promptfoo@latest eval -c eval/brain-distill-config.yaml --no-cache --no-progress-bar

## brain-e2e: full live chain — $0 LLM → distill → sqlite-vec → semantic recall (exit 0/1)
brain-e2e:
	@npx tsx scripts/brain-e2e.ts

## brain-sync-registry: pull orchestration's proven THINK lessons into the brain (one-way read, idempotent)
brain-sync-registry:
	@npx tsx scripts/brain-sync-registry.ts

## brain-maintain: autonomous sleep-time maintenance — consolidate + sweep/prune + drift + backup (exit 3 on drift)
brain-maintain:
	@npx tsx scripts/brain-maintain.ts

## brain-backup: verified daily snapshot of brain.db (row-count checked, 7-day retention)
brain-backup:
	@npx tsx scripts/brain-backup.ts

## eval-brain-mrr: retrieval quality — MRR over the golden fixture, live local embedder (exit 1 under floor)
eval-brain-mrr:
	@npx tsx scripts/brain-eval-mrr.ts

## brain-bootstrap: 0-manual — install git-capture hooks + load the daily maintenance agent (idempotent)
brain-bootstrap:
	@bash scripts/brain-bootstrap.sh

## brain-export: portable vector-free JSON dump (S22) — stdout, or OUT=dump.json
brain-export:
	@npx tsx scripts/brain-export.ts

## brain-import: idempotent restore of a dump into BRAIN_DB_PATH (S22) — FILE=dump.json [DRY=1]
brain-import:
	@npx tsx scripts/brain-import.ts $(FILE) $(if $(DRY),--dry,)

## brain-check: consistency sentinel (S25) — report-only cross-table invariants (exit 0 always)
brain-check:
	@npx tsx scripts/brain-check.ts

## brain-reembed: drift remediation (S23) — verified backup, full vector rebuild, meta flip LAST [DRY=1]
brain-reembed:
	@npx tsx scripts/brain-reembed.ts $(if $(DRY),--dry,)

## brain-services: run every brain service selftest (S28 proof machine) [OFFLINE=1 skips :3000 probes]
brain-services:
	@npx tsx scripts/brain-services.ts $(if $(OFFLINE),--offline,)

## brain-drill: DR proof (S47) — dump the live brain, restore into a throwaway store, recall smoke
brain-drill:
	@npx tsx scripts/brain-restore-drill.ts

brain-sync-universe: ## Emre'nin proje evreni + repo yüzeyi -> brain (idempotent)
	@npx tsx scripts/brain-ingest-universe.ts

brain-teach: ## tum datasetleri brain'e ogret + ekosistem senkronu (idempotent)
	@npx tsx scripts/brain-teach-datasets.ts
	@npx tsx scripts/ecosystem-sync.ts

ecosystem-sync: ## brain+eCym+odysseus senkronu (yedekli, idempotent)
	@npx tsx scripts/ecosystem-sync.ts
brain-coherence: ## semantik-bag denetimi + guvenli karantina (apply)
	@npx tsx scripts/brain-coherence-audit.ts --apply
brain-code-audit: ## olu-kod + orphan modul denetimi (rapor-only)
	@npx tsx scripts/brain-code-audit.ts

brain-loop: ## ortak-brain ogrenme dongusu (tek tur, butceli)
	@npx tsx scripts/brain-loop.ts

disk-survey: ## SALT-OKUNUR disk raporu + kopya tespiti (hicbir sey silmez)
	@npx tsx scripts/disk-survey.ts

brain-gate-reset: ## cokmus MoE gate'i arsivle + sifirla [DRY=1]
	@npx tsx scripts/brain-gate-reset.ts $(if $(DRY),--dry,)

brain-capabilities: ## yetenek terfi defteri (sandbox->candidate->autonomous)
	@npx tsx scripts/brain-capabilities.ts $(ARGS)

brain-loop-health: ## loop olculen durum (yazim orani, kuru tur, atlama siniflari)
	@npx tsx scripts/brain-loop-health.ts $(ARGS)

brain-loop-install: ## sonsuz loop launchd agent yukle (Emre onayli)
	@cp scripts/com.ollamas.brain-loop.plist ~/Library/LaunchAgents/ && launchctl bootstrap gui/$$(id -u) ~/Library/LaunchAgents/com.ollamas.brain-loop.plist && echo 'brain-loop agent yuklendi (15dk periyot)'
