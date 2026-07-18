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
.PHONY: brain-show brain-hooks eval-brain brain-e2e brain-sync-registry brain-maintain brain-backup eval-brain-mrr brain-bootstrap brain-export brain-import

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
