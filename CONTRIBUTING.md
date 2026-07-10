# Contributing to ollamas

Thanks for helping build ollamas. This guide covers the dev setup, the quality gate every change must
pass, and how to open a good pull request.

## Dev setup

```bash
npm run ready        # idempotent: Node check, npm ci, .env from .env.example, ollama daemon, model pull, doctor
npm run dev          # tsx server.ts → http://localhost:3000   (or: make up)
```

No API keys are needed for local development — providers fall back gracefully (ollama → … → demo).
Full 60-second path and slash commands: [QUICKSTART.md](QUICKSTART.md).

## Quality gate (before every commit)

Evidence over assertion — run it, show the output. A change is not "done" until these pass:

```bash
npm run lint         # tsc --noEmit (type check)
npm run test         # full vitest suite (FRESH run)
npm run test:e2e     # playwright, when you touch the UI
```

`npm run verify` must be green before you commit. Do not bypass hooks (`--no-verify`) on feature work.

## Pull requests

- Branch from `main`; keep one logical change per PR.
- **Conventional Commit** titles: `feat|fix|refactor|chore|docs|test(scope): message` (English).
- Add or update tests for behavior changes; keep CI green.
- Comments explain **why** something non-obvious is done — not what the next line does.
- Never log secret **values** (token names are fine); root cause before symptom fix; remove unused code.

## Scope & architecture

Tool calls flow through a single choke-point (`server/tool-registry.ts`). To add your own
tool, skill, CLI command, or MCP integration, see [`docs/extension-guide.md`](docs/extension-guide.md)
and [`docs/adding-a-tool.md`](docs/adding-a-tool.md). Module map: [`planlama/11-MIMARI.md`](planlama/11-MIMARI.md).

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating you agree to uphold it.

## License

By contributing, you agree that your contributions are licensed under the project's [MIT License](LICENSE).
