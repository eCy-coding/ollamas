# Brewfile — ollamas' Homebrew + macOS dependency manifest (iter-10).
# Install all:   brew bundle          Verify:   brew bundle check          Report:   ollamas deps  (or /deps)
#
# Tiers are parsed from `# === TIER: <name> ===` headers by orchestration/bin/lib/deps.ts. Missing a `core`
# dep blocks; missing `dev`/lane-optional deps warn. node (mise) + git/curl (Xcode CLT) are external-managed
# → NOT listed here on purpose (managing them via brew would fight the real installer).

# === TIER: core ===
# Runtime the gateway/boot needs. (ollama is often installed natively from ollama.com; brew formula also works.)
brew "jq"
brew "ollama"

# === TIER: dev ===
# Quality gate: shell lint/format, static analysis, GitHub CLI (used by adoption research + PR flow).
brew "shellcheck"
brew "shfmt"
brew "semgrep"
brew "gh"

# === TIER: asset ===
# Icon/QR generation (assets/ + packaging): rsvg-convert (librsvg), magick (imagemagick), qrencode.
brew "librsvg"
brew "imagemagick"
brew "qrencode"

# === TIER: tunnel ===
# Sovereign remote/tunnel lane (MacBook↔iPhone, zero-account): mesh, proxy, cert, sync.
brew "tailscale"
# headscale (self-host coordination server) is NOT in core — needs a tap, so it's manual (not auto-managed):
#   brew tap juanfont/headscale && brew install headscale
brew "cloudflared"
brew "caddy"
brew "syncthing"
brew "wireguard-tools"
brew "mkcert"

# === TIER: packaging ===
# Release signing + native builds: minisign (signed releases), cmake (native binary build).
brew "minisign"
brew "cmake"

# === TIER: ai ===
# Python tooling for local model/eval scripts.
brew "uv"

# === TIER: cask ===
# Container runtime for the dockerized gateway (or use colima as a lighter alternative).
# (Homebrew renamed the `docker` cask → `docker-desktop`.)
cask "docker-desktop"
