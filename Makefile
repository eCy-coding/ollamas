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