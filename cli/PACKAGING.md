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
`agent …`, `shortcuts …`), and global flags.

**Dynamic values (v13):** TAB also completes real values —

```sh
ollamas config use <TAB>      # → your profile names
ollamas chat -m <TAB>         # → cached model names for the active provider
ollamas bench -p <TAB>        # → provider names
```

`__complete` reads these from **local disk only** — never a network call or keychain
read on TAB (a model fetch would hang it; a keychain read has a 5 s timeout — N-019 /
N-032). Profiles come from `~/.ollamas/profiles/`; models from a cache that
`ollamas bench` (or `doctor`) writes after it queries the gateway. So run **`ollamas
bench`** once to populate model completion; until then `-m <TAB>` is simply empty.

## 2b. Man page (v13)

```sh
ollamas man                                   # print the troff man(1) page
ollamas man > /usr/local/share/man/man1/ollamas.1   # install it
man ollamas
```

Generated (pure troff, zero-dep) from the live command surface, so it tracks the
version. Validated with `mandoc -Tlint` (clean).

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

## 4. Single native binary (Node SEA — canonical, v12)

```sh
npm run build:sea          # → dist/ollamas-darwin-arm64 (gitignored)
./dist/ollamas-darwin-arm64 version
```

- Uses Node's official **Single Executable Application** flow via the **classic**
  `node --experimental-sea-config` path — works on **Node ≥ 20** (no need for the
  newer `--build-sea`, which lands in Node 25.5). Pipeline: esbuild bundle →
  generate `dist/sea-prep.blob` → copy the running `node` → inject the blob with
  **postject** → ad-hoc codesign.
- `postject` is a **build-time devDependency** only; the CLI runtime stays zero-dep.
- macOS: a signed binary's signature is **stripped before** injection and **re-signed
  after** (postject edits a Mach-O segment, which breaks the signature).
- **SEA vs Bun (honest):** SEA embeds the *same Node runtime the CLI targets* — no
  third-party compiler, more robust — but is **larger** (~full Node, ~80 MB) and
  starts a touch slower. Bun (`build:binary`) is **smaller/faster** but a separate
  toolchain. Both are shipped; pick SEA where Bun isn't available, Bun where size
  matters. The launch guard handles SEA via `node:sea` `isSea()` (a SEA has no
  `argv[1]` script, so a name check alone would no-op the binary — N-029).

## 5. Homebrew (draft)

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
