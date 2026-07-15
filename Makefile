# ----------------------------------------------------------------------
#  Ollamas – Tek komutla tüm CI/CD adımları
# ----------------------------------------------------------------------
BINARY   := ollamas
VERSION  := $(shell git describe --tags --always --dirty)
BUILD    := $(shell date +%Y%m%d%H%M%S)

.PHONY: all build lint test e2e docker clean

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