# Installing & packaging the `ollamas` CLI (v9)

Four ways to get `ollamas` on your PATH, smallest setup first.

## 1. From the repo (dev)

```sh
npm run build:cli          # esbuild → dist/cli/index.cjs (+ chmod +x)
npm link                   # symlink `ollamas` into your global bin
ollamas version            # 9.0.0
```

`npm unlink -g react-example` removes it. The bin is `dist/cli/index.cjs`
(single `#!/usr/bin/env node` shebang — E-001 fixed).

## 2. Shell completion

`ollamas completion <shell>` prints a static script that calls back the hidden,
side-effect-free `ollamas __complete` on every TAB.

```sh
# bash
ollamas completion bash >> ~/.bashrc          # or source it
# zsh  (into a dir on $fpath)
ollamas completion zsh > "${fpath[1]}/_ollamas"
# fish
ollamas completion fish > ~/.config/fish/completions/ollamas.fish
```

Completes top-level commands, sub-actions (`mcp …`, `saas …`, `config …`,
`agent …`, `shortcuts …`), and global flags. Dynamic values (model/profile names)
land in v13.

## 3. Single native binary (Bun)

```sh
npm run build:binary       # → dist/ollamas-darwin-arm64 (gitignored)
./dist/ollamas-darwin-arm64 version
```

- Requires **Bun ≥ 1.3.13** (the 1.3.12 arm64 "Killed: 9" regression is fixed
  there); the script warns on older Bun.
- macOS **Gatekeeper**: the build ad-hoc signs (`codesign -s -`) so a locally
  built binary runs. A binary *downloaded* from a release is quarantined — clear
  it with `xattr -d com.apple.quarantine ./ollamas` (or ship a notarized build,
  v18).
- The compiled binary is named `ollamas-<os>-<arch>`; the CLI's launch guard
  matches `ollamas*`, so it runs correctly under any such name.

> Future: when the host Node reaches **≥ 25.5**, a canonical `--build-sea` binary
> can be added alongside Bun (codesign + notarize) — see ROADMAP v12.

## 4. Homebrew (draft)

`packaging/Formula/ollamas.rb` is a **draft** prebuilt-binary formula. Shipping it
is an explicit, outward-facing step (your account):

1. Build per-arch binaries with `cli/build-binary.sh` on each arch.
2. Attach them to a GitHub release `vX.Y.Z`; compute `shasum -a 256`.
3. Fill `version` + the two `url`/`sha256` lines in the formula.
4. Put the file in a tap repo `github.com/<you>/homebrew-ollamas` at
   `Formula/ollamas.rb`.
5. Users: `brew tap <you>/ollamas && brew install ollamas`.

Nothing here publishes automatically — the CLI lane ships the recipe, not the
release.
